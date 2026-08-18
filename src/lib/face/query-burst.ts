import { analyzeImageQuality } from "./quality.ts";
import { computeCentroidEmbedding } from "./gallery-dedupe.ts";

/** Camera snap captures this many frames before ranking. */
export const BURST_CAPTURE_COUNT = 10;
/** Always try to keep at least this many frames when they exist. */
export const BURST_KEEP_MIN = 3;
/** Embed at most this many of the sharpest frames. */
export const BURST_KEEP_MAX = 5;
/** Wall-clock window for the live camera burst. */
export const BURST_DURATION_MS = 450;

export const BURST_SHARPNESS_WEIGHT = 0.75;
export const BURST_COVERAGE_WEIGHT = 0.25;

export interface BurstScore {
  sharpness: number;
  coverage: number;
  quality: number;
  composite: number;
}

export interface BurstCandidate {
  sharpness: number;
  coverage?: number;
  quality?: number;
  composite?: number;
  id?: string;
}

export interface RankBurstOptions {
  keep?: number;
}

export function scoreBurstCandidate(input: {
  sharpness: number;
  coverage?: number;
}): number {
  const sharpness = clamp01(input.sharpness);
  const coverage = clamp01(input.coverage ?? 1);
  return BURST_SHARPNESS_WEIGHT * sharpness + BURST_COVERAGE_WEIGHT * coverage;
}

export function burstKeepCount(
  available: number,
  keep = BURST_KEEP_MAX,
): number {
  if (available <= 0) return 0;
  const target = Math.min(Math.max(1, keep), BURST_KEEP_MAX);
  if (available <= BURST_KEEP_MIN) return available;
  return Math.min(target, available);
}

export function rankBurstCandidates<T extends BurstCandidate>(
  frames: T[],
  options: RankBurstOptions = {},
): T[] {
  const scored = frames.map((frame) => ({
    frame,
    composite: scoreBurstCandidate(frame),
  }));
  scored.sort((a, b) => b.composite - a.composite);
  const keep = options.keep ?? scored.length;
  return scored.slice(0, Math.max(0, keep)).map((row) => row.frame);
}

export function scoreBurstImageData(
  imageData: ImageData,
  coverage = 1,
): BurstScore {
  const metrics = analyzeImageQuality(imageData);
  const sharpness = metrics.sharpnessScore;
  const quality = metrics.overallQuality;
  return {
    sharpness,
    coverage: clamp01(coverage),
    quality,
    composite: scoreBurstCandidate({ sharpness, coverage }),
  };
}

/**
 * Laplacian score of a canvas. Downscales so a 720p burst stays cheap —
 * this is the ranking pass, not another SCRFD run.
 */
export function scoreBurstCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  coverage = 1,
  maxSide = 192,
): BurstScore {
  const imageData = imageDataFromCanvas(canvas, maxSide);
  if (!imageData) {
    return {
      sharpness: 0,
      coverage: clamp01(coverage),
      quality: 0,
      composite: scoreBurstCandidate({ sharpness: 0, coverage }),
    };
  }
  return scoreBurstImageData(imageData, coverage);
}

export function rankBurstCanvases(
  canvases: Array<HTMLCanvasElement | OffscreenCanvas>,
  options: RankBurstOptions = {},
): Array<{ canvas: HTMLCanvasElement | OffscreenCanvas; score: BurstScore }> {
  const scored = canvases.map((canvas) => ({
    canvas,
    score: scoreBurstCanvas(canvas),
  }));
  scored.sort((a, b) => b.score.composite - a.score.composite);
  const keep = options.keep ?? burstKeepCount(scored.length);
  return scored.slice(0, Math.max(0, keep));
}

export type BurstDrawable =
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | OffscreenCanvas;

export function scoreBurstDrawable(
  source: BurstDrawable,
  coverage = 1,
): BurstScore {
  if (isCanvasLike(source)) return scoreBurstCanvas(source, coverage);
  const drawn = drawDrawableToCanvas(source);
  if (!drawn) {
    return {
      sharpness: 0,
      coverage: clamp01(coverage),
      quality: 0,
      composite: scoreBurstCandidate({ sharpness: 0, coverage }),
    };
  }
  return scoreBurstCanvas(drawn, coverage);
}

export function rankBurstDrawables<T extends BurstDrawable>(
  sources: T[],
  options: RankBurstOptions = {},
): Array<{ source: T; index: number; score: BurstScore }> {
  const scored = sources.map((source, index) => ({
    source,
    index,
    score: scoreBurstDrawable(source),
  }));
  scored.sort((a, b) => {
    const delta = b.score.composite - a.score.composite;
    return delta !== 0 ? delta : a.index - b.index;
  });
  const keep = options.keep ?? burstKeepCount(scored.length);
  return scored.slice(0, Math.max(0, keep));
}

function isCanvasLike(
  source: BurstDrawable,
): source is HTMLCanvasElement | OffscreenCanvas {
  return (
    (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas)
  );
}

function drawDrawableToCanvas(
  source: HTMLImageElement | HTMLVideoElement,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  let w = 0;
  let h = 0;
  if ("videoWidth" in source && source.videoWidth) {
    w = source.videoWidth;
    h = source.videoHeight;
  } else if ("naturalWidth" in source) {
    w = source.naturalWidth || source.width;
    h = source.naturalHeight || source.height;
  }
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

export function averageQueryEmbeddings(
  vectors: ArrayLike<number>[],
): Float32Array {
  return computeCentroidEmbedding(vectors);
}

export function drawVideoFrameToCanvas(
  video: HTMLVideoElement,
  mirror = false,
): HTMLCanvasElement {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function captureVideoBurst(
  video: HTMLVideoElement,
  options: {
    count?: number;
    durationMs?: number;
    mirror?: boolean;
  } = {},
): Promise<HTMLCanvasElement[]> {
  const count = options.count ?? BURST_CAPTURE_COUNT;
  const durationMs = options.durationMs ?? BURST_DURATION_MS;
  const mirror = options.mirror ?? false;
  const frames: HTMLCanvasElement[] = [];
  const interval = count <= 1 ? 0 : durationMs / (count - 1);
  for (let i = 0; i < count; i++) {
    frames.push(drawVideoFrameToCanvas(video, mirror));
    if (i < count - 1 && interval > 0) {
      await sleep(interval);
    }
  }
  return frames;
}

export function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Capture failed"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

function imageDataFromCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  maxSide: number,
): ImageData | null {
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (srcW < 2 || srcH < 2) return null;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(2, Math.round(srcW * scale));
  const h = Math.max(2, Math.round(srcH * scale));

  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null =
    null;
  if (scale === 1 && "getContext" in canvas) {
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) return ctx.getImageData(0, 0, srcW, srcH);
  }

  let scratch: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    scratch = new OffscreenCanvas(w, h);
    ctx = scratch.getContext("2d", { willReadFrequently: true });
  } else if (typeof document !== "undefined") {
    scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    ctx = scratch.getContext("2d", { willReadFrequently: true });
  } else {
    return null;
  }
  if (!ctx) return null;
  ctx.drawImage(canvas as CanvasImageSource, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
