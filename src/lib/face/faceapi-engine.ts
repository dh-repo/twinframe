/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FaceStageLatencies, FaceTelemetry } from "./types";
import { applyLocalContrastBoost, applyClaheCanvas } from "./clahe";
export { applyLocalContrastBoost, applyClaheCanvas };
import {
  isValidHumanFaceLandmarks68,
  extract5AnchorPoints,
  compute5PointAffineTransform,
  warp5PointCanonicalCanvas,
  CANONICAL_5_POINTS_150,
} from "./geometry";
import { cropNeedsIlluminationNorm } from "./quality";

type FaceApiModule = typeof import("@vladmandic/face-api");

let faceApiMod: FaceApiModule | null = null;
let loadPromise: Promise<FaceApiModule> | null = null;
let detectorApi: FaceApiModule | null = null;
let detectorOnlyPromise: Promise<FaceApiModule> | null = null;
let detectorReady = false;

const MODEL_URL = "/models/face-api";

/**
 * Synthetic canvas face / landmark fallbacks exist only for unit fixtures.
 * Production and default detection keep this false so PRE/E2E paths cannot
 * silently pass via skin-color heuristics when models miss.
 */
let allowSyntheticDetection = false;

export function setAllowSyntheticDetection(enabled: boolean): void {
  allowSyntheticDetection = enabled;
}

export function isSyntheticDetectionAllowed(): boolean {
  return allowSyntheticDetection;
}

export type DetectorBackend =
  | "ssd"
  | "clahe-ssd"
  | "tiny"
  | "tile-ssd"
  | "synthetic"
  | "none";

async function importFaceApi(): Promise<any> {
  try {
    const mod = await import("@vladmandic/face-api");
    return (mod as any).default?.nets ? (mod as any).default : mod;
  } catch {
    return {
      nets: {
        ssdMobilenetv1: { loadFromUri: async () => {}, isLoaded: false },
        faceLandmark68Net: { loadFromUri: async () => {}, isLoaded: false },
        tinyFaceDetector: { loadFromUri: async () => {}, isLoaded: false },
        faceRecognitionNet: { loadFromUri: async () => {}, isLoaded: false },
        ageGenderNet: { loadFromUri: async () => {}, isLoaded: false },
      },
      detectAllFaces: async () => [],
      detectSingleFace: () => ({ withFaceLandmarks: async () => null }),
      tf: null,
    };
  }
}

async function configureTfBackend(api: any): Promise<void> {
  try {
    const tf = api?.tf;
    if (!tf?.setBackend) return;
    const backendPromise = (async () => {
      await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
      await tf.ready?.();
    })();

    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(() => {
        void tf.setBackend("cpu").catch(() => {});
        resolve();
      }, 1200),
    );

    await Promise.race([backendPromise, timeoutPromise]);
  } catch {
    /* backend optional */
  }
}

/**
 * Fast path: SSD (+ Tiny) only — enough for crop-review face boxes.
 * Avoids downloading ~7MB of recognition/age nets before the user even approves.
 */
async function getFaceApiDetector(): Promise<FaceApiModule> {
  if (typeof window === "undefined" && !(globalThis as any).window) {
    throw new Error("Face recognition only runs in the browser.");
  }
  if (faceApiMod) return faceApiMod;
  if (detectorApi) return detectorApi;
  if (detectorOnlyPromise) return detectorOnlyPromise;

  detectorOnlyPromise = (async () => {
    const api = await importFaceApi();
    await configureTfBackend(api);
    await Promise.all([
      api.nets.ssdMobilenetv1.loadFromUri(MODEL_URL).catch(() => {}),
      api.nets.faceLandmark68Net.loadFromUri(MODEL_URL).catch(() => {}),
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URL).catch(() => {}),
    ]);
    detectorReady = true;
    detectorApi = api as FaceApiModule;
    return detectorApi;
  })().catch((err) => {
    detectorOnlyPromise = null;
    throw err;
  });

  return detectorOnlyPromise;
}

async function getFaceApi(): Promise<FaceApiModule> {
  if (typeof window === "undefined" && !(globalThis as any).window) {
    throw new Error("Face recognition only runs in the browser.");
  }
  if (faceApiMod) return faceApiMod;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const api = await importFaceApi();
    await configureTfBackend(api);
    // Ensure detector nets first, then the rest
    await Promise.all([
      api.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URL).catch(() => {}),
    ]);
    detectorReady = true;
    await Promise.all([
      api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      api.nets.ageGenderNet.loadFromUri(MODEL_URL),
    ]);
    faceApiMod = api as FaceApiModule;
    return faceApiMod;
  })().catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}

export async function loadFaceApi(): Promise<FaceApiModule> {
  return getFaceApi();
}

export function prefetchFaceApi(): void {
  if (typeof window === "undefined") return;
  // Prefetch detector nets only — keeps first paint snappy
  void getFaceApiDetector().catch(() => {});
}

/** Yield so React can paint progress between heavy passes. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export interface FaceCandidate {
  /** Unscaled bounding box in original source image pixels */
  box: { x: number; y: number; width: number; height: number };
  /** Normalized bounding box in percentage [0..100%] of image width and height */
  normalizedBox: { x: number; y: number; width: number; height: number };
  /** Normalized 68 facial landmark coordinates in [0..100%] percentage */
  normalizedLandmarks?: { x: number; y: number }[];
  /** Detector confidence score (0.0 to 1.0) */
  confidence: number;
  /** Composite ranking score (combining area, center proximity, confidence) */
  score: number;
  /** Whether this candidate is selected as the primary face for doppelgänger matching */
  isPrimary: boolean;
  /** Candidate age estimate */
  age?: number;
  /** Candidate gender estimate */
  gender?: "male" | "female";
  /** Candidate gender probability */
  genderProbability?: number;
}

export interface DetectOptions {
  /** Index of candidate face to select as primary (default: 0 = highest composite score) */
  selectedCandidateIndex?: number;
  /** Selected face bounding box (normalized or unscaled) to match as primary candidate */
  selectedBox?: { x: number; y: number; width: number; height: number };
  /** Maximum side dimension for canvas downscaling (default: 800) */
  maxSide?: number;
  /** Enable CLAHE / local contrast adjustment pass for outdoor/sunset lighting (default: true) */
  enableContrastBoost?: boolean;
  /** Fast-exit confidence threshold (default: 0.70) */
  fastExitConfidence?: number;
  /** Skip flip/tight-scale TTA (burst frames). */
  tta?: boolean;
}

export interface FaceCandidateInput {
  id?: string;
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
  landmarks?: { x: number; y: number }[];
}

export interface SortedFaceCandidate extends FaceCandidateInput {
  score: number;
  isPrimary: boolean;
  normalizedBox?: { x: number; y: number; width: number; height: number };
  normalizedLandmarks?: { x: number; y: number }[];
}

export interface FaceDetectionResult {
  descriptor: Float32Array | number[];
  /**
   * Optional multi-template query descriptors (e.g. primary + horizontal flip).
   * Rankers should take min distance across templates for better pose robustness.
   */
  descriptors?: Array<Float32Array | number[]>;
  age: number;
  gender: "male" | "female";
  genderProbability: number;
  faceCanvas: HTMLCanvasElement;
  /**
   * Canvas actually passed to FaceNet. Dlib-aligned 150×150 when landmarks
   * support `align({ useDlibAlignment: true })`; otherwise the padded preview crop.
   */
  embedCanvas?: HTMLCanvasElement;
  alignment?: "dlib" | "padded-box";
  confidence: number;
  sharpness: number;
  blurScore: number;
  illumination: number;
  box: { x: number; y: number; width: number; height: number };
  normalizedBox?: { x: number; y: number; width: number; height: number };
  normalizedLandmarks?: { x: number; y: number }[];
  croppedLandmarks?: { x: number; y: number }[];
  imageWidth: number;
  imageHeight: number;
  landmarks?: unknown;
  /** All detected face candidates in group / multi-person photos */
  allFaces?: FaceCandidate[];
  /** Candidate face reticle boxes formatted for HUD rendering */
  candidateBoxes?: Array<{ x: number; y: number; width: number; height: number; isPrimary: boolean }>;
  /** Diagnostic stage telemetry and image dimensions */
  telemetry?: FaceTelemetry;
  /** Stage latency breakdown in milliseconds */
  stageLatencies?: FaceStageLatencies;
}

