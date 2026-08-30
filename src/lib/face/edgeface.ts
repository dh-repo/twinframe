import * as ort from "onnxruntime-web";
import { computeCentroidEmbedding } from "./gallery-dedupe.ts";
import {
  isModelKnownUnavailable,
  OnnxSessionManager,
  prefetchModelUrl,
  runInference,
} from "./onnx-engine.ts";
import { align5PointSimilarityTensor } from "./similarity-transform.ts";

export type AdafaceVariant = "int8" | "fp16" | "fp32";

export const ADAFACE_FP32_PATH = "/models/adaface_ir101_webface12m.onnx";
export const ADAFACE_FP16_PATH = "/models/adaface_ir101_webface12m.fp16.onnx";
export const ADAFACE_INT8_PATH = "/models/adaface_ir101_webface12m.int8.onnx";
export const ADAFACE_EMBED_DIM = 512;
export const ADAFACE_INT8_SESSION_KEY = "adaface_ir101_int8";
export const ADAFACE_FP16_SESSION_KEY = "adaface_ir101_fp16";
export const ADAFACE_FP32_SESSION_KEY = "adaface_ir101_fp32";
export const ADAFACE_EXPLICIT_SESSION_KEY = "edgeface_m";

export const ADAFACE_INT8_LABEL = "AdaFace IR-101 (INT8)";
export const ADAFACE_FP16_LABEL = "AdaFace IR-101 (FP16)";
export const ADAFACE_FP32_LABEL = "AdaFace IR-101";

export const STUDENT_NOT_TRAINED_REASON =
  "No WebFace12M corpus and no GPU training cluster in this environment; INT8 of the same IR-101 graph is the honest speed path, and FP16 is the shippable fast path when PTQ fails the identity gate.";

/** Full-graph INT8 PTQ of this IR-101 measured mean cosine 0.58–0.75 vs fp32. */
export const ADAFACE_INT8_LIVE = false;
export const ADAFACE_FAST_VARIANT: AdafaceVariant = "fp16";
export const ADAFACE_FAST_PATH = ADAFACE_FP16_PATH;
export const ADAFACE_FAST_SESSION_KEY = ADAFACE_FP16_SESSION_KEY;
export const ADAFACE_FAST_MAX_MEAN_COSINE_DRIFT = 0.03;
export const ADAFACE_INT8_MAX_MEAN_COSINE_DRIFT = 0.03;

export interface EdgeFaceOptions {
  modelPath?: string;
  targetSize?: 112 | 160;
  mean?: [number, number, number];
  std?: [number, number, number];
  forceTta?: boolean;
  preferFp32?: boolean;
  preferInt8?: boolean;
  requireFast?: boolean;
}

export interface EdgeFaceResult {
  embedding: Float32Array;
  latencyMs: number;
  providerUsed: string;
  variant: AdafaceVariant;
}

export interface EdgeFaceTtaResult extends EdgeFaceResult {
  ttaApplied: boolean;
  ttaViews: number;
}

export type QueryTtaView =
  | { kind: "identity" }
  | { kind: "rotate"; degrees: number }
  | { kind: "scale"; factor: number }
  | { kind: "hflip" };

export const QUERY_TTA_VIEWS: readonly QueryTtaView[] = [
  { kind: "identity" },
  { kind: "rotate", degrees: 4 },
  { kind: "rotate", degrees: -4 },
  { kind: "scale", factor: 0.95 },
  { kind: "scale", factor: 1.05 },
  { kind: "hflip" },
];

export function shouldApplyQueryTta(opts: {
  providerUsed?: string;
  force?: boolean;
} = {}): boolean {
  if (opts.force === true) return true;
  if (opts.force === false) return false;
  const provider = (opts.providerUsed ?? "").toLowerCase();
  if (!provider) return false;
  if (provider.includes("wasm") || provider.includes("cpu")) return false;
  return provider.includes("webgpu") || provider.includes("cuda") || provider.includes("dml");
}

export function computeL2Norm(v: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const val = v[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum);
}

export function normalizeL2(embedding: ArrayLike<number>): Float32Array {
  const norm = computeL2Norm(embedding);
  const out = new Float32Array(embedding.length);
  if (!Number.isFinite(norm) || norm < 1e-12) {
    return out;
  }
  for (let i = 0; i < embedding.length; i++) {
    const val = (embedding[i] ?? 0) / norm;
    out[i] = Number.isFinite(val) ? val : 0;
  }
  return out;
}

