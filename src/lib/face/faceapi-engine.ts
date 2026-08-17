/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FaceStageLatencies, FaceTelemetry } from "./types";

type FaceApiModule = typeof import("@vladmandic/face-api");

let faceApiMod: FaceApiModule | null = null;
let loadPromise: Promise<FaceApiModule> | null = null;
let detectorApi: FaceApiModule | null = null;
let detectorOnlyPromise: Promise<FaceApiModule> | null = null;
let fastDetectorApi: FaceApiModule | null = null;
let fastDetectorPromise: Promise<FaceApiModule> | null = null;
let detectorReady = false;

const MODEL_URL = "/models/face-api";

function cropBoxToCanvas(
  source: CanvasImageSource,
  box: { x: number; y: number; width: number; height: number },
  srcW: number,
  srcH: number,
  outSize: number,
  padFrac: number,
): HTMLCanvasElement {
  const padX = box.width * padFrac;
  const padY = box.height * padFrac;
  let x = Math.max(0, box.x - padX);
  let y = Math.max(0, box.y - padY);
  let w = Math.min(srcW - x, box.width + padX * 2);
  let h = Math.min(srcH - y, box.height + padY * 2);
  const side = Math.max(w, h, 1);
  x = Math.max(0, Math.min(srcW - side, x + (w - side) / 2));
  y = Math.max(0, Math.min(srcH - side, y + (h - side) / 2));
  const crop = Math.min(side, srcW - x, srcH - y);
  const canvas = createCanvas(outSize, outSize);
  const ctx = canvas.getContext("2d");
  if (ctx && crop >= 1) {
    (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
    ctx.drawImage(source, x, y, crop, crop, 0, 0, outSize, outSize);
  }
  return canvas;
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))) as unknown as HTMLCanvasElement;
  }
  throw new Error("Canvas API not available in current environment");
}

async function importFaceApi(): Promise<any> {
  const mod = await import("@vladmandic/face-api");
  return (mod as any).default?.nets ? (mod as any).default : mod;
}

async function configureFaceApiBackend(api: any): Promise<void> {
  try {
    const tf = api.tf;
    if (tf?.setBackend) {
      await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
      await tf.ready?.();
    }
  } catch {
    /* backend optional */
  }
}

/**
 * Crop-review path: TinyFace only. It is intentionally separate from the
 * heavier SSD/landmark loader so choosing a face stays responsive on phones.
 */
async function getFastFaceApiDetector(): Promise<FaceApiModule> {
  if (typeof window === "undefined") {
    throw new Error("Face recognition only runs in the browser.");
  }
  if (faceApiMod) return faceApiMod;
  if (fastDetectorApi) return fastDetectorApi;
  if (fastDetectorPromise) return fastDetectorPromise;

  fastDetectorPromise = (async () => {
    const api = await importFaceApi();
    await configureFaceApiBackend(api);
    if (!api.nets.tinyFaceDetector.isLoaded) {
      await api.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    }
    fastDetectorApi = api as FaceApiModule;
    return fastDetectorApi;
  })().catch((err) => {
    fastDetectorPromise = null;
    throw err;
  });

  return fastDetectorPromise;
}

/**
 * Fast path: SSD (+ Tiny) only — enough for crop-review face boxes.
 * Avoids downloading ~7MB of recognition/age nets before the user even approves.
 */