/**
 * Formatted console telemetry logger [Twinframe Telemetry]
 */
export function logFaceTelemetry(telemetry: FaceTelemetry): void {
  const {
    originalWidth,
    originalHeight,
    downscaledWidth,
    downscaledHeight,
    faceCount,
    primaryConfidence,
    latencies,
  } = telemetry;

  console.log(
    `%c[Twinframe Telemetry]%c Image: ${originalWidth}x${originalHeight} -> Canvas: ${downscaledWidth}x${downscaledHeight} (${latencies.downscaleMs}ms) | SSD: ${latencies.ssdPassMs}ms (${faceCount} face${faceCount === 1 ? "" : "s"}, conf: ${(primaryConfidence * 100).toFixed(0)}%) | CLAHE: ${latencies.claheMs}ms | Embedding: ${latencies.embeddingMs}ms | Model: ${latencies.modelLoadMs}ms | Total: ${latencies.totalMs}ms`,
    "color: #38bdf8; font-weight: bold;",
    "color: inherit;",
  );
}

function sourceSize(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): { w: number; h: number } {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return { w: source.videoWidth, h: source.videoHeight };
  }
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return {
      w: source.naturalWidth || source.width,
      h: source.naturalHeight || source.height,
    };
  }
  const s = source as any;
  return {
    w: s.videoWidth || s.naturalWidth || s.width || 0,
    h: s.videoHeight || s.naturalHeight || s.height || 0,
  };
}

/** IoU of two axis-aligned boxes in the same coordinate space. */
export function boxIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Non-max suppression: keep highest-confidence boxes, drop heavy overlaps. */
export function nmsFaceBoxes(
  boxes: Array<{ box: { x: number; y: number; width: number; height: number }; confidence: number }>,
  iouThreshold = 0.4,
): typeof boxes {
  const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
  const kept: typeof boxes = [];
  for (const cand of sorted) {
    if (cand.box.width < 2 || cand.box.height < 2) continue;
    const overlaps = kept.some((k) => boxIoU(k.box, cand.box) >= iouThreshold);
    if (!overlaps) kept.push(cand);
  }
  return kept;
}

/**
 * Downscale image onto a canvas for detection.
 * Phone JPEGs: createImageBitmap with resizeWidth/Height so we never allocate a 24MP buffer.
 * `scale` maps detection-canvas pixels → naturalWidth/Height space used by the UI.
 */
async function rasterizeSource(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  maxSide: number,
): Promise<{ canvas: HTMLCanvasElement; scale: number; w: number; h: number }> {
  const { w, h } = sourceSize(source);
  if (!w || !h) {
    const empty = document.createElement("canvas");
    empty.width = 1;
    empty.height = 1;
    return { canvas: empty, scale: 1, w: 1, h: 1 };
  }

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { canvas, scale, w, h };
  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";

  if (typeof createImageBitmap === "function" && typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    try {
      const bmpPromise = createImageBitmap(source, {
        resizeWidth: cw,
        resizeHeight: ch,
        resizeQuality: "high",
        ...({ imageOrientation: "from-image" } as object),
      } as ImageBitmapOptions);

      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 400));
      const bmp = await Promise.race([bmpPromise, timeoutPromise]);

      if (bmp) {
        if (bmp.width !== cw || bmp.height !== ch) {
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          ctx.drawImage(bmp, 0, 0);
          const s = Math.min(bmp.width / w, bmp.height / h);
          bmp.close();
          return { canvas, scale: s > 0 ? s : scale, w, h };
        }
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        return { canvas, scale, w, h };
      }
    } catch {
      /* fall through */
    }
  }

  // Fast 2-stage downscale for huge images (e.g. >2000px wide 24MP photos)
  if (Math.max(w, h) > 2000 && typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    try {
      const stageScale = 1400 / Math.max(w, h);
      const sw = Math.round(w * stageScale);
      const sh = Math.round(h * stageScale);
      const stageCanvas = document.createElement("canvas");
      stageCanvas.width = sw;
      stageCanvas.height = sh;
      const sctx = stageCanvas.getContext("2d");
      if (sctx) {
        sctx.drawImage(source, 0, 0, sw, sh);
        ctx.drawImage(stageCanvas, 0, 0, cw, ch);
        return { canvas, scale, w, h };
      }
    } catch {
      /* fall through */
    }
  }

  ctx.drawImage(source as CanvasImageSource, 0, 0, cw, ch);
  return { canvas, scale, w, h };
}

/** Mean luminance 0–1 for a quick empty/black canvas check. */
function canvasMeanLuma(canvas: HTMLCanvasElement): number {
  const s = 32;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0.5;
  ctx.drawImage(canvas, 0, 0, s, s);
  const data = ctx.getImageData(0, 0, s, s).data;
  let sum = 0;
  for (let i = 0; i < s * s; i++) {
    sum += 0.299 * (data[i * 4] ?? 0) + 0.587 * (data[i * 4 + 1] ?? 0) + 0.114 * (data[i * 4 + 2] ?? 0);
  }
  return sum / (s * s) / 255;
}

/**
 * Calculates candidate face composite score based on confidence, area, and distance to image center.
 * Formula: score = confidence * (area / (1 + 0.3 * distanceToCenter))
 */
export function scoreCandidateFace(
  box: { x: number; y: number; width: number; height: number },
  confidence: number,
  imageDimensions: { width: number; height: number },
): number {
  const centerX = imageDimensions.width / 2;
  const centerY = imageDimensions.height / 2;
  const boxCenterX = box.x + box.width / 2;
  const boxCenterY = box.y + box.height / 2;
  const distFromCenter = Math.hypot(boxCenterX - centerX, boxCenterY - centerY);
  const diagonal = Math.hypot(imageDimensions.width, imageDimensions.height) || 1;
  const normalizedDist = distFromCenter / diagonal;
  const area = box.width * box.height;
  const safeConfidence = Number.isFinite(confidence) && confidence >= 0 ? confidence : 0.5;
  return safeConfidence * (area / (1 + normalizedDist * 1.5));
}

/**
 * Sorts detected face candidates in descending order of score and marks the top face as primary.
 */
export function sortFaceCandidates(
  candidates: FaceCandidateInput[],
  imageDimensions: { width: number; height: number },
): SortedFaceCandidate[] {
  const scored = candidates.map((c) => ({
    ...c,
    score: scoreCandidateFace(c.box, c.confidence, imageDimensions),
    isPrimary: false,
  }));

  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0) {
    scored[0]!.isPrimary = true;
  }
  return scored;
}



// ---- High-accuracy helpers ----

function l2NormalizeVec(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] ?? 0) * (v[i] ?? 0);
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) / norm;
  return out;
}

function computeSharpness(canvas: HTMLCanvasElement): { sharpness: number; illumination: number } {
  // Fast 64x64 grayscale Laplacian variance
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { sharpness: 50, illumination: 0.5 };
  ctx.drawImage(canvas, 0, 0, s, s);
  const data = ctx.getImageData(0, 0, s, s).data;
  const gray = new Float32Array(s * s);
  let sum = 0;
  for (let i = 0; i < s * s; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = lum;
    sum += lum;
  }
  const mean = sum / gray.length;
  // Laplacian kernel response
  let lapSum = 0;
  let lapSq = 0;
  for (let y = 1; y < s - 1; y++) {
    for (let x = 1; x < s - 1; x++) {
      const idx = y * s + x;
      const c0 = gray[idx] ?? 0;
      const lap = (gray[idx - s] ?? 0) + (gray[idx + s] ?? 0) + (gray[idx - 1] ?? 0) + (gray[idx + 1] ?? 0) - 4 * c0;
      lapSum += lap;
      lapSq += lap * lap;
    }
  }
  const n = (s - 2) * (s - 2);
  const variance = Math.max(0, lapSq / n - (lapSum / n) * (lapSum / n));
  // variance 0-1000 typical; map to 0-100 sharpness
  const sharpness = Math.min(100, Math.max(0, variance / 12));
  const illumination = Math.min(1, Math.max(0, mean / 255));
  return { sharpness, illumination };
}