let int8Failed = false;
let fastPathFailed = false;
let fastFailReason: string | null = null;

export function resetAdafaceVariantState(): void {
  int8Failed = false;
  fastPathFailed = false;
  fastFailReason = null;
}

export function adafaceFastPathFailed(): boolean {
  return fastPathFailed;
}

export function adafaceInt8Failed(): boolean {
  return int8Failed;
}

export function adafaceFastFailReason(): string | null {
  return fastFailReason;
}

export function markAdafaceInt8Failed(reason: string): void {
  int8Failed = true;
  fastFailReason = reason;
}

export function markAdafaceFastPathFailed(reason: string): void {
  fastPathFailed = true;
  fastFailReason = reason;
}

export function embedderLabel(variant: AdafaceVariant): string {
  if (variant === "int8") return ADAFACE_INT8_LABEL;
  if (variant === "fp16") return ADAFACE_FP16_LABEL;
  return ADAFACE_FP32_LABEL;
}

export function variantFromModelPath(modelPath: string): AdafaceVariant {
  if (modelPath.includes(".int8.")) return "int8";
  if (modelPath.includes(".fp16.")) return "fp16";
  return "fp32";
}

export function isUsableAdafaceEmbedding(
  raw: ArrayLike<number>,
  expectedDim = ADAFACE_EMBED_DIM,
): boolean {
  if (raw.length !== expectedDim) return false;
  const n = computeL2Norm(raw);
  return Number.isFinite(n) && n >= 1e-6;
}

export function rgbPlanarToAdafaceBgr(rgb: Float32Array, targetSize: number): Float32Array {
  const ch = targetSize * targetSize;
  const bgr = new Float32Array(rgb.length);
  for (let i = 0; i < ch; i++) {
    bgr[i] = rgb[2 * ch + i] ?? 0;
    bgr[ch + i] = rgb[ch + i] ?? 0;
    bgr[2 * ch + i] = rgb[i] ?? 0;
  }
  return bgr;
}

export function meanCosineDrift(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return 1 - s;
}

function shouldTryInt8(options: EdgeFaceOptions): boolean {
  if (options.modelPath) return false;
  if (options.preferFp32) return false;
  if (int8Failed) return false;
  if (isModelKnownUnavailable(ADAFACE_INT8_PATH)) return false;
  return ADAFACE_INT8_LIVE || options.preferInt8 === true;
}

function shouldTryFastPath(options: EdgeFaceOptions): boolean {
  if (options.modelPath) return false;
  if (options.preferFp32) return false;
  if (options.preferInt8) return false;
  if (fastPathFailed) return false;
  if (isModelKnownUnavailable(ADAFACE_FAST_PATH)) return false;
  return true;
}

export async function prefetchAdafaceFastPath(): Promise<boolean> {
  if (fastPathFailed) return false;
  const ok = await prefetchModelUrl(ADAFACE_FAST_PATH);
  if (!ok) markAdafaceFastPathFailed(`prefetch unavailable: ${ADAFACE_FAST_PATH}`);
  return ok;
}

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

    tensorData[rOffset + i] = (r - 127.5) / 128.0;
    tensorData[gOffset + i] = (g - 127.5) / 128.0;
    tensorData[bOffset + i] = (b - 127.5) / 128.0;
  }

  return tensorData;
}

