import * as ort from "onnxruntime-web";
import { OnnxSessionManager, runInference } from "./onnx-engine.ts";
import type { SCRFDDetectionResult, SCRFDBoundingBox, SCRFDPose, SmileMetrics } from "./types.ts";
import { estimateSmileMetrics } from "./types.ts";

export interface Anchor {
  cx: number;
  cy: number;
  stride: number;
}

/**
 * Precomputes multi-stride feature pyramid anchors for SCRFD-2.5G.
 * Strides: 8 (80x80 = 6,400 cells x 2 = 12,800 anchors),
 *          16 (40x40 = 1,600 cells x 2 = 3,200 anchors),
 *          32 (20x20 = 400 cells x 2 = 800 anchors).
 * Total anchors: 16,800.
 */
export function generateAnchors(
  inputWidth = 640,
  inputHeight = 640
): Record<number, Anchor[]> {
  const strides = [8, 16, 32];
  const numAnchorsPerCell = 2;
  const result: Record<number, Anchor[]> = {};

  for (const stride of strides) {
    const featW = Math.ceil(inputWidth / stride);
    const featH = Math.ceil(inputHeight / stride);
    const anchors: Anchor[] = [];

    for (let y = 0; y < featH; y++) {
      for (let x = 0; x < featW; x++) {
        const cx = (x + 0.5) * stride;
        const cy = (y + 0.5) * stride;
        for (let a = 0; a < numAnchorsPerCell; a++) {
          anchors.push({ cx, cy, stride });
        }
      }
    }
    result[stride] = anchors;
  }

  return result;
}

/**
 * Estimates 3D head pose angles (yaw, pitch, roll in degrees) from 5-point facial landmarks:
 * [left_eye, right_eye, nose_tip, left_mouth, right_mouth]
 */
export function estimateHeadPose(landmarks: Float32Array | number[][]): SCRFDPose {
  let lx: number, ly: number, rx: number, ry: number, nx: number, ny: number, lmx: number, lmy: number, rmx: number, rmy: number;

  if (Array.isArray(landmarks)) {
    [lx, ly] = landmarks[0];
    [rx, ry] = landmarks[1];
    [nx, ny] = landmarks[2];
    [lmx, lmy] = landmarks[3];
    [rmx, rmy] = landmarks[4];
  } else {
    lx = landmarks[0]; ly = landmarks[1];
    rx = landmarks[2]; ry = landmarks[3];
    nx = landmarks[4]; ny = landmarks[5];
    lmx = landmarks[6]; lmy = landmarks[7];
    rmx = landmarks[8]; rmy = landmarks[9];
  }

  // 1. Roll: inclination angle of inter-ocular baseline
  const dxEye = rx - lx;
  const dyEye = ry - ly;
  const rollRad = Math.atan2(dyEye, dxEye);
  const roll = (rollRad * 180) / Math.PI;

  // Inter-ocular distance & eye midpoint
  const eyeMidX = (lx + rx) / 2;
  const eyeMidY = (ly + ry) / 2;
  const iod = Math.sqrt(dxEye * dxEye + dyEye * dyEye);
  const safeIod = Math.max(1e-5, iod);

  // 2. Un-roll nose tip delta relative to eye midpoint
  const cosR = Math.cos(-rollRad);
  const sinR = Math.sin(-rollRad);
  const rawDxNose = nx - eyeMidX;
  const rawDyNose = ny - eyeMidY;

  const dxNose = rawDxNose * cosR - rawDyNose * sinR;
  const dyNose = rawDxNose * sinR + rawDyNose * cosR;

  // Yaw: horizontal nose displacement ratio relative to eye midpoint
  const deltaYaw = (2 * dxNose) / safeIod;
  const clampedDeltaYaw = Math.max(-1.0, Math.min(1.0, deltaYaw));
  const yaw = Math.asin(clampedDeltaYaw) * (180 / Math.PI);

  // 3. Un-roll mouth midpoint delta relative to eye midpoint
  const mouthMidX = (lmx + rmx) / 2;
  const mouthMidY = (lmy + rmy) / 2;
  const rawDxMouth = mouthMidX - eyeMidX;
  const rawDyMouth = mouthMidY - eyeMidY;
  const dyMouth = rawDxMouth * sinR + rawDyMouth * cosR;

  // Pitch: vertical offset asymmetry ratio (eye-to-nose vs nose-to-mouth)
  const verticalOffset = 2 * dyNose - dyMouth;
  const pitch = Math.atan2(verticalOffset, safeIod) * (180 / Math.PI);

  return {
    yaw: Math.round(yaw * 100) / 100,
    pitch: Math.round(pitch * 100) / 100,
    roll: Math.round(roll * 100) / 100,
  };
}