function averageDescriptors(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const n = Math.min(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ((a[i] ?? 0) + (b[i] ?? 0)) / 2;
  return l2NormalizeVec(out);
}

function createPaddedCanvas(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  maxSide = 800,
  padPct = 0.20,
): { canvas: HTMLCanvasElement; scale: number; padX: number; padY: number } {
  const { w, h } = sourceSize(source);
  const baseScale = Math.min(1, maxSide / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * baseScale));
  const sh = Math.max(1, Math.round(h * baseScale));
  const padX = Math.round(sw * padPct);
  const padY = Math.round(sh * padPct);

  const canvas = document.createElement("canvas");
  canvas.width = sw + padX * 2;
  canvas.height = sh + padY * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.fillStyle = "#121420";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
    ctx.drawImage(source, padX, padY, sw, sh);
  }
  return { canvas, scale: baseScale, padX, padY };
}

/**
 * Horizontal flip of a crop canvas (TTA helper). Pure canvas ops — used by
 * detectAndDescribeWithTTA and unit tests that must exercise real flip code.
 */
export function createHorizontalFlipCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const fctx = canvas.getContext("2d");
  if (fctx) {
    fctx.translate(canvas.width, 0);
    fctx.scale(-1, 1);
    fctx.drawImage(source as CanvasImageSource, 0, 0);
  }
  return canvas;
}

/**
 * Tight scale crop of a face canvas (TTA helper).
 * Scales box around center (default 0.85x scale box / 1.15x zoom around center (75, 75)).
 * Pure canvas ops — used by detectAndDescribeWithTTA and unit tests.
 */
export function createTightScaleCanvas(
  source: HTMLCanvasElement,
  outSize = FACENET_EMBED_SIZE,
  scaleFactor = 0.85,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
    const srcW = source.width;
    const srcH = source.height;
    const boxW = srcW * scaleFactor;
    const boxH = srcH * scaleFactor;
    const sx = (srcW - boxW) / 2;
    const sy = (srcH - boxH) / 2;
    ctx.drawImage(source as CanvasImageSource, sx, sy, boxW, boxH, 0, 0, outSize, outSize);
  }
  return canvas;
}

/** FaceNet nn4.small2 native input. Prefer this over the padded 320 preview crop. */
export const FACENET_EMBED_SIZE = 150;

export type FaceAlignBox = { x: number; y: number; width: number; height: number };

/**
 * Dlib eye–mouth alignment box in the same pixel space as `landmarks`.
 * Returns null when the face-api landmark object is missing or stubbed.
 */
export function dlibAlignBoxFromLandmarks(landmarks: unknown): FaceAlignBox | null {
  const lm = landmarks as { align?: (det: null, opts: { useDlibAlignment: boolean }) => any } | null;
  if (!lm || typeof lm.align !== "function") return null;
  try {
    const box = lm.align(null, { useDlibAlignment: true });
    if (!box) return null;
    const x = Number(box.x ?? box._x ?? 0);
    const y = Number(box.y ?? box._y ?? 0);
    const width = Number(box.width ?? box._width ?? 0);
    const height = Number(box.height ?? box._height ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || width < 8 || height < 8) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

/** Draw a source-space box into a square canvas (FaceNet embed input). */
export function extractRegionToCanvas(
  source: CanvasImageSource,
  box: FaceAlignBox,
  srcW: number,
  srcH: number,
  outSize = FACENET_EMBED_SIZE,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  const sx = Math.max(0, box.x);
  const sy = Math.max(0, box.y);
  const sw = Math.max(1, Math.min(srcW - sx, box.width));
  const sh = Math.max(1, Math.min(srcH - sy, box.height));
  if (sw >= 2 && sh >= 2 && srcW > 0 && srcH > 0) {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outSize, outSize);
  }
  return canvas;
}

export function extractCenterFaceCanvas(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  outSize = 320,
): HTMLCanvasElement {
  const { w, h } = sourceSize(source);
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
    const minDim = Math.min(w, h);
    const cropW = minDim * 0.75;
    const cropH = minDim * 0.75;
    const sx = (w - cropW) / 2;
    const sy = Math.max(0, (h - cropH) * 0.35);
    ctx.drawImage(source, Math.max(0, sx), Math.max(0, sy), Math.min(w, cropW), Math.min(h, cropH), 0, 0, outSize, outSize);
  }
  return canvas;
}

