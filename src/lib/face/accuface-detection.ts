import { createSafeCanvas } from "./similarity-transform.ts";
import type { FaceDetectionResult } from "./faceapi-engine.ts";
import type {
  FaceStageLatencies,
  FaceTelemetry,
  SCRFDBoundingBox,
  SCRFDDetectionResult,
  SCRFDLandmark,
} from "./types.ts";

export function pipelineLog(
  stage: string,
  extra: Record<string, unknown> = {},
): void {
  console.info(`[Pipeline] ${stage}`, {
    tMs: Math.round(performance.now()),
    ...extra,
  });
}

/** HUD / FaceAPI boxes are percent [0..100]; SCRFD stores unit [0..1]. */
export function toHudPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value <= 1.0001 ? value * 100 : value;
  return Math.min(100, Math.max(0, scaled));
}

export function hudBoxFromScrfd(box: SCRFDBoundingBox): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: toHudPercent(box.x),
    y: toHudPercent(box.y),
    width: toHudPercent(box.width),
    height: toHudPercent(box.height),
  };
}

export function hudLandmarksFromScrfd(
  points: SCRFDLandmark[],
): { x: number; y: number }[] {
  return points.map((pt) => ({
    x: toHudPercent(pt.x),
    y: toHudPercent(pt.y),
  }));
}

/** Map detections from a margin-padded canvas back onto the original crop. */
export function unpadScrfdDetections(
  detections: SCRFDDetectionResult[],
  margin: number,
  origW: number,
  origH: number,
): SCRFDDetectionResult[] {
  if (margin <= 0) return detections;
  const w = Math.max(1, origW);
  const h = Math.max(1, origH);
  return detections.map((det) => {
    const landmarks = new Float32Array(det.landmarks);
    for (let i = 0; i < landmarks.length; i += 2) {
      landmarks[i] = (landmarks[i] ?? 0) - margin;
      landmarks[i + 1] = (landmarks[i + 1] ?? 0) - margin;
    }
    const bbox = {
      x: det.bbox.x - margin,
      y: det.bbox.y - margin,
      width: det.bbox.width,
      height: det.bbox.height,
    };
    const normalizedLandmarks = det.normalizedLandmarks.map((pt) => ({
      x: ((pt.x * (w + margin * 2)) - margin) / w,
      y: ((pt.y * (h + margin * 2)) - margin) / h,
    }));
    return {
      ...det,
      bbox,
      landmarks,
      normalizedLandmarks,
      normalizedBox: {
        x: bbox.x / w,
        y: bbox.y / h,
        width: bbox.width / w,
        height: bbox.height / h,
      },
    };
  });
}

export function sourceDimensions(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas,
): { w: number; h: number } {
  if ("naturalWidth" in source && source.naturalWidth) {
    return { w: source.naturalWidth, h: source.naturalHeight };
  }
  if ("videoWidth" in source && source.videoWidth) {
    return { w: source.videoWidth, h: source.videoHeight };
  }
  return {
    w: "width" in source ? Number(source.width) || 0 : 0,
    h: "height" in source ? Number(source.height) || 0 : 0,
  };
}

function paddedSquareCrop(
  box: { x: number; y: number; width: number; height: number },
  srcW: number,
  srcH: number,
  padFrac = 0.35,
): { x: number; y: number; side: number } {
  const padX = box.width * padFrac;
  const padY = box.height * padFrac * 1.1;
  let x = Math.max(0, box.x - padX);
  let y = Math.max(0, box.y - padY);
  const w = Math.min(srcW - x, box.width + padX * 2);
  const h = Math.min(srcH - y, box.height + padY * 2.2);
  const side = Math.max(w, h, 1);
  x = Math.max(0, Math.min(srcW - side, x + (w - side) / 2));
  y = Math.max(0, Math.min(srcH - side, y + (h - side) / 2));
  return { x, y, side: Math.min(side, srcW - x, srcH - y) };
}