async function getFaceApiDetector(): Promise<FaceApiModule> {
  if (typeof window === "undefined") {
    throw new Error("Face recognition only runs in the browser.");
  }
  if (faceApiMod) return faceApiMod;
  if (detectorApi) return detectorApi;
  if (detectorOnlyPromise) return detectorOnlyPromise;

  detectorOnlyPromise = (async () => {
    const api = await importFaceApi();
    await configureFaceApiBackend(api);
    await Promise.all([
      api.nets.ssdMobilenetv1.isLoaded
        ? Promise.resolve()
        : api.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      api.nets.faceLandmark68Net.isLoaded
        ? Promise.resolve()
        : api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      api.nets.tinyFaceDetector.isLoaded
        ? Promise.resolve()
        : api.nets.tinyFaceDetector.loadFromUri(MODEL_URL).catch(() => {}),
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
  if (typeof window === "undefined") {
    throw new Error("Face recognition only runs in the browser.");
  }
  if (faceApiMod) return faceApiMod;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    if (fastDetectorPromise) {
      await fastDetectorPromise.catch(() => null);
    }
    const api = await importFaceApi();
    await configureFaceApiBackend(api);
    // Ensure detector nets first, then the rest
    await Promise.all([
      api.nets.ssdMobilenetv1.isLoaded
        ? Promise.resolve()
        : api.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      api.nets.tinyFaceDetector.isLoaded
        ? Promise.resolve()
        : api.nets.tinyFaceDetector.loadFromUri(MODEL_URL).catch(() => {}),
    ]);
    detectorReady = true;
    await Promise.all([
      api.nets.faceLandmark68Net.isLoaded
        ? Promise.resolve()
        : api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      api.nets.faceRecognitionNet.isLoaded
        ? Promise.resolve()
        : api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      api.nets.ageGenderNet.isLoaded
        ? Promise.resolve()
        : api.nets.ageGenderNet.loadFromUri(MODEL_URL),
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
  // Warm the tiny crop detector first; the full matcher loads after approval.
  void getFastFaceApiDetector().catch(() => {});
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
  /** Use the lightweight TinyFace crop-review path instead of robust SSD passes. */
  fastCrop?: boolean;
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
  age: number;
  gender: "male" | "female";
  genderProbability: number;
  faceCanvas: HTMLCanvasElement;
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

  const detMs = latencies.scrfdPassMs ?? latencies.ssdPassMs ?? 0;
  const frontMs = latencies.frontalizationMs ?? latencies.claheMs ?? 0;
  const embMs = latencies.embeddingPassMs ?? latencies.embeddingMs ?? 0;
  const bioMs = latencies.biohashMs ?? 0;

  console.log(
    `%c[Twinframe Telemetry]%c Image: ${originalWidth}x${originalHeight} -> Canvas: ${downscaledWidth}x${downscaledHeight} (${latencies.downscaleMs}ms) | Det: ${detMs}ms (${faceCount} face${faceCount === 1 ? "" : "s"}, conf: ${(primaryConfidence * 100).toFixed(0)}%) | Frontalization: ${frontMs}ms | Embedding: ${embMs}ms | Biohash: ${bioMs}ms | Model: ${latencies.modelLoadMs}ms | Total: ${latencies.totalMs}ms`,
    "color: #38bdf8; font-weight: bold;",
    "color: inherit;",
  );
}

function sourceSize(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): { w: number; h: number } {
  if (source instanceof HTMLVideoElement) {
    return { w: source.videoWidth, h: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return {
      w: source.naturalWidth || source.width,
      h: source.naturalHeight || source.height,
    };
  }
  return { w: source.width, h: source.height };
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
    const empty = createCanvas(1, 1);
    return { canvas: empty, scale: 1, w: 1, h: 1 };
  }

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = createCanvas(cw, ch);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { canvas, scale, w, h };
  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";

  if (typeof createImageBitmap === "function" && source instanceof HTMLImageElement) {
    try {
      // Decode + downscale in one step (huge win on 12–24MP camera rolls)
      const bmp = await createImageBitmap(source, {
        resizeWidth: cw,
        resizeHeight: ch,
        resizeQuality: "high",
        ...({ imageOrientation: "from-image" } as object),
      } as ImageBitmapOptions);
      // If EXIF orientation swapped axes, bitmap size may differ — fit canvas
      if (bmp.width !== cw || bmp.height !== ch) {
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        // Map using natural dimensions still (UI boxes use naturalWidth space).
        // When orientation swaps, naturalWidth/Height in modern browsers usually already reflect display size.
        ctx.drawImage(bmp, 0, 0);
        const s = Math.min(bmp.width / w, bmp.height / h);
        bmp.close();
        return { canvas, scale: s > 0 ? s : scale, w, h };
      }
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return { canvas, scale, w, h };
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
  const c = createCanvas(s, s);
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
  const area = box.width * box.height;
  const safeConfidence = Number.isFinite(confidence) && confidence >= 0 ? confidence : 0.5;
  return safeConfidence * (area / (1 + distFromCenter * 0.3));
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

/**
 * CLAHE (Contrast Limited Adaptive Histogram Equalization) & Local Contrast Boost
 * Enhances local contrast in low-light / backlit outdoor images (e.g. sunset photos).
 */
export function applyLocalContrastBoost(
  sourceCanvas: HTMLCanvasElement,
  clipLimit = 3.0,
  gridTiles = 8,
  maxClaheSide = 640,
): HTMLCanvasElement {
  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;
  if (!origW || !origH) return sourceCanvas;

  // Pre-downscale to maxClaheSide (640px) to keep CPU pixel loop < 25ms
  let workingCanvas: HTMLCanvasElement = sourceCanvas;
  if (Math.max(origW, origH) > maxClaheSide) {
    const scale = maxClaheSide / Math.max(origW, origH);
    const sw = Math.max(1, Math.round(origW * scale));
    const sh = Math.max(1, Math.round(origH * scale));
    const downCanvas = createCanvas(sw, sh);
    const dctx = downCanvas.getContext("2d", { willReadFrequently: true });
    if (dctx) {
      (dctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
      dctx.drawImage(sourceCanvas, 0, 0, sw, sh);
      workingCanvas = downCanvas;
    }
  }

  const w = workingCanvas.width;
  const h = workingCanvas.height;
  const outCanvas = createCanvas(w, h);
  const ctx = outCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return sourceCanvas;

  // Always sample from workingCanvas (may already be pre-downscaled to maxClaheSide)
  ctx.drawImage(workingCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const tileW = Math.max(1, Math.ceil(w / gridTiles));
  const tileH = Math.max(1, Math.ceil(h / gridTiles));
  const numPixels = w * h;
  const lum = new Uint8Array(numPixels);

  // 1. Calculate pixel luminance Y = 0.299R + 0.587G + 0.114B
  for (let i = 0; i < numPixels; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // 2. Compute histogram, clip limit, and CDF per tile
  const numBins = 256;
  const tileCDFs: Float32Array[] = [];

  for (let ty = 0; ty < gridTiles; ty++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      const hist = new Int32Array(numBins);
      const startX = tx * tileW;
      const endX = Math.min(w, startX + tileW);
      const startY = ty * tileH;
      const endY = Math.min(h, startY + tileH);
      const tileSize = Math.max(1, (endX - startX) * (endY - startY));

      for (let y = startY; y < endY; y++) {
        const rowOffset = y * w;
        for (let x = startX; x < endX; x++) {
          const lVal = lum[rowOffset + x] ?? 0;
          hist[lVal] = (hist[lVal] ?? 0) + 1;
        }
      }

      // Clip histogram excess
      const clipThreshold = Math.max(1, Math.round((clipLimit * tileSize) / numBins));
      let excess = 0;
      for (let i = 0; i < numBins; i++) {
        if ((hist[i] ?? 0) > clipThreshold) {
          excess += (hist[i] ?? 0) - clipThreshold;
          hist[i] = clipThreshold;
        }
      }

      // Redistribute excess evenly across all bins
      const bonus = Math.floor(excess / numBins);
      for (let i = 0; i < numBins; i++) {
        hist[i] = (hist[i] ?? 0) + bonus;
      }

      // Calculate tile CDF
      const cdf = new Float32Array(numBins);
      let cum = 0;
      for (let i = 0; i < numBins; i++) {
        cum += hist[i] ?? 0;
        cdf[i] = Math.min(255, (cum / tileSize) * 255);
      }
      tileCDFs.push(cdf);
    }
  }

  // 3. Bilinear interpolation across tile CDFs
  for (let y = 0; y < h; y++) {
    const v = y / tileH - 0.5;
    const ty1 = Math.max(0, Math.floor(v));
    const ty2 = Math.min(gridTiles - 1, ty1 + 1);
    const yLerp = Math.max(0, Math.min(1, v - ty1));

    for (let x = 0; x < w; x++) {
      const u = x / tileW - 0.5;
      const tx1 = Math.max(0, Math.floor(u));
      const tx2 = Math.min(gridTiles - 1, tx1 + 1);
      const xLerp = Math.max(0, Math.min(1, u - tx1));

      const idx = y * w + x;
      const val = lum[idx] ?? 0;

      const cdfTL = tileCDFs[ty1 * gridTiles + tx1]?.[val] ?? val;
      const cdfTR = tileCDFs[ty1 * gridTiles + tx2]?.[val] ?? val;
      const cdfBL = tileCDFs[ty2 * gridTiles + tx1]?.[val] ?? val;
      const cdfBR = tileCDFs[ty2 * gridTiles + tx2]?.[val] ?? val;

      const top = cdfTL * (1 - xLerp) + cdfTR * xLerp;
      const bottom = cdfBL * (1 - xLerp) + cdfBR * xLerp;
      const newLum = top * (1 - yLerp) + bottom * yLerp;

      const origLum = Math.max(1, val);
      const ratio = newLum / origLum;

      const pxIdx = idx * 4;
      data[pxIdx] = Math.min(255, Math.max(0, Math.round((data[pxIdx] ?? 0) * ratio)));
      data[pxIdx + 1] = Math.min(255, Math.max(0, Math.round((data[pxIdx + 1] ?? 0) * ratio)));
      data[pxIdx + 2] = Math.min(255, Math.max(0, Math.round((data[pxIdx + 2] ?? 0) * ratio)));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return outCanvas;
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
  const c = createCanvas(s, s);
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

function flipSourceHorizontal(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): HTMLCanvasElement {
  const { w, h } = sourceSize(source);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

function flipSelectedBox(
  box: { x: number; y: number; width: number; height: number } | undefined,
  imageWidth: number,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!box) return box;
  const looksNormalized = box.width <= 100 && box.height <= 100 && box.x <= 100 && box.y <= 100;
  if (looksNormalized) {
    return { ...box, x: 100 - box.x - box.width };
  }
  return { ...box, x: imageWidth - box.x - box.width };
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

  const canvas = createCanvas(sw + padX * 2, sh + padY * 2);
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

function extractCenterFaceCanvas(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  outSize = 320,
): HTMLCanvasElement {
  const { w, h } = sourceSize(source);
  const canvas = createCanvas(outSize, outSize);
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
  const c = createCanvas(s, s);
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
  latencies: { modelLoadMs: number; detectMs: number; totalMs: number };
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
  const fastCrop = options.fastCrop === true;
  const api = (await (fastCrop
    ? getFastFaceApiDetector()
    : getFaceApiDetector())) as any;
  const modelLoadMs = Math.round(performance.now() - tModel);

  // TinyFace needs fewer pixels and stays responsive on CPU-only mobile browsers.
  const maxSide = fastCrop
    ? Math.min(options.maxSide ?? 384, 384)
    : Math.min(options.maxSide ?? 800, 960);
  const enableClahe = options.enableContrastBoost !== false;

  await yieldToUi();
  const primary = await rasterizeSource(source, maxSide);
  let { w, h, scale: primaryScale, canvas: primaryCanvas } = primary;

  // Black canvas recovery (failed decode / orientation)
  if (canvasMeanLuma(primaryCanvas) < 0.02) {
    const { w: rw, h: rh } = sourceSize(source);
    const s = Math.min(1, maxSide / Math.max(rw, rh, 1));
    const retry = createCanvas(rw * s, rh * s);
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

  const pushRaw = (
    rawList: any[] | null | undefined,
    scaleToOrig: number,
    offX = 0,
    offY = 0,
    minConf = 0.1,
  ) => {
    if (!rawList?.length) return;
    for (const raw of rawList) {
      const b = raw.detection?.box ?? raw.box;
      const conf = Number(raw.detection?.score ?? raw.score ?? 0.5);
      if (!b || !Number.isFinite(conf) || conf < minConf) continue;
      const box = {
        x: Math.max(0, (b.x - offX) / scaleToOrig),
        y: Math.max(0, (b.y - offY) / scaleToOrig),
        width: b.width / scaleToOrig,
        height: b.height / scaleToOrig,
      };
      if (box.width < 10 || box.height < 10) continue;
      const areaFrac = (box.width * box.height) / Math.max(1, w * h);
      if (areaFrac < 0.0003 || areaFrac > 0.6) continue;
      const aspect = box.width / Math.max(1, box.height);
      if (aspect < 0.35 || aspect > 2.0) continue;
      collected.push({ box, confidence: conf });
    }
  };

  const runSsd = async (canvas: HTMLCanvasElement, minConf: number) => {
    try {
      return await api.detectAllFaces(
        canvas,
        new api.SsdMobilenetv1Options({ minConfidence: minConf }),
      );
    } catch {
      return [];
    }
  };

  const tDetect = performance.now();

  if (fastCrop) {
    await yieldToUi();
    try {
      const tiny = await api.detectAllFaces(
        primaryCanvas,
        new api.TinyFaceDetectorOptions({
          inputSize: 128,
          scoreThreshold: 0.2,
        }),
      );
      pushRaw(tiny, primaryScale, 0, 0, 0.2);
    } catch {
      /* manual crop remains available */
    }
  }

  // Pass 1 — single full-frame SSD (the common case)
  if (!fastCrop) {
    await yieldToUi();
    pushRaw(await runSsd(primaryCanvas, 0.15), primaryScale, 0, 0, 0.12);
    if (collected.length === 0) {
      pushRaw(await runSsd(primaryCanvas, 0.05), primaryScale, 0, 0, 0.05);
    }
  }

  // Pass 2 — CLAHE for sunset / backlit outdoor
  if (!fastCrop && collected.length === 0 && enableClahe) {
    await yieldToUi();
    try {
      const boosted = applyLocalContrastBoost(primaryCanvas, 2.5, 6, 512);
      const claheScale = primaryScale * (boosted.width / Math.max(1, primaryCanvas.width));
      pushRaw(await runSsd(boosted, 0.05), claheScale, 0, 0, 0.05);
    } catch {
      /* optional */
    }
  }

  // Pass 3 — TinyFace
  if (!fastCrop && collected.length === 0 && api.nets.tinyFaceDetector?.isLoaded) {
    await yieldToUi();
    try {
      const tiny = await api.detectAllFaces(
        primaryCanvas,
        new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.08 }),
      );
      pushRaw(tiny, primaryScale, 0, 0, 0.08);
    } catch {
      /* optional */
    }
  }

  // Pass 4 — 3 column tiles only if still empty (group / outdoor miss)
  if (!fastCrop && collected.length === 0 && Math.max(w, h) >= 900) {
    await yieldToUi();
    const pcW = primaryCanvas.width;
    const pcH = primaryCanvas.height;
    const colW = Math.round(pcW * 0.55);
    for (const sx of [0, Math.round(pcW * 0.225), Math.max(0, pcW - colW)]) {
      const localScale = Math.min(1, 640 / Math.max(colW, pcH));
      const tile = createCanvas(colW * localScale, pcH * localScale);
      const tctx = tile.getContext("2d");
      if (!tctx) continue;
      tctx.drawImage(primaryCanvas, sx, 0, colW, pcH, 0, 0, tile.width, tile.height);
      const scaleToOrig = localScale * primaryScale;
      pushRaw(await runSsd(tile, 0.06), scaleToOrig, -sx * localScale, 0, 0.06);
      if (collected.length > 0) break;
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

  if (options.selectedBox && sorted.length > 0) {
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
    latencies: {
      modelLoadMs,
      detectMs,
      totalMs: Math.round(performance.now() - t0),
    },
  };
}

/**
 * Landmark-aligned FaceNet descriptor — same path used to enroll the gallery
 * (`detectAllFaces` + 68-pt align + `withFaceDescriptors`).
 * The 320px padded crop + `computeFaceDescriptor(crop)` path is a different
 * embedding and does not self-match enrolled portraits.
 */
async function extractAlignedFaceNet(
  api: any,
  canvas: HTMLCanvasElement,
  targetBox: { x: number; y: number; width: number; height: number },
): Promise<Float32Array | null> {
  const dets = await api
    .detectAllFaces(canvas, new api.SsdMobilenetv1Options({ minConfidence: 0.15 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  if (!dets?.length) return null;

  let best: (typeof dets)[number] | null = null;
  let bestIou = 0;
  for (const d of dets) {
    const b = d.detection?.box;
    if (!b) continue;
    const iou = boxIoU(
      { x: b.x, y: b.y, width: b.width, height: b.height },
      targetBox,
    );
    if (iou > bestIou) {
      bestIou = iou;
      best = d;
    }
  }
  if (!best?.descriptor || bestIou < 0.15) return null;
  return best.descriptor as Float32Array;
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

  if (!faces.length) return null;

  const primaryIdx = Math.max(0, faces.findIndex((f) => f.isPrimary));
  const primary = faces[primaryIdx] ?? faces[0]!;
  const allFaces = faces;

  // Crop face from original source (high-res) for embedding quality
  const tEmbStart = performance.now();
  const origBox = primary.box;
  const pad = 0.35;
  const padX = origBox.width * pad;
  const padY = origBox.height * pad * 1.1;
  let cropX = Math.max(0, origBox.x - padX);
  let cropY = Math.max(0, origBox.y - padY);
  let cropW = Math.min(w - cropX, origBox.width + padX * 2);
  let cropH = Math.min(h - cropY, origBox.height + padY * 2.2);
  const side = Math.max(cropW, cropH);
  cropX = Math.max(0, Math.min(w - side, cropX + (cropW - side) / 2));
  cropY = Math.max(0, Math.min(h - side, cropY + (cropH - side) / 2));
  const cropSide = Math.min(side, w - cropX, h - cropY);

  const outSize = 320;
  const faceCanvas = createCanvas(outSize, outSize);
  faceCanvas.width = outSize;
  faceCanvas.height = outSize;
  const fctx = faceCanvas.getContext("2d");
  if (fctx) {
    (fctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
    // Always crop from EXIF-oriented detection canvas so phone JPEGs stay correct
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

  // Landmarks on the face crop (best effort — never fail the whole detect)
  let normalizedLandmarks: { x: number; y: number }[] = [];
  let croppedLandmarks: { x: number; y: number }[] = [];
  let landmarks: unknown;
  try {
    const withLm = await api
      .detectSingleFace(faceCanvas, new api.SsdMobilenetv1Options({ minConfidence: 0.1 }))
      .withFaceLandmarks();
    if (withLm?.landmarks?.positions) {
      landmarks = withLm.landmarks;
      for (const pt of withLm.landmarks.positions) {
        const lx = (pt._x ?? pt.x) as number;
        const ly = (pt._y ?? pt.y) as number;
        croppedLandmarks.push({
          x: Math.min(100, Math.max(0, (lx / outSize) * 100)),
          y: Math.min(100, Math.max(0, (ly / outSize) * 100)),
        });
        // Map crop-space landmark → original image %
        const ox = cropX + (lx / outSize) * cropSide;
        const oy = cropY + (ly / outSize) * cropSide;
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
    }
  } catch {
    /* landmarks optional */
  }

  // FaceNet descriptor — landmark-aligned on the detection canvas (gallery enrollment parity)
  let rawDesc: Float32Array | null = null;
  try {
    const targetBox = {
      x: origBox.x * detectionScale,
      y: origBox.y * detectionScale,
      width: origBox.width * detectionScale,
      height: origBox.height * detectionScale,
    };
    rawDesc = await extractAlignedFaceNet(api, detectionCanvas, targetBox);
  } catch {
    rawDesc = null;
  }
  if (!rawDesc) {
    try {
      if (typeof api.computeFaceDescriptor === "function") {
        rawDesc = await api.computeFaceDescriptor(faceCanvas);
      } else if (api.nets.faceRecognitionNet?.isLoaded) {
        rawDesc = await api.nets.faceRecognitionNet.computeFaceDescriptor(faceCanvas);
      } else {
        rawDesc = generateImageRegionDescriptor(faceCanvas);
      }
    } catch {
      rawDesc = generateImageRegionDescriptor(faceCanvas);
    }
  }
  const descriptor = rawDesc ? l2NormalizeVec(rawDesc) : new Float32Array(128);

  let age = 30;
  let gender: "male" | "female" = "male";
  let genderProbability = 0.85;
  if (api.nets.ageGenderNet?.isLoaded) {
    try {
      const relocked = await api
        .detectSingleFace(faceCanvas, new api.SsdMobilenetv1Options({ minConfidence: 0.1 }))
        .withAgeAndGender();
      if (relocked?.gender === "male" || relocked?.gender === "female") {
        age = Math.round(relocked.age ?? 30);
        gender = relocked.gender;
        genderProbability = relocked.genderProbability ?? 0.85;
      } else {
        const tightCanvas = cropBoxToCanvas(
          detectionCanvas,
          {
            x: origBox.x * detectionScale,
            y: origBox.y * detectionScale,
            width: origBox.width * detectionScale,
            height: origBox.height * detectionScale,
          },
          detectionCanvas.width,
          detectionCanvas.height,
          224,
          0.08,
        );
        const agT = await api.nets.ageGenderNet.predictAgeAndGender(tightCanvas);
        if (agT?.gender === "male" || agT?.gender === "female") {
          age = Math.round(agT.age ?? 30);
          gender = agT.gender;
          genderProbability = agT.genderProbability ?? 0.85;
        } else {
          const ag = await api.nets.ageGenderNet.predictAgeAndGender(faceCanvas);
          if (ag) {
            age = Math.round(ag.age ?? 30);
            gender = (ag.gender ?? "male") as "male" | "female";
            genderProbability = ag.genderProbability ?? 0.85;
          }
        }
      }
    } catch {
      try {
        const ag = await api.nets.ageGenderNet.predictAgeAndGender(faceCanvas);
        if (ag) {
          age = Math.round(ag.age ?? 30);
          gender = (ag.gender ?? "male") as "male" | "female";
          genderProbability = ag.genderProbability ?? 0.85;
        }
      } catch {
        /* optional */
      }
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
    scrfdPassMs: detection.latencies.detectMs,
    frontalizationMs: 0,
    embeddingMs,
    biohashMs: 0,
    totalMs,
    ssdPassMs: detection.latencies.detectMs,
    claheMs: 0,
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
 * Test-time augmentation: average the landmark-aligned FaceNet descriptor
 * from the original image and a full-frame horizontal flip.
 */
export async function detectAndDescribeWithTTA(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: DetectOptions = {},
): Promise<FaceDetectionResult | null> {
  const primary = await detectAndDescribe(source, options);
  if (!primary) return null;

  try {
    const tTtaStart = performance.now();
    const flipped = flipSourceHorizontal(source);
    const flippedDet = await detectAndDescribe(flipped, {
      ...options,
      selectedBox: flipSelectedBox(options.selectedBox, primary.imageWidth),
    });
    if (!flippedDet?.descriptor?.length) return primary;

    const avg = averageDescriptors(primary.descriptor, flippedDet.descriptor);
    const ttaMs = Math.round(performance.now() - tTtaStart);
    if (primary.telemetry) {
      const embeddingMs = primary.telemetry.latencies.embeddingMs + ttaMs;
      const totalMs = primary.telemetry.latencies.totalMs + ttaMs;
      const updatedLatencies = {
        ...primary.telemetry.latencies,
        embeddingMs,
        totalMs,
      };
      return {
        ...primary,
        descriptor: avg,
        telemetry: { ...primary.telemetry, latencies: updatedLatencies },
        stageLatencies: updatedLatencies,
      };
    }
    return { ...primary, descriptor: avg };
  } catch {
    return primary;
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
  if (det.sharpness < 35) {
    issues.push(
      "Photo looks soft or blurry — hold steady, tap to focus, and use good light.",
    );
  } else if (det.sharpness < 52) {
    issues.push(
      "Slightly blurry — a sharper, well-lit selfie gives a more accurate match.",
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

  const ok =
    issues.length === 0 &&
    det.confidence >= 0.45 &&
    det.sharpness >= 42 &&
    faceCoverage >= minFaceCoverageThreshold &&
    det.illumination >= 0.20 &&
    det.illumination <= 0.90;

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