function generateImageRegionDescriptor(canvas: HTMLCanvasElement): Float32Array {
  const s = 16;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const desc = new Float32Array(128);
  if (!ctx) return l2NormalizeVec(desc);
  ctx.drawImage(canvas, 0, 0, s, s);
  const data = ctx.getImageData(0, 0, s, s).data;
  for (let i = 0; i < 128; i++) {
    const idx = (i * 2) % (s * s);
    const r = data[idx * 4] ?? 128;
    const g = data[idx * 4 + 1] ?? 128;
    const b = data[idx * 4 + 2] ?? 128;
    desc[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0 - 0.5;
  }
  return l2NormalizeVec(desc);
}

type ScoredRawCandidate = {
  raw: any;
  candidate: FaceCandidate;
};

/** Map raw face-api detections into scored candidates in original image coordinates. */
function mapRawDetections(
  rawDetections: any[],
  imgW: number,
  imgH: number,
  activeScale: number,
  offsetX: number,
  offsetY: number,
  options: DetectOptions,
): { scored: ScoredRawCandidate[]; primaryIndex: number } {
  const scored: ScoredRawCandidate[] = rawDetections.map((raw: any) => {
    const bBox = raw.detection.box;
    const conf = raw.detection.score ?? 0.5;

    const unscaledBox = {
      x: Math.max(0, (bBox.x - offsetX) / activeScale),
      y: Math.max(0, (bBox.y - offsetY) / activeScale),
      width: bBox.width / activeScale,
      height: bBox.height / activeScale,
    };

    const score = scoreCandidateFace(unscaledBox, conf, { width: imgW, height: imgH });

    const normalizedBox = {
      x: Math.min(100, Math.max(0, (unscaledBox.x / imgW) * 100)),
      y: Math.min(100, Math.max(0, (unscaledBox.y / imgH) * 100)),
      width: Math.min(100, Math.max(0, (unscaledBox.width / imgW) * 100)),
      height: Math.min(100, Math.max(0, (unscaledBox.height / imgH) * 100)),
    };

    const normalizedLandmarks: { x: number; y: number }[] = [];
    if (raw.landmarks && Array.isArray(raw.landmarks.positions)) {
      for (const pt of raw.landmarks.positions) {
        const px = ((pt._x ?? pt.x) - offsetX) / activeScale;
        const py = ((pt._y ?? pt.y) - offsetY) / activeScale;
        normalizedLandmarks.push({
          x: Math.min(100, Math.max(0, (px / imgW) * 100)),
          y: Math.min(100, Math.max(0, (py / imgH) * 100)),
        });
      }
    }

    return {
      raw,
      candidate: {
        box: unscaledBox,
        normalizedBox,
        normalizedLandmarks,
        confidence: conf,
        score,
        isPrimary: false,
        age: Math.round(raw.age ?? 30),
        gender: (raw.gender ?? "male") as "male" | "female",
        genderProbability: raw.genderProbability ?? 0.85,
      } as FaceCandidate,
    };
  });

  scored.sort((a, b) => b.candidate.score - a.candidate.score);

  let primaryIndex = 0;
  if (options.selectedBox && scored.length > 0) {
    let bestMatchIdx = 0;
    let minCenterDist = Infinity;
    const sb = options.selectedBox;
    // Accept either normalized [0..100] or pixel-ish boxes (width > 1.5 → treat as %)
    const looksNormalized = sb.width <= 100 && sb.height <= 100 && sb.x <= 100 && sb.y <= 100;
    const sbCenter = looksNormalized
      ? { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 }
      : {
          x: ((sb.x + sb.width / 2) / imgW) * 100,
          y: ((sb.y + sb.height / 2) / imgH) * 100,
        };
    scored.forEach((item, idx) => {
      const nb = item.candidate.normalizedBox;
      const cCenter = { x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 };
      const dist = Math.hypot(cCenter.x - sbCenter.x, cCenter.y - sbCenter.y);
      if (dist < minCenterDist) {
        minCenterDist = dist;
        bestMatchIdx = idx;
      }
    });
    primaryIndex = bestMatchIdx;
  } else if (options.selectedCandidateIndex !== undefined && scored.length > 0) {
    primaryIndex = Math.min(scored.length - 1, Math.max(0, options.selectedCandidateIndex));
  }

  scored.forEach((item, idx) => {
    item.candidate.isPrimary = idx === primaryIndex;
  });

  return { scored, primaryIndex };
}

export interface DetectFacesOnlyResult {
  faces: FaceCandidate[];
  imageWidth: number;
  imageHeight: number;
  /** Working detection canvas (oriented + downscaled) */
  detectionCanvas: HTMLCanvasElement;
  detectionScale: number;
  /** Which detector stage produced the kept boxes (for integrity assertions). */
  detectorBackend: DetectorBackend;
  latencies: { modelLoadMs: number; detectMs: number; claheMs?: number; totalMs: number };
}

/**
 * Fast multi-face box detection for crop review + pipeline.
 * Designed to stay under ~2s after models are warm on phone JPEGs.
 *
 * Strategy (early-exit):
 *  1. EXIF-oriented downscale ≤ 800px
 *  2. SSD once
 *  3. If empty → CLAHE + SSD
 *  4. If empty → TinyFace
 *  5. If still empty on large images → 3 column tiles
 */
export async function detectFacesOnly(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: DetectOptions = {},
): Promise<DetectFacesOnlyResult> {
  const t0 = performance.now();
  const tModel = performance.now();
  // Detector-only nets — do NOT wait on FaceNet/age models for crop UI
  const api = (await getFaceApiDetector()) as any;
  const modelLoadMs = Math.round(performance.now() - tModel);

  // Cap hard — 800 is enough for SSD group faces and keeps 24MP phone photos snappy
  const maxSide = Math.min(options.maxSide ?? 800, 960);
  const enableClahe = options.enableContrastBoost !== false;

  await yieldToUi();
  const primary = await rasterizeSource(source, maxSide);
  let { w, h, scale: primaryScale, canvas: primaryCanvas } = primary;

  // Black canvas recovery (failed decode / orientation)
  if (canvasMeanLuma(primaryCanvas) < 0.02) {
    const retry = document.createElement("canvas");
    const { w: rw, h: rh } = sourceSize(source);
    const s = Math.min(1, maxSide / Math.max(rw, rh, 1));
    retry.width = Math.max(1, Math.round(rw * s));
    retry.height = Math.max(1, Math.round(rh * s));
    const rctx = retry.getContext("2d");
    if (rctx) {
      (rctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
      rctx.drawImage(source as CanvasImageSource, 0, 0, retry.width, retry.height);
      primaryCanvas = retry;
      primaryScale = s;
      w = rw;
      h = rh;
    }
  }

  type RawBox = { box: { x: number; y: number; width: number; height: number }; confidence: number };
  const collected: RawBox[] = [];
  let detectorBackend: DetectorBackend = "none";

  const pushRaw = (
    rawList: any[] | null | undefined,
    scaleToOrig: number,
    offX = 0,
    offY = 0,
    minConf = 0.20,
    backend?: DetectorBackend,
  ) => {
    if (!rawList?.length) return;
    let added = 0;
    for (const raw of rawList) {
      const b = raw.detection?.box ?? raw.box;
      const conf = Number(raw.detection?.score ?? raw.score ?? 0.5);
      if (!b || !Number.isFinite(conf) || conf < Math.max(0.20, minConf)) continue;
      const box = {
        x: Math.max(0, (b.x - offX) / scaleToOrig),
        y: Math.max(0, (b.y - offY) / scaleToOrig),
        width: b.width / scaleToOrig,
        height: b.height / scaleToOrig,
      };
      if (box.width < 10 || box.height < 10) continue;
      const areaFrac = (box.width * box.height) / Math.max(1, w * h);
      // Allow near-full-frame close-ups (Hemsworth/Cavill). 0.98 was dropping them.
      if (areaFrac < 0.0003 || areaFrac > 1.05) continue;
      const aspect = box.width / Math.max(1, box.height);
      if (aspect < 0.5 || aspect > 2.0) continue;
      collected.push({ box, confidence: conf });
      added++;
    }
    if (added > 0 && backend && detectorBackend === "none") {
      detectorBackend = backend;
    }
  };

  const runSsd = async (canvas: HTMLCanvasElement, minConf: number) => {
    try {
      return await api.detectAllFaces(
        canvas,
        new api.SsdMobilenetv1Options({ minConfidence: Math.max(0.20, minConf) }),
      );
    } catch {
      return [];
    }
  };

  const tDetect = performance.now();
  const maxDetectBudgetMs = 3500; // Strict SLA cap for detection pass

  // Pass 1 — single full-frame SSD (the common case)
  await yieldToUi();
  pushRaw(await runSsd(primaryCanvas, 0.20), primaryScale, 0, 0, 0.20, "ssd");
  if (collected.length === 0) {
    pushRaw(await runSsd(primaryCanvas, 0.20), primaryScale, 0, 0, 0.20, "ssd");
  }

  let claheMs = 0;

  // Early exit: if Pass 1 found faces, DO NOT run subsequent heavy passes
  if (collected.length === 0) {
    // Pass 2 — CLAHE for sunset / backlit outdoor
    if (enableClahe && performance.now() - tDetect < maxDetectBudgetMs - 1500) {
      await yieldToUi();
      try {
        const tClaheStart = performance.now();
        const boosted = applyLocalContrastBoost(primaryCanvas, 2.5, 6, 384);
        claheMs = Math.round(performance.now() - tClaheStart);
        const claheScale = primaryScale * (boosted.width / Math.max(1, primaryCanvas.width));
        pushRaw(await runSsd(boosted, 0.20), claheScale, 0, 0, 0.20, "clahe-ssd");
      } catch {
        /* optional */
      }
    }

    // Padded SSD recovery — faces flush to image edges / tight crops
    if (collected.length === 0 && performance.now() - tDetect < maxDetectBudgetMs - 1200) {
      await yieldToUi();
      try {
        const padded = createPaddedCanvas(source, maxSide, 0.35);
        pushRaw(
          await runSsd(padded.canvas, 0.18),
          padded.scale,
          padded.padX,
          padded.padY,
          0.18,
          "ssd",
        );
      } catch {
        /* optional */
      }
    }

    // Pass 3 — TinyFace
    if (collected.length === 0 && api.nets.tinyFaceDetector?.isLoaded && performance.now() - tDetect < maxDetectBudgetMs - 800) {
      await yieldToUi();
      try {
        const tiny = await api.detectAllFaces(
          primaryCanvas,
          new api.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.15 }),
        );
        pushRaw(tiny, primaryScale, 0, 0, 0.20, "tiny");
      } catch {
        /* optional */
      }
    }

    // Pass 4 — 3 column tiles only if still empty (group / outdoor miss)
    if (collected.length === 0 && Math.max(w, h) >= 480 && performance.now() - tDetect < maxDetectBudgetMs - 500) {
      await yieldToUi();
      const pcW = primaryCanvas.width;
      const pcH = primaryCanvas.height;
      const colW = Math.round(pcW * 0.55);
      for (const sx of [0, Math.round(pcW * 0.225), Math.max(0, pcW - colW)]) {
        if (performance.now() - tDetect >= maxDetectBudgetMs) break;
        const tile = document.createElement("canvas");
        const localScale = Math.min(1, 480 / Math.max(colW, pcH));
        tile.width = Math.max(1, Math.round(colW * localScale));
        tile.height = Math.max(1, Math.round(pcH * localScale));
        const tctx = tile.getContext("2d");
        if (!tctx) continue;
        tctx.drawImage(primaryCanvas, sx, 0, colW, pcH, 0, 0, tile.width, tile.height);
        const scaleToOrig = localScale * primaryScale;
        pushRaw(await runSsd(tile, 0.20), scaleToOrig, -sx * localScale, 0, 0.20, "tile-ssd");
        if (collected.length > 0) break;
      }
    }

    // Fixture-only synthetic skin-color path (disabled in production by default)
    if (collected.length === 0 && allowSyntheticDetection) {
      const synFaces = detectSyntheticCanvasFaces(primaryCanvas, w, h);
      for (const sf of synFaces) {
        collected.push(sf);
      }
      if (synFaces.length > 0) detectorBackend = "synthetic";
    }
  }

  const detectMs = Math.round(performance.now() - tDetect);

  const strong = collected.filter((c) => c.confidence >= 0.25);
  const pool = strong.length > 0 ? strong : collected;
  const merged = nmsFaceBoxes(pool, 0.35);

  const faceInputs: FaceCandidateInput[] = merged.map((m, i) => ({
    id: `face-${i}`,
    box: m.box,
    confidence: m.confidence,
  }));

  let sorted = sortFaceCandidates(faceInputs, { width: w, height: h });
  sorted = [...sorted].sort((a, b) => {
    const confDelta = b.confidence - a.confidence;
    if (Math.abs(confDelta) > 0.08) return confDelta;
    return b.score - a.score;
  });
  sorted = sorted.map((f, i) => ({ ...f, isPrimary: i === 0 }));

  if (options.selectedBox && sorted.length > 1) {
    const sb = options.selectedBox;
    const looksNorm = sb.width <= 100 && sb.height <= 100 && sb.x <= 100 && sb.y <= 100;
    const cx = looksNorm ? sb.x + sb.width / 2 : ((sb.x + sb.width / 2) / w) * 100;
    const cy = looksNorm ? sb.y + sb.height / 2 : ((sb.y + sb.height / 2) / h) * 100;
    let best = 0;
    let bestD = Infinity;
    sorted.forEach((f, i) => {
      const d = Math.hypot(
        (f.box.x + f.box.width / 2) / w * 100 - cx,
        (f.box.y + f.box.height / 2) / h * 100 - cy,
      );
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    sorted = sorted.map((f, i) => ({ ...f, isPrimary: i === best }));
    if (best > 0) {
      const [p] = sorted.splice(best, 1);
      if (p) sorted.unshift({ ...p, isPrimary: true });
      sorted = sorted.map((f, i) => ({ ...f, isPrimary: i === 0 }));
    }
  } else if (options.selectedCandidateIndex !== undefined && sorted.length > 0) {
    const idx = Math.min(sorted.length - 1, Math.max(0, options.selectedCandidateIndex));
    sorted = sorted.map((f, i) => ({ ...f, isPrimary: i === idx }));
  }

  const faces: FaceCandidate[] = sorted.map((f) => ({
    box: f.box,
    normalizedBox: {
      x: Math.min(100, Math.max(0, (f.box.x / w) * 100)),
      y: Math.min(100, Math.max(0, (f.box.y / h) * 100)),
      width: Math.min(100, Math.max(0, (f.box.width / w) * 100)),
      height: Math.min(100, Math.max(0, (f.box.height / h) * 100)),
    },
    confidence: f.confidence,
    score: f.score,
    isPrimary: f.isPrimary,
  }));

  return {
    faces,
    imageWidth: w,
    imageHeight: h,
    detectionCanvas: primaryCanvas,
    detectionScale: primaryScale,
    detectorBackend: faces.length === 0 ? "none" : detectorBackend,
    latencies: {
      modelLoadMs,
      detectMs,
      claheMs,
      totalMs: Math.round(performance.now() - t0),
    },
  };
}

export function detectSyntheticCanvasFaces(
  canvas: HTMLCanvasElement,
  origWidth: number,
  origHeight: number,
): Array<{ box: { x: number; y: number; width: number; height: number }; confidence: number }> {
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    const w = canvas.width;
    const h = canvas.height;
    if (w < 10 || h < 10) return [];
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const gridStep = Math.max(4, Math.min(16, Math.round(Math.min(w, h) / 100)));
    const points: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < h; y += gridStep) {
      for (let x = 0; x < w; x += gridStep) {
        const i = (y * w + x) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        if (Math.abs(r - 224) <= 25 && Math.abs(g - 172) <= 25 && Math.abs(b - 105) <= 25) {
          points.push({ x, y });
        }
      }
    }

    if (points.length < 10) return [];

    const clusters: Array<{ points: Array<{ x: number; y: number }> }> = [];
    const visited = new Set<number>();
    const clusterDist = Math.max(20, gridStep * 2.5);

    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue;
      const cluster = [points[i]!];
      visited.add(i);

      for (let j = 0; j < cluster.length; j++) {
        const p1 = cluster[j]!;
        for (let k = 0; k < points.length; k++) {
          if (visited.has(k)) continue;
          const p2 = points[k]!;
          if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < clusterDist) {
            visited.add(k);
            cluster.push(p2);
          }
        }
      }

      if (cluster.length >= 10) {
        clusters.push({ points: cluster });
      }
    }

    const scaleX = origWidth / w;
    const scaleY = origHeight / h;

    return clusters.map((c) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of c.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const bw = maxX - minX + gridStep * 2;
      const bh = maxY - minY + gridStep * 2;
      const box = {
        x: Math.max(0, (cx - bw / 2) * scaleX),
        y: Math.max(0, (cy - bh / 2) * scaleY),
        width: bw * scaleX,
        height: bh * scaleY,
      };
      return { box, confidence: 0.90 };
    });
  } catch {
    return [];
  }
}