function cropFacePreview(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
  srcW: number,
  srcH: number,
  outSize = 320,
): HTMLCanvasElement {
  const crop = paddedSquareCrop(box, srcW, srcH);
  const canvas = createSafeCanvas(outSize, outSize) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");
  if (ctx && crop.side >= 1) {
    (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality =
      "high";
    ctx.drawImage(
      source as CanvasImageSource,
      crop.x,
      crop.y,
      crop.side,
      crop.side,
      0,
      0,
      outSize,
      outSize,
    );
  }
  return canvas;
}

function estimateSharpness(canvas: HTMLCanvasElement): {
  sharpness: number;
  illumination: number;
} {
  const s = 64;
  const probe = createSafeCanvas(s, s) as HTMLCanvasElement;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { sharpness: 50, illumination: 0.5 };
  ctx.drawImage(canvas, 0, 0, s, s);
  const data = ctx.getImageData(0, 0, s, s).data;
  const gray = new Float32Array(s * s);
  let sum = 0;
  for (let i = 0; i < s * s; i++) {
    const lum =
      0.299 * (data[i * 4] ?? 0) +
      0.587 * (data[i * 4 + 1] ?? 0) +
      0.114 * (data[i * 4 + 2] ?? 0);
    gray[i] = lum;
    sum += lum;
  }
  let lapSum = 0;
  let lapSq = 0;
  for (let y = 1; y < s - 1; y++) {
    for (let x = 1; x < s - 1; x++) {
      const idx = y * s + x;
      const center = gray[idx] ?? 0;
      const lap =
        (gray[idx - s] ?? 0) +
        (gray[idx + s] ?? 0) +
        (gray[idx - 1] ?? 0) +
        (gray[idx + 1] ?? 0) -
        4 * center;
      lapSum += lap;
      lapSq += lap * lap;
    }
  }
  const n = (s - 2) * (s - 2);
  const variance = Math.max(0, lapSq / n - (lapSum / n) * (lapSum / n));
  return {
    sharpness: Math.min(100, Math.max(0, variance / 12)),
    illumination: Math.min(1, Math.max(0, sum / gray.length / 255)),
  };
}

export function detectionFromAccuFace(args: {
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;
  embedding: Float32Array;
  detections: SCRFDDetectionResult[];
  primary: SCRFDDetectionResult;
  latencies: FaceStageLatencies;
  frontalizationMethod: NonNullable<FaceTelemetry["frontalizationMethod"]>;
}): FaceDetectionResult {
  const { w, h } = sourceDimensions(args.source);
  const srcW = Math.max(1, w);
  const srcH = Math.max(1, h);
  const crop = paddedSquareCrop(args.primary.bbox, srcW, srcH);
  const faceCanvas = cropFacePreview(args.source, args.primary.bbox, srcW, srcH);
  const { sharpness, illumination } = estimateSharpness(faceCanvas);
  const normalizedLandmarks = hudLandmarksFromScrfd(args.primary.normalizedLandmarks);
  const croppedLandmarks = (() => {
    const pts: { x: number; y: number }[] = [];
    const lm = args.primary.landmarks;
    for (let i = 0; i < 5; i++) {
      const px = lm[i * 2] ?? 0;
      const py = lm[i * 2 + 1] ?? 0;
      pts.push({
        x: Math.min(100, Math.max(0, ((px - crop.x) / Math.max(1, crop.side)) * 100)),
        y: Math.min(100, Math.max(0, ((py - crop.y) / Math.max(1, crop.side)) * 100)),
      });
    }
    return pts;
  })();

  const allFaces = args.detections.map((det) => ({
    box: det.bbox,
    normalizedBox: hudBoxFromScrfd(det.normalizedBox),
    normalizedLandmarks: hudLandmarksFromScrfd(det.normalizedLandmarks),
    confidence: det.confidence,
    score: det.score,
    isPrimary: det === args.primary,
  }));
  if (!allFaces.some((face) => face.isPrimary) && allFaces[0]) {
    allFaces[0].isPrimary = true;
  }

  const telemetry: FaceTelemetry = {
    originalWidth: srcW,
    originalHeight: srcH,
    downscaledWidth: srcW,
    downscaledHeight: srcH,
    faceCount: args.detections.length,
    primaryConfidence: args.primary.confidence,
    latencies: args.latencies,
    frontalizationMethod: args.frontalizationMethod,
    estimatedYaw: args.primary.pose.yaw,
    estimatedPitch: args.primary.pose.pitch,
    estimatedRoll: args.primary.pose.roll,
    smileIntensity: args.primary.smile?.smileIntensity,
  };

  return {
    descriptor: args.embedding,
    age: Number.NaN,
    gender: "unknown",
    genderProbability: 0,
    faceCanvas,
    confidence: args.primary.confidence,
    sharpness,
    blurScore: Math.min(1, sharpness / 65),
    illumination,
    box: args.primary.bbox,
    normalizedBox: hudBoxFromScrfd(args.primary.normalizedBox),
    normalizedLandmarks,
    croppedLandmarks,
    imageWidth: srcW,
    imageHeight: srcH,
    landmarks: args.primary.landmarks,
    allFaces,
    candidateBoxes: allFaces.map((face) => ({
      ...face.normalizedBox,
      isPrimary: face.isPrimary,
    })),
    telemetry,
    stageLatencies: args.latencies,
  };
}
