import * as ort from "onnxruntime-web";
import { OnnxSessionManager, runInference } from "./onnx-engine.ts";
import { align5PointSimilarityTensor } from "./similarity-transform.ts";

export interface EdgeFaceOptions {
  modelPath?: string;
  targetSize?: 112 | 160;
  mean?: [number, number, number];
  std?: [number, number, number];
}

export interface EdgeFaceResult {
  embedding: Float32Array; // 256-d L2-normalized Float32 vector
  latencyMs: number;
  providerUsed: string;
}

/**
 * Computes L2 norm of a vector.
 */
export function computeL2Norm(v: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const val = v[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum);
}

/**
 * Normalizes 256-d embedding vector using L2 normalization v_hat = v / ||v||_2.
 * Safely handles near-zero, zero, or non-finite vectors to prevent NaN/Infinity poisoning.
 */
export function normalizeL2(embedding: ArrayLike<number>): Float32Array {
  const norm = computeL2Norm(embedding);
  const out = new Float32Array(embedding.length);
  if (!Number.isFinite(norm) || norm < 1e-12) {
    return out; // Return zeroed Float32Array
  }
  for (let i = 0; i < embedding.length; i++) {
    const val = (embedding[i] ?? 0) / norm;
    out[i] = Number.isFinite(val) ? val : 0;
  }
  return out;
}

/**
 * Helper to decode IEEE 754 float16 bit patterns (stored in Uint16) to float32 numbers.
 */
export function decodeFloat16(val: number): number {
  const s = (val & 0x8000) >> 15;
  const e = (val & 0x7c00) >> 10;
  const f = val & 0x03ff;

  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  }
  if (e === 0x1f) {
    return f ? NaN : (s ? -1 : 1) * Infinity;
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

/**
 * Extracts NCHW Planar Float32Array [1, 3, targetSize, targetSize] tensor from canvas/image source
 * when facial landmarks are not available.
 */
export function extractPlanarTensorFromCanvas(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | OffscreenCanvas,
  targetSize = 112
): Float32Array {
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(targetSize, targetSize);
    ctx = canvas.getContext("2d");
  } else {
    canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    ctx = canvas.getContext("2d");
  }

  if (ctx && "drawImage" in ctx) {
    const sw = "videoWidth" in source ? source.videoWidth : "naturalWidth" in source ? source.naturalWidth || source.width : source.width;
    const sh = "videoHeight" in source ? source.videoHeight : "naturalHeight" in source ? source.naturalHeight || source.height : source.height;
    ctx.drawImage(source as any, 0, 0, sw || targetSize, sh || targetSize, 0, 0, targetSize, targetSize);
  }

  const imgData = ctx ? ctx.getImageData(0, 0, targetSize, targetSize) : null;
  const pixels = imgData ? imgData.data : new Uint8ClampedArray(targetSize * targetSize * 4);
  const totalPixels = targetSize * targetSize;
  const tensorData = new Float32Array(1 * 3 * totalPixels);

  const rOffset = 0;
  const gOffset = totalPixels;
  const bOffset = totalPixels * 2;

  for (let i = 0; i < totalPixels; i++) {
    const r = pixels[i * 4 + 0] ?? 0;
    const g = pixels[i * 4 + 1] ?? 0;
    const b = pixels[i * 4 + 2] ?? 0;

    // Standardized normalization: (pixel - 127.5) / 128.0
    tensorData[rOffset + i] = (r - 127.5) / 128.0;
    tensorData[gOffset + i] = (g - 127.5) / 128.0;
    tensorData[bOffset + i] = (b - 127.5) / 128.0;
  }

  return tensorData;
}

/**
 * Extracts EdgeFace-M 256-d Float16/Float32 embedding vector from aligned face tensor or image source.
 * Output is strictly L2-normalized (||v_hat||_2 = 1.0).
 */
export async function extractEdgeFaceEmbedding(
  source: Float32Array | HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | OffscreenCanvas,
  landmarks?: Float32Array | number[][],
  options: EdgeFaceOptions = {}
): Promise<EdgeFaceResult> {
  const t0 = performance.now();
  const modelPath = options.modelPath ?? "/models/edgeface_m.onnx";
  const targetSize = options.targetSize ?? 112;

  // 1. Obtain Planar NCHW Float32Array input tensor [1, 3, targetSize, targetSize]
  let inputTensorData: Float32Array;
  if (source instanceof Float32Array) {
    inputTensorData = source;
  } else if (landmarks) {
    inputTensorData = align5PointSimilarityTensor(source, landmarks, targetSize);
  } else {
    inputTensorData = extractPlanarTensorFromCanvas(source, targetSize);
  }

  // 2. Obtain ONNX Inference Session
  const sessionManager = OnnxSessionManager.getInstance();
  const session = await sessionManager.getSession("edgeface_m", modelPath);
  const inputName = (session as any).inputNames?.[0] || "input";
  const outputName = (session as any).outputNames?.[0] || "embedding";

  // 3. Create ONNX Tensor & Run Inference
  const tensor = new ort.Tensor("float32", inputTensorData, [1, 3, targetSize, targetSize]);
  const { outputMap, latencyMs, providerUsed } = await runInference(session, { [inputName]: tensor });

  const rawOutput = outputMap[outputName] || Object.values(outputMap)[0];
  if (!rawOutput || !rawOutput.data) {
    throw new Error("[EdgeFace] ONNX session returned empty output tensor");
  }

  // 4. Extract raw Float32/Float16 data at the model's native dimension
  // (EdgeFace-S gamma05 emits 512-d; gallery is enrolled at the same dim).
  const rawData = rawOutput.data as Float32Array | Uint16Array;
  const outLen = Math.max(1, rawData.length);
  const rawArray = new Float32Array(outLen);

  if (rawData instanceof Float32Array) {
    for (let i = 0; i < outLen; i++) {
      rawArray[i] = rawData[i] ?? 0;
    }
  } else {
    // Decode Float16 (stored in Uint16Array) to Float32 if required by WebGPU EP
    for (let i = 0; i < outLen; i++) {
      rawArray[i] = decodeFloat16(rawData[i]!);
    }
  }

  // 5. Apply L2 Normalization v_hat = v / ||v||_2
  const embedding = normalizeL2(rawArray);
  const totalLatencyMs = Math.round(performance.now() - t0);

  return {
    embedding,
    latencyMs: totalLatencyMs > 0 ? totalLatencyMs : Math.round(latencyMs),
    providerUsed,
  };
}