export function generateSynthetic68Landmarks(box: { x: number; y: number; width: number; height: number }): Array<{ x: number; y: number }> {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.height / 2;
  const w = box.width;
  const h = box.height;

  const pts: Array<{ x: number; y: number }> = [];

  for (let i = 0; i <= 16; i++) {
    const angle = Math.PI * (i / 16);
    const jx = cx - Math.cos(angle) * (w / 2);
    const jy = cy + Math.sin(angle) * (h / 2);
    pts.push({ x: jx, y: jy });
  }

  const eyeY = cy - r * 0.25;
  const lEyeX = cx - r * 0.35;
  const rEyeX = cx + r * 0.35;
  const eyeR = r * 0.12;

  for (let i = 0; i < 5; i++) {
    pts.push({ x: lEyeX - eyeR + (i * eyeR * 0.5), y: eyeY - eyeR * 1.3 });
  }
  for (let i = 0; i < 5; i++) {
    pts.push({ x: rEyeX - eyeR + (i * eyeR * 0.5), y: eyeY - eyeR * 1.3 });
  }

  const noseY = cy + r * 0.05;
  for (let i = 0; i < 4; i++) {
    pts.push({ x: cx, y: eyeY + (i / 3) * (noseY - eyeY) });
  }
  for (let i = 0; i < 5; i++) {
    pts.push({ x: cx - r * 0.1 + (i * r * 0.05), y: noseY });
  }

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push({ x: lEyeX + Math.cos(a) * eyeR, y: eyeY + Math.sin(a) * eyeR });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push({ x: rEyeX + Math.cos(a) * eyeR, y: eyeY + Math.sin(a) * eyeR });
  }

  const mouthY = cy + r * 0.45;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * (r * 0.28), y: mouthY + Math.sin(a) * (r * 0.08) });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * (r * 0.20), y: mouthY + Math.sin(a) * (r * 0.04) });
  }

  return pts;
}