/**
 * Computes Intersection over Union (IoU) between two bounding boxes.
 */
export function computeIoU(boxA: SCRFDBoundingBox, boxB: SCRFDBoundingBox): number {
  const xA = Math.max(boxA.x, boxB.x);
  const yA = Math.max(boxA.y, boxB.y);
  const xB = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
  const yB = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

  const interWidth = Math.max(0, xB - xA);
  const interHeight = Math.max(0, yB - yA);
  const interArea = interWidth * interHeight;

  const areaA = boxA.width * boxA.height;
  const areaB = boxB.width * boxB.height;
  const unionArea = areaA + areaB - interArea;

  if (unionArea <= 0) return 0;
  return interArea / unionArea;
}

/**
 * Non-Maximum Suppression (NMS) for face bounding boxes.
 */
export function nmsFaceBoxes(
  candidates: SCRFDDetectionResult[],
  iouThreshold = 0.40
): SCRFDDetectionResult[] {
  if (candidates.length === 0) return [];

  // Sort by confidence score descending
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const selected: SCRFDDetectionResult[] = [];

  while (sorted.length > 0) {
    const current = sorted.shift()!;
    selected.push(current);

    for (let i = sorted.length - 1; i >= 0; i--) {
      const iou = computeIoU(current.bbox, sorted[i].bbox);
      if (iou >= iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }

  return selected;
}

/**
 * Group shots often give a background extra a higher detector score than the
 * subject. Rank-1 and the live query both want the largest remaining box.
 * When two boxes are a near-tie (action shots, overlapping players), largest
 * is a coin flip — prefer the face closer to the frame centre so a famous
 * central subject is not displaced by a foreground shoulder.
 */
export const PRIMARY_AREA_TIE_RATIO = 0.9;

export function selectPrimaryFace<T extends { bbox: { x: number; y: number; width: number; height: number } }>(
  faces: T[],
  imageSize?: { width: number; height: number } | null,
): T | null {
  if (faces.length === 0) return null;
  const areaOf = (f: T) => Math.max(0, f.bbox.width) * Math.max(0, f.bbox.height);
  let best = faces[0]!;
  let bestArea = areaOf(best);
  for (let i = 1; i < faces.length; i++) {
    const face = faces[i]!;
    const area = areaOf(face);
    if (area > bestArea) {
      best = face;
      bestArea = area;
    }
  }
  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) return best;
  const tied: T[] = [];
  for (const face of faces) {
    if (areaOf(face) >= bestArea * PRIMARY_AREA_TIE_RATIO) tied.push(face);
  }
  if (tied.length < 2) return best;
  const cx = imageSize.width / 2;
  const cy = imageSize.height / 2;
  let pick = tied[0]!;
  let bestDist = Infinity;
  for (const face of tied) {
    const fx = face.bbox.x + face.bbox.width / 2;
    const fy = face.bbox.y + face.bbox.height / 2;
    const dx = (fx - cx) / imageSize.width;
    const dy = (fy - cy) / imageSize.height;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      pick = face;
      bestDist = dist;
    }
  }
  return pick;
}

import { createSafeCanvas } from "./similarity-transform.ts";

export interface DetectOptions {
  modelPath?: string;
  scoreThreshold?: number;
  iouThreshold?: number;
}