export async function extractEdgeFaceEmbedding(
  source: Float32Array | HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | OffscreenCanvas,
  landmarks?: Float32Array | number[][],
  options: EdgeFaceOptions = {}
): Promise<EdgeFaceResult> {
  const t0 = performance.now();
  const targetSize = options.targetSize ?? 112;

  let rgb: Float32Array;
  if (source instanceof Float32Array) {
    rgb = source;
  } else if (landmarks) {
    rgb = align5PointSimilarityTensor(source, landmarks, targetSize);
  } else {
    rgb = extractPlanarTensorFromCanvas(source, targetSize);
  }

  if (options.modelPath) {
    const ran = await runAdafaceOnce(rgb, targetSize, options.modelPath, ADAFACE_EXPLICIT_SESSION_KEY, t0);
    return {
      embedding: ran.embedding,
      latencyMs: ran.latencyMs,
      providerUsed: ran.providerUsed,
      variant: variantFromModelPath(options.modelPath),
    };
  }

  if (shouldTryInt8(options)) {
    const int8 = await tryVariant(rgb, targetSize, t0, {
      path: ADAFACE_INT8_PATH,
      key: ADAFACE_INT8_SESSION_KEY,
      variant: "int8",
      requireDim: true,
      markFailed: markAdafaceInt8Failed,
    });
    if (int8) return int8;
    if (options.requireFast && options.preferInt8) {
      throw new Error(fastFailReason ?? "AdaFace INT8 required but unusable");
    }
  }

  if (shouldTryFastPath(options)) {
    const fast = await tryVariant(rgb, targetSize, t0, {
      path: ADAFACE_FAST_PATH,
      key: ADAFACE_FAST_SESSION_KEY,
      variant: ADAFACE_FAST_VARIANT,
      requireDim: true,
      markFailed: markAdafaceFastPathFailed,
    });
    if (fast) return fast;
    if (options.requireFast) {
      throw new Error(fastFailReason ?? "AdaFace fast path required but unusable");
    }
  }

  const fp32 = await runAdafaceOnce(rgb, targetSize, ADAFACE_FP32_PATH, ADAFACE_FP32_SESSION_KEY, t0);
  return {
    embedding: fp32.embedding,
    latencyMs: fp32.latencyMs,
    providerUsed: fp32.providerUsed,
    variant: "fp32",
  };
}

async function tryVariant(
  rgb: Float32Array,
  targetSize: number,
  t0: number,
  spec: {
    path: string;
    key: string;
    variant: AdafaceVariant;
    requireDim: boolean;
    markFailed: (reason: string) => void;
  },
): Promise<EdgeFaceResult | null> {
  try {
    const ran = await runAdafaceOnce(rgb, targetSize, spec.path, spec.key, t0);
    if (spec.requireDim && !isUsableAdafaceEmbedding(ran.raw)) {
      throw new Error(`unusable ${spec.variant} output dim=${ran.raw.length}`);
    }
    return {
      embedding: ran.embedding,
      latencyMs: ran.latencyMs,
      providerUsed: ran.providerUsed,
      variant: spec.variant,
    };
  } catch (err) {
    spec.markFailed(err instanceof Error ? err.message : String(err));
    await OnnxSessionManager.getInstance().disposeSession(spec.key);
    return null;
  }
}

async function runAdafaceOnce(
  rgb: Float32Array,
  targetSize: number,
  modelPath: string,
  sessionKey: string,
  t0: number,
): Promise<{ embedding: Float32Array; raw: Float32Array; latencyMs: number; providerUsed: string }> {
  const sessionManager = OnnxSessionManager.getInstance();
  const session = await sessionManager.getSession(sessionKey, modelPath);
  const inputName = (session as any).inputNames?.[0] || "input";
  const outputName = (session as any).outputNames?.[0] || "embedding";

  const bgr = rgbPlanarToAdafaceBgr(rgb, targetSize);
  const tensor = new ort.Tensor("float32", bgr, [1, 3, targetSize, targetSize]);
  const { outputMap, latencyMs, providerUsed } = await runInference(session, { [inputName]: tensor });

  const rawOutput = outputMap[outputName] || Object.values(outputMap)[0];
  if (!rawOutput || !rawOutput.data) {
    throw new Error("[AdaFace] ONNX session returned empty output tensor");
  }

  const rawData = rawOutput.data as Float32Array | Uint16Array;
  const outLen = Math.max(1, rawData.length);
  const rawArray = new Float32Array(outLen);

  if (rawData instanceof Float32Array) {
    for (let i = 0; i < outLen; i++) {
      rawArray[i] = rawData[i] ?? 0;
    }
  } else {
    for (let i = 0; i < outLen; i++) {
      rawArray[i] = decodeFloat16(rawData[i]!);
    }
  }

  const embedding = normalizeL2(rawArray);
  const totalLatencyMs = Math.round(performance.now() - t0);
  return {
    embedding,
    raw: rawArray,
    latencyMs: totalLatencyMs > 0 ? totalLatencyMs : Math.round(latencyMs),
    providerUsed,
  };
}

export function resolveEdgeFaceInputTensor(
  source: Float32Array | HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | OffscreenCanvas,
  landmarks?: Float32Array | number[][],
  targetSize: 112 | 160 = 112,
): Float32Array {
  if (source instanceof Float32Array) return source;
  if (landmarks) return align5PointSimilarityTensor(source, landmarks, targetSize);
  return extractPlanarTensorFromCanvas(source, targetSize);
}