/** Padded square around a face box in original-image pixels (same crop as faceCanvas). */
export function paddedFaceSquare(
  box: { x: number; y: number; width: number; height: number },
  imageW: number,
  imageH: number,
  pad = 0.35,
): { x: number; y: number; side: number } {
  const padX = box.width * pad;
  const padY = box.height * pad * 1.1;
  let cropX = Math.max(0, box.x - padX);
  let cropY = Math.max(0, box.y - padY);
  let cropW = Math.min(imageW - cropX, box.width + padX * 2);
  let cropH = Math.min(imageH - cropY, box.height + padY * 2.2);
  const side = Math.max(cropW, cropH);
  cropX = Math.max(0, Math.min(imageW - side, cropX + (cropW - side) / 2));
  cropY = Math.max(0, Math.min(imageH - side, cropY + (cropH - side) / 2));
  const cropSide = Math.min(side, imageW - cropX, imageH - cropY);
  return { x: cropX, y: cropY, side: cropSide };
}

/**
 * Rasterize the padded face square from the original source (not the 1600px
 * detect raster). Thin glasses rims survive on 24MP group photos.
 * 0–100 crop landmarks map onto this square the same way as faceCanvas.
 */
export function rasterizePaddedFaceImage(
  source: CanvasImageSource,
  box: { x: number; y: number; width: number; height: number },
  imageW: number,
  imageH: number,
  maxSide = 640,
): ImageData | null {
  if (typeof document === "undefined") return null;
  const sq = paddedFaceSquare(box, imageW, imageH);
  if (!(sq.side >= 16) || !(imageW > 0) || !(imageH > 0)) return null;
  const out = Math.round(Math.min(maxSide, Math.max(320, sq.side)));
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  try {
    ctx.drawImage(source, sq.x, sq.y, sq.side, sq.side, 0, 0, out, out);
  } catch {
    return null;
  }
  return ctx.getImageData(0, 0, out, out);
}

/**
 * Detect the face, extract FaceNet descriptor + age/gender, crop face.
 * Uses detectFacesOnly for robust multi-scale multi-person boxes, then embeds primary.
 * Returns null when no real face is detected (no synthetic/fake face fallback).
 */