/**
 * Performs SCRFD-2.5G ONNX face detection on image / canvas / video source.
 */
export async function detectSCRFD(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas,
  options: DetectOptions = {}
): Promise<{
  detections: SCRFDDetectionResult[];
  primary: SCRFDDetectionResult | null;
  latencyMs: number;
}> {
  const t0 = performance.now();
  const scoreThreshold = options.scoreThreshold ?? 0.40;
  const iouThreshold = options.iouThreshold ?? 0.40;
  const modelPath = options.modelPath ?? "/models/scrfd_2.5g.onnx";

  // Determine original source dimensions
  let origW = 640;
  let origH = 640;
  if ("naturalWidth" in source && source.naturalWidth) {
    origW = source.naturalWidth;
    origH = source.naturalHeight;
  } else if ("videoWidth" in source && source.videoWidth) {
    origW = source.videoWidth;
    origH = source.videoHeight;
  } else if ("width" in source && source.width) {
    origW = typeof source.width === "number" ? source.width : 640;
    origH = typeof source.height === "number" ? source.height : 640;
  }

  // Preprocess input image to 640x640 letterbox
  const inputDim = 640;
  const scale = Math.min(inputDim / Math.max(1, origW), inputDim / Math.max(1, origH));
  const padX = (inputDim - origW * scale) / 2;
  const padY = (inputDim - origH * scale) / 2;

  const canvas = createSafeCanvas(inputDim, inputDim);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("[SCRFD] Failed to acquire 2D canvas rendering context");
  }


  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, inputDim, inputDim);
  ctx.drawImage(source as any, 0, 0, origW, origH, padX, padY, origW * scale, origH * scale);

  const imgData = ctx.getImageData(0, 0, inputDim, inputDim);
  const rgba = imgData.data;

  // Convert to NCHW Float32 tensor: (x - 127.5) / 128.0
  const float32Data = new Float32Array(1 * 3 * inputDim * inputDim);
  const planeSize = inputDim * inputDim;

  for (let i = 0; i < planeSize; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];

    float32Data[i] = (r - 127.5) / 128.0;
    float32Data[planeSize + i] = (g - 127.5) / 128.0;
    float32Data[2 * planeSize + i] = (b - 127.5) / 128.0;
  }

  // Load / execute ONNX session
  const sessionManager = OnnxSessionManager.getInstance();
  const session = await sessionManager.getSession("scrfd_2.5g", modelPath);

  const inputName = (session as any).inputNames?.[0] || "input";

  const tensor = new ort.Tensor("float32", float32Data, [1, 3, inputDim, inputDim]);

  const { outputMap } = await runInference(session, { [inputName]: tensor });

  // Generate anchors for strides 8, 16, 32
  const anchorsByStride = generateAnchors(inputDim, inputDim);

  // Group outputs by stride. Raw lengths collide across roles (e.g. score_8 and
  // bbox_16 are both 12,800 floats), so use tensor dims: [1, anchors, channels]
  // where channels 1|2 = score, 4 = bbox, 10 = kps, and anchors → stride.
  const parsedOutputs: Record<number, { scoreData?: Float32Array; bboxData?: Float32Array; kpsData?: Float32Array; scoreStride?: number }> = {
    8: {},
    16: {},
    32: {},
  };

  const anchorsToStride: Record<number, number> = { 12800: 8, 3200: 16, 800: 32 };

  for (const name of Object.keys(outputMap)) {
    const outTensor = outputMap[name];
    const data = outTensor.data as Float32Array;
    const dims = outTensor.dims ?? [];

    let anchorCount: number | undefined;
    let channels: number | undefined;
    if (dims.length === 3) {
      anchorCount = Number(dims[1]);
      channels = Number(dims[2]);
    } else if (dims.length === 2) {
      anchorCount = Number(dims[0]);
      channels = Number(dims[1]);
    }

    // Name-based hint as a fallback for exports with flattened dims
    if ((!anchorCount || !channels) && /(score|bbox|kps)[_-]?(8|16|32)/.test(name)) {
      const m = name.match(/(score|bbox|kps)[_-]?(8|16|32)/)!;
      const role = m[1];
      const stride = Number(m[2]);
      const perAnchor = role === "score" ? 1 : role === "bbox" ? 4 : 10;
      anchorCount = data.length / perAnchor;
      channels = perAnchor;
      void stride;
    }

    if (!anchorCount || !channels) continue;
    const stride = anchorsToStride[anchorCount];
    if (!stride) continue;

    if (channels === 1) {
      parsedOutputs[stride].scoreData = data;
    } else if (channels === 2) {
      parsedOutputs[stride].scoreData = data;
      parsedOutputs[stride].scoreStride = 2;
    } else if (channels === 4) {
      parsedOutputs[stride].bboxData = data;
    } else if (channels === 10) {
      parsedOutputs[stride].kpsData = data;
    }
  }

  const rawDetections: SCRFDDetectionResult[] = [];

  for (const stride of [8, 16, 32]) {
    const anchors = anchorsByStride[stride];
    const { scoreData, bboxData, kpsData, scoreStride = 1 } = parsedOutputs[stride];

    if (!scoreData || !bboxData || !kpsData) continue;

    for (let i = 0; i < anchors.length; i++) {
      const score = scoreStride === 2 ? scoreData[i * 2 + 1] : scoreData[i];
      if (score < scoreThreshold) continue;

      const anchor = anchors[i];

      // Decode bounding box offsets (dL, dT, dR, dB)
      const dL = bboxData[i * 4];
      const dT = bboxData[i * 4 + 1];
      const dR = bboxData[i * 4 + 2];
      const dB = bboxData[i * 4 + 3];

      const x1_640 = anchor.cx - dL * stride;
      const y1_640 = anchor.cy - dT * stride;
      const x2_640 = anchor.cx + dR * stride;
      const y2_640 = anchor.cy + dB * stride;

      // Un-letterbox bounding box to original image coordinates
      const x1 = Math.max(0, (x1_640 - padX) / scale);
      const y1 = Math.max(0, (y1_640 - padY) / scale);
      const x2 = Math.min(origW, (x2_640 - padX) / scale);
      const y2 = Math.min(origH, (y2_640 - padY) / scale);
      const width = Math.max(1, x2 - x1);
      const height = Math.max(1, y2 - y1);

      // Decode 5-point landmarks
      const landmarks = new Float32Array(10);
      const normalizedLandmarks: Array<{ x: number; y: number }> = [];

      for (let k = 0; k < 5; k++) {
        const dx = kpsData[i * 10 + k * 2];
        const dy = kpsData[i * 10 + k * 2 + 1];

        const px_640 = anchor.cx + dx * stride;
        const py_640 = anchor.cy + dy * stride;

        const px = (px_640 - padX) / scale;
        const py = (py_640 - padY) / scale;

        landmarks[k * 2] = px;
        landmarks[k * 2 + 1] = py;

        normalizedLandmarks.push({
          x: px / origW,
          y: py / origH,
        });
      }

      // Estimate 3D head pose (yaw, pitch, roll)
      const pose = estimateHeadPose(landmarks);
      // Estimate smile metrics (smileRatio, elevation, intensity)
      const smile = estimateSmileMetrics(landmarks);

      const bbox: SCRFDBoundingBox = { x: x1, y: y1, width, height };
      const normalizedBox: SCRFDBoundingBox = {
        x: x1 / origW,
        y: y1 / origH,
        width: width / origW,
        height: height / origH,
      };

      rawDetections.push({
        bbox,
        normalizedBox,
        score,
        confidence: score,
        landmarks,
        normalizedLandmarks,
        pose,
        smile,
      });
    }
  }

  // Apply Non-Maximum Suppression (NMS)
  const detections = nmsFaceBoxes(rawDetections, iouThreshold);
  const primary = selectPrimaryFace(detections, { width: origW, height: origH });
  const latencyMs = Math.round(performance.now() - t0);

  return {
    detections,
    primary,
    latencyMs,
  };
}