export function hflipAlignedNchw(tensor: Float32Array, size = 112): Float32Array {
  const out = new Float32Array(tensor.length);
  const plane = size * size;
  for (let c = 0; c < 3; c++) {
    const base = c * plane;
    for (let y = 0; y < size; y++) {
      const row = base + y * size;
      for (let x = 0; x < size; x++) {
        out[row + (size - 1 - x)] = tensor[row + x] ?? 0;
      }
    }
  }
  return out;
}

export function rotateAlignedNchw(
  tensor: Float32Array,
  degrees: number,
  size = 112,
): Float32Array {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  return warpAlignedNchw(tensor, size, (x, y) => {
    const cx = (size - 1) / 2;
    const cy = (size - 1) / 2;
    const dx = x - cx;
    const dy = y - cy;
    return [cos * dx - sin * dy + cx, sin * dx + cos * dy + cy];
  });
}

export function scaleAlignedNchw(
  tensor: Float32Array,
  factor: number,
  size = 112,
): Float32Array {
  const safe = factor === 0 || !Number.isFinite(factor) ? 1 : factor;
  return warpAlignedNchw(tensor, size, (x, y) => {
    const cx = (size - 1) / 2;
    const cy = (size - 1) / 2;
    return [(x - cx) / safe + cx, (y - cy) / safe + cy];
  });
}

export function applyQueryTtaView(
  tensor: Float32Array,
  view: QueryTtaView,
  size = 112,
): Float32Array {
  switch (view.kind) {
    case "identity":
      return tensor;
    case "rotate":
      return rotateAlignedNchw(tensor, view.degrees, size);
    case "scale":
      return scaleAlignedNchw(tensor, view.factor, size);
    case "hflip":
      return hflipAlignedNchw(tensor, size);
    default: {
      const _never: never = view;
      return _never;
    }
  }
}

export async function extractEdgeFaceEmbeddingWithTta(
  source: Float32Array | HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | OffscreenCanvas,
  landmarks?: Float32Array | number[][],
  options: EdgeFaceOptions = {},
): Promise<EdgeFaceTtaResult> {
  const targetSize = options.targetSize ?? 112;
  const tensor = resolveEdgeFaceInputTensor(source, landmarks, targetSize);
  const identity = await extractEdgeFaceEmbedding(tensor, undefined, options);
  if (!shouldApplyQueryTta({ providerUsed: identity.providerUsed, force: options.forceTta })) {
    return { ...identity, ttaApplied: false, ttaViews: 1 };
  }

  const embeddings: Float32Array[] = [identity.embedding];
  let latencyMs = identity.latencyMs;
  let providerUsed = identity.providerUsed;

  for (const view of QUERY_TTA_VIEWS) {
    if (view.kind === "identity") continue;
    const warped = applyQueryTtaView(tensor, view, targetSize);
    const next = await extractEdgeFaceEmbedding(warped, undefined, options);
    embeddings.push(next.embedding);
    latencyMs += next.latencyMs;
    providerUsed = next.providerUsed;
  }

  return {
    embedding: computeCentroidEmbedding(embeddings),
    latencyMs,
    providerUsed,
    variant: identity.variant,
    ttaApplied: true,
    ttaViews: embeddings.length,
  };
}

function warpAlignedNchw(
  tensor: Float32Array,
  size: number,
  sourceOf: (x: number, y: number) => [number, number],
): Float32Array {
  const out = new Float32Array(tensor.length);
  const plane = size * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [sx, sy] = sourceOf(x, y);
      for (let c = 0; c < 3; c++) {
        out[c * plane + y * size + x] = sampleNchwBilinear(tensor, c, sy, sx, size);
      }
    }
  }
  return out;
}

function sampleNchwBilinear(
  tensor: Float32Array,
  channel: number,
  y: number,
  x: number,
  size: number,
): number {
  if (x < 0 || y < 0 || x > size - 1 || y > size - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const plane = channel * size * size;
  const v00 = tensor[plane + y0 * size + x0] ?? 0;
  const v10 = tensor[plane + y0 * size + x1] ?? 0;
  const v01 = tensor[plane + y1 * size + x0] ?? 0;
  const v11 = tensor[plane + y1 * size + x1] ?? 0;
  const v0 = v00 * (1 - fx) + v10 * fx;
  const v1 = v01 * (1 - fx) + v11 * fx;
  return v0 * (1 - fy) + v1 * fy;
}