export async function detectAndDescribe(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: DetectOptions = {},
): Promise<FaceDetectionResult | null> {
  const tTotalStart = performance.now();
  const tModelStart = performance.now();
  const api = (await getFaceApi()) as any;
  const modelLoadMs = Math.round(performance.now() - tModelStart);

  const tDown = performance.now();
  const detection = await detectFacesOnly(source, options);
  const downscaleMs = Math.round(performance.now() - tDown);
  const { faces, imageWidth: w, imageHeight: h, detectionCanvas, detectionScale } = detection;

  if (!faces.length) {
    return null;
  }

  const primaryIdx = Math.max(0, faces.findIndex((f) => f.isPrimary));
  const primary = faces[primaryIdx] ?? faces[0]!;
  const allFaces = faces;

  // Crop face from original source (high-res) for embedding quality
  const tEmbStart = performance.now();
  const origBox = primary.box;
  const square = paddedFaceSquare(origBox, w, h);
  const cropX = square.x;
  const cropY = square.y;
  const cropSide = square.side;

  const faceCanvas = document.createElement("canvas");
  const outSize = 320;
  faceCanvas.width = outSize;
  faceCanvas.height = outSize;
  let hiRaster: { canvas: HTMLCanvasElement; scale: number } | null = null;
  const fctx = faceCanvas.getContext("2d");
  if (fctx) {
    (fctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
    // Prefer a higher-res EXIF-oriented raster for embedding when detect ran on a downscale.
    // Detection boxes are in original (w,h) space; scale maps original → raster pixels.
    let drew = false;
    if (detectionScale < 0.95 && cropSide >= 48) {
      try {
        // High-res oriented raster for embedding only (detect may use ≤800)
        const hi = await rasterizeSource(source, 1600);
        hiRaster = hi;
        const sx = cropX * hi.scale;
        const sy = cropY * hi.scale;
        const ss = cropSide * hi.scale;
        if (ss >= 8 && hi.canvas.width >= 8) {
          fctx.drawImage(hi.canvas, sx, sy, ss, ss, 0, 0, outSize, outSize);
          drew = true;
        }
      } catch {
        /* fall through to detection canvas */
      }
    }
    if (!drew) {
      // EXIF-oriented detection canvas (correct for phone JPEGs; may be downscaled)
      const sx = cropX * detectionScale;
      const sy = cropY * detectionScale;
      const ss = cropSide * detectionScale;
      if (ss >= 2) {
        fctx.drawImage(detectionCanvas, sx, sy, ss, ss, 0, 0, outSize, outSize);
      } else {
        fctx.drawImage(
          source as CanvasImageSource,
          cropX,
          cropY,
          cropSide,
          cropSide,
          0,
          0,
          outSize,
          outSize,
        );
      }
    }
  }

  // Landmarks on the face crop (best effort — never fail the whole detect)
  let normalizedLandmarks: { x: number; y: number }[] = [];
  let croppedLandmarks: { x: number; y: number }[] = [];
  let rawLandmarksPx: { x: number; y: number }[] = [];
  let landmarks: unknown;
  let isLandmarksValid = false;

  const applyCropLandmarks = (rawPts: { x: number; y: number }[], lmObj?: unknown) => {
    isLandmarksValid = isValidHumanFaceLandmarks68(rawPts, outSize, outSize);
    if (!isLandmarksValid) return;
    if (lmObj !== undefined) landmarks = lmObj;
    rawLandmarksPx = rawPts;
    croppedLandmarks = [];
    normalizedLandmarks = [];
    for (const pt of rawPts) {
      croppedLandmarks.push({
        x: Math.min(100, Math.max(0, (pt.x / outSize) * 100)),
        y: Math.min(100, Math.max(0, (pt.y / outSize) * 100)),
      });
      // Map crop-space landmark → original image %
      const ox = cropX + (pt.x / outSize) * cropSide;
      const oy = cropY + (pt.y / outSize) * cropSide;
      normalizedLandmarks.push({
        x: Math.min(100, Math.max(0, (ox / w) * 100)),
        y: Math.min(100, Math.max(0, (oy / h) * 100)),
      });
    }
    if (normalizedLandmarks.length) {
      allFaces[primaryIdx] = {
        ...primary,
        normalizedLandmarks,
      };
    }
  };

  try {
    const withLm = await api
      .detectSingleFace(faceCanvas, new api.SsdMobilenetv1Options({ minConfidence: 0.08 }))
      .withFaceLandmarks();
    if (withLm?.landmarks?.positions && Array.isArray(withLm.landmarks.positions)) {
      const rawPts = withLm.landmarks.positions.map((pt: any) => ({
        x: (pt._x ?? pt.x) as number,
        y: (pt._y ?? pt.y) as number,
      }));

      // Strict validation: Reject hallucinated non-human face landmarks (e.g. sunset, clouds, trees)
      applyCropLandmarks(rawPts, withLm.landmarks);
    }
  } catch {
    /* landmarks optional */
  }

  // Direct landmark-net recovery when detectSingleFace misses the crop
  if (!isLandmarksValid) {
    try {
      const detectLm = api.nets?.faceLandmark68Net?.detectLandmarks;
      if (typeof detectLm === "function") {
        const lmResult = await detectLm.call(api.nets.faceLandmark68Net, faceCanvas);
        const positions = lmResult?.positions ?? lmResult?.landmarks?.positions;
        if (positions && Array.isArray(positions) && positions.length >= 68) {
          const rawPts = positions.map((pt: any) => ({
            x: (pt._x ?? pt.x) as number,
            y: (pt._y ?? pt.y) as number,
          }));
          applyCropLandmarks(rawPts, lmResult);
        }
      }
    } catch {
      /* landmarks optional */
    }
  }

  // Fallback for synthetic face fixtures when landmark net is stubs/unloaded (test-only)
  if (!isLandmarksValid && allowSyntheticDetection) {
    const synPts = generateSynthetic68Landmarks(origBox);
    if (isValidHumanFaceLandmarks68(synPts, w, h)) {
      isLandmarksValid = true;
      rawLandmarksPx = synPts.map((p) => ({
        x: Math.min(outSize, Math.max(0, ((p.x - origBox.x) / Math.max(1, origBox.width)) * outSize)),
        y: Math.min(outSize, Math.max(0, ((p.y - origBox.y) / Math.max(1, origBox.height)) * outSize)),
      }));
      normalizedLandmarks = synPts.map((p) => ({
        x: Math.min(100, Math.max(0, (p.x / w) * 100)),
        y: Math.min(100, Math.max(0, (p.y / h) * 100)),
      }));
      croppedLandmarks = synPts.map((p) => ({
        x: Math.min(100, Math.max(0, ((p.x - origBox.x) / origBox.width) * 100)),
        y: Math.min(100, Math.max(0, ((p.y - origBox.y) / origBox.height) * 100)),
      }));
      if (allFaces[primaryIdx]) {
        allFaces[primaryIdx] = {
          ...primary,
          normalizedLandmarks,
        };
      }
    }
  }

  // Landmark reject is for clouds/texture false-boxes. A confident SSD hit
  // (profile, tight crop, mid-shot) still embeds via padded-box.
  if (!normalizedLandmarks.length || !isLandmarksValid) {
    if (primary.confidence < 0.28) {
      return null;
    }
  }


  // FaceNet descriptor — 5-point Canonical Affine Warp (or Dlib fallback) when landmarks support it.
  // Preview `faceCanvas` stays the padded 320 portrait; embed uses 150×150 canonical aligned.
  let embedCanvas = faceCanvas;
  let alignment: "dlib" | "padded-box" = "padded-box";
  const alignAnchors = isLandmarksValid && rawLandmarksPx.length
    ? extract5AnchorPoints(rawLandmarksPx)
    : null;

  if (alignAnchors) {
    if (hiRaster) {
      const hiPts = rawLandmarksPx.map((p) => ({
        x: (cropX + (p.x / outSize) * cropSide) * hiRaster.scale,
        y: (cropY + (p.y / outSize) * cropSide) * hiRaster.scale,
      }));
      embedCanvas = warp5PointCanonicalCanvas(hiRaster.canvas, hiPts, FACENET_EMBED_SIZE);
    } else {
      embedCanvas = warp5PointCanonicalCanvas(faceCanvas, rawLandmarksPx, FACENET_EMBED_SIZE);
    }
    alignment = "dlib";
  } else {
    const alignBox = dlibAlignBoxFromLandmarks(landmarks);
    if (alignBox) {
      const scale = cropSide / outSize;
      const origAlign = {
        x: cropX + alignBox.x * scale,
        y: cropY + alignBox.y * scale,
        width: alignBox.width * scale,
        height: alignBox.height * scale,
      };
      if (hiRaster && origAlign.width >= 8) {
        embedCanvas = extractRegionToCanvas(
          hiRaster.canvas,
          {
            x: origAlign.x * hiRaster.scale,
            y: origAlign.y * hiRaster.scale,
            width: origAlign.width * hiRaster.scale,
            height: origAlign.height * hiRaster.scale,
          },
          hiRaster.canvas.width,
          hiRaster.canvas.height,
          FACENET_EMBED_SIZE,
        );
        alignment = "dlib";
      } else {
        embedCanvas = extractRegionToCanvas(
          faceCanvas,
          alignBox,
          outSize,
          outSize,
          FACENET_EMBED_SIZE,
        );
        alignment = "dlib";
      }
    }
  }

  // Adaptive LAB CLAHE on the 150 aligned crop before FaceNet (R4).
  // Skip well-lit uniform crops so queries stay in the enrolled gallery domain.
  let embedClaheMs = 0;
  if (options.enableContrastBoost !== false && cropNeedsIlluminationNorm(embedCanvas)) {
    const tClaheEmbed = performance.now();
    embedCanvas = applyClaheCanvas(embedCanvas, { clipLimit: 2.5, gridTiles: 8, maxClaheSide: 150 });
    embedClaheMs = Math.round(performance.now() - tClaheEmbed);
  }

  let rawDesc: Float32Array;
  try {
    if (typeof api.computeFaceDescriptor === "function") {
      rawDesc = await api.computeFaceDescriptor(embedCanvas);
    } else if (api.nets.faceRecognitionNet?.isLoaded) {
      rawDesc = await api.nets.faceRecognitionNet.computeFaceDescriptor(embedCanvas);
    } else {
      rawDesc = generateImageRegionDescriptor(embedCanvas);
    }
  } catch {
    rawDesc = generateImageRegionDescriptor(embedCanvas);
  }
  const descriptor = l2NormalizeVec(rawDesc);

  let age = 30;
  let gender: "male" | "female" = "male";
  let genderProbability = 0.85;
  if (api.nets.ageGenderNet?.isLoaded) {
    try {
      const ag = await api.nets.ageGenderNet.predictAgeAndGender(embedCanvas);
      if (ag) {
        age = Math.round(ag.age ?? 30);
        gender = (ag.gender ?? "male") as "male" | "female";
        genderProbability = ag.genderProbability ?? 0.85;
      }
    } catch {
      /* optional */
    }
  }

  if (allFaces[primaryIdx]) {
    allFaces[primaryIdx] = {
      ...allFaces[primaryIdx]!,
      age,
      gender,
      genderProbability,
      isPrimary: true,
    };
  }

  const embeddingMs = Math.round(performance.now() - tEmbStart);
  const { sharpness, illumination } = computeSharpness(faceCanvas);

  const normalizedBox = primary.normalizedBox;
  const candidateBoxes = allFaces.map((f) => ({
    ...f.normalizedBox,
    isPrimary: f.isPrimary,
  }));

  const totalMs = Math.round(performance.now() - tTotalStart);
  const stageLatencies: FaceStageLatencies = {
    modelLoadMs,
    downscaleMs,
    ssdPassMs: detection.latencies.detectMs,
    claheMs: (detection.latencies.claheMs ?? 0) + embedClaheMs,
    embeddingMs,
    totalMs,
  };

  const telemetry: FaceTelemetry = {
    originalWidth: w,
    originalHeight: h,
    downscaledWidth: detectionCanvas.width,
    downscaledHeight: detectionCanvas.height,
    faceCount: allFaces.length,
    primaryConfidence: primary.confidence,
    latencies: stageLatencies,
  };

  return {
    descriptor,
    age,
    gender,
    genderProbability,
    faceCanvas,
    embedCanvas,
    alignment,
    confidence: primary.confidence,
    sharpness,
    blurScore: Math.min(1, sharpness / 65),
    illumination,
    box: origBox,
    normalizedBox,
    normalizedLandmarks,
    croppedLandmarks,
    imageWidth: w,
    imageHeight: h,
    landmarks,
    allFaces,
    candidateBoxes,
    telemetry,
    stageLatencies,
  };
}

/**
 * Crop-level TTA: average original + horizontal flip descriptors.
 * Also exposes both templates on `descriptors` for min-distance ranking.
 *
 * Defaults favor accuracy (Phase 0): flip is almost always applied.
 * Set `fastExitConfidence` < 1 to skip TTA on high-confidence detections.
 * Soft time budget: skip flip only if detect+describe already exceeded 1500ms.
 */
export async function detectAndDescribeWithTTA(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: DetectOptions = {},
): Promise<FaceDetectionResult | null> {
  const t0 = performance.now();
  const primary = await detectAndDescribe(source, options);
  if (!primary) return null;

  if (options.tta === false) {
    return { ...primary, descriptors: [primary.descriptor] };
  }

  // Default 1.01 = never skip on confidence (accuracy-first). Opt into old 0.70 via options.
  const fastExitThreshold = options.fastExitConfidence ?? 1.01;
  if (primary.confidence >= fastExitThreshold) {
    return {
      ...primary,
      descriptors: [primary.descriptor],
    };
  }

  // Soft budget — allow TTA in normal interactive analyze (~1.5s already spent is rare)
  if (performance.now() - t0 > 1500) {
    return {
      ...primary,
      descriptors: [primary.descriptor],
    };
  }

  try {
    const api = (await getFaceApi()) as any;
    const cropCanvas = primary.embedCanvas ?? primary.faceCanvas;
    if (!cropCanvas) {
      return { ...primary, descriptors: [primary.descriptor] };
    }

    const tTtaStart = performance.now();

    // 1. Canonical Aligned Crop C1 (150x150) & v1
    let cropCanvas150: HTMLCanvasElement;
    if (cropCanvas.width === FACENET_EMBED_SIZE && cropCanvas.height === FACENET_EMBED_SIZE) {
      cropCanvas150 = cropCanvas;
    } else {
      cropCanvas150 = document.createElement("canvas");
      cropCanvas150.width = FACENET_EMBED_SIZE;
      cropCanvas150.height = FACENET_EMBED_SIZE;
      const ctx1 = cropCanvas150.getContext("2d");
      if (ctx1) {
        (ctx1 as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
        ctx1.drawImage(cropCanvas, 0, 0, FACENET_EMBED_SIZE, FACENET_EMBED_SIZE);
      }
    }
    const v1 = primary.descriptor instanceof Float32Array
      ? primary.descriptor
      : l2NormalizeVec(primary.descriptor);

    const computeDesc = async (canvas: HTMLCanvasElement): Promise<Float32Array> => {
      let raw: Float32Array;
      if (typeof api.computeFaceDescriptor === "function") {
        raw = await api.computeFaceDescriptor(canvas);
      } else if (api.nets?.faceRecognitionNet?.isLoaded) {
        raw = await api.nets.faceRecognitionNet.computeFaceDescriptor(canvas);
      } else {
        raw = generateImageRegionDescriptor(canvas);
      }
      return l2NormalizeVec(raw ?? new Float32Array(128));
    };

    // 2. Horizontal Mirror Flip Crop C2 (150x150) & v2
    const flipCanvas = createHorizontalFlipCanvas(cropCanvas150);
    const v2 = await computeDesc(flipCanvas);

    // 3. Tight Scale Crop C3 (150x150, 1.15x zoom / 0.85x scale box around center) & v3
    const tightCanvas = createTightScaleCanvas(cropCanvas150, FACENET_EMBED_SIZE, 0.85);
    const v3 = await computeDesc(tightCanvas);

    // 4. L2-normalized ensemble vector v_ensemble = l2Normalize(v1 + v2 + v3)
    const dim = Math.min(v1.length, v2.length, v3.length);
    const sumVec = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      sumVec[i] = (v1[i] ?? 0) + (v2[i] ?? 0) + (v3[i] ?? 0);
    }
    const vEnsemble = l2NormalizeVec(sumVec);

    // Clean up temporary canvases immediately to ensure zero memory leaks
    flipCanvas.width = 0;
    flipCanvas.height = 0;
    tightCanvas.width = 0;
    tightCanvas.height = 0;
    if (cropCanvas150 !== cropCanvas) {
      cropCanvas150.width = 0;
      cropCanvas150.height = 0;
    }

    const ttaMs = Math.round(performance.now() - tTtaStart);
    let updatedTelemetry = primary.telemetry;
    let updatedLatencies = primary.stageLatencies;

    if (primary.telemetry) {
      const embeddingMs = primary.telemetry.latencies.embeddingMs + ttaMs;
      const totalMs = primary.telemetry.latencies.totalMs + ttaMs;
      updatedLatencies = {
        ...primary.telemetry.latencies,
        embeddingMs,
        totalMs,
      };
      updatedTelemetry = {
        ...primary.telemetry,
        latencies: updatedLatencies,
      };
    }

    return {
      ...primary,
      descriptor: vEnsemble,
      // Return 4 descriptors: [v1 (canonical), v2 (flip), v3 (tight scale), vEnsemble]
      descriptors: [v1, v2, v3, vEnsemble],
      telemetry: updatedTelemetry,
      stageLatencies: updatedLatencies,
    };
  } catch {
    return { ...primary, descriptors: [primary.descriptor] };
  }
}

export function assessDetectionQuality(det: FaceDetectionResult): {
  ok: boolean;
  score: number;
  faceCoverage: number;
  centered: number;
  sharpness: number;
  illumination: number;
  issues: string[];
} {
  const issues: string[] = [];
  const area = det.box.width * det.box.height;
  const imgArea = det.imageWidth * det.imageHeight || 1;
  const faceCoverage = area / imgArea;

  const isMultiFace = Boolean(det.allFaces && det.allFaces.length > 1);
  const minFaceCoverageThreshold = isMultiFace ? 0.025 : 0.035;

  if (
    !det.normalizedLandmarks?.length ||
    !isValidHumanFaceLandmarks68(
      det.normalizedLandmarks,
      det.normalizedBox?.width,
      det.normalizedBox?.height,
    )
  ) {
    issues.push("No valid human face landmarks detected in this image.");
  }

  if (faceCoverage < 0.025) {
    issues.push(
      "Face was very small in the photo — we zoomed in automatically. A closer selfie will be more accurate.",
    );
  } else if (faceCoverage < 0.06) {
    issues.push(
      "For a sharper match next time, fill more of the frame with your face.",
    );
  }

  if (det.confidence < 0.40) {
    issues.push(
      "Low face confidence — try better lighting and a clearer front view.",
    );
  }

  // High-accuracy: blur gate
  // Hard blur only — soft photos still match; advice stays advisory in issues.
  if (det.sharpness < 28) {
    issues.push(
      "Photo looks soft or blurry — hold steady, tap to focus, and use good light.",
    );
  } else if (det.sharpness < 42) {
    issues.push(
      "Slightly soft focus — a sharper selfie can improve accuracy (match still runs).",
    );
  }

  // Illumination gate
  if (det.illumination < 0.20) {
    issues.push("Dim lighting detected — brighter, even light improves accuracy.");
  } else if (det.illumination > 0.92) {
    issues.push("Very bright / overexposed — soften harsh light for better detail.");
  }

  const cx = (det.box.x + det.box.width / 2) / det.imageWidth;
  const cy = (det.box.y + det.box.height / 2) / det.imageHeight;
  const centered = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / 0.5);
  if (centered < 0.50) {
    issues.push("Face is near the edge — center it for a cleaner match.");
  }

  const sharpnessNorm = Math.min(1, det.sharpness / 70);
  const illumQuality = det.illumination < 0.5 ? det.illumination * 2 : 2 - det.illumination * 2; // peak at 0.5

  const score = Math.min(
    1,
    det.confidence * 0.45 +
      Math.min(1, faceCoverage / 0.14) * 0.22 +
      centered * 0.15 +
      sharpnessNorm * 0.12 +
      Math.min(1, illumQuality) * 0.06,
  );

  // "ok" = hard-usable for matching. Soft-focus / small-face advice can still
  // appear in issues without failing the capture.
  const ok =
    det.confidence >= 0.35 &&
    det.sharpness >= 28 &&
    faceCoverage >= minFaceCoverageThreshold &&
    det.illumination >= 0.15 &&
    det.illumination <= 0.95 &&
    !issues.some((i) => i.includes("No valid human face"));

  return {
    ok,
    score,
    faceCoverage,
    centered,
    sharpness: det.sharpness,
    illumination: det.illumination,
    issues,
  };
}

