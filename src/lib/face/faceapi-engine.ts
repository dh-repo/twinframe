/* eslint-disable @typescript-eslint/no-explicit-any */

type FaceApiModule = typeof import("@vladmandic/face-api");

let faceApiMod: FaceApiModule | null = null;
let loadPromise: Promise<FaceApiModule> | null = null;

const MODEL_URL = "/models/face-api";

async function getFaceApi(): Promise<FaceApiModule> {
  if (typeof window === "undefined") {
    throw new Error("Face recognition only runs in the browser.");
  }
  if (faceApiMod) return faceApiMod;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Dynamic import keeps this out of the SSR/server graph
    const mod = await import("@vladmandic/face-api");
    const api = (mod as any).default?.nets ? (mod as any).default : mod;
    await Promise.all([
      api.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
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
  void getFaceApi().catch(() => {});
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
  imageWidth: number;
  imageHeight: number;
  landmarks?: unknown;
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
  let varSum = 0;
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

/**
 * Detect the largest face, extract FaceNet descriptor + age/gender, crop face.
 * High-accuracy: L2-normalized descriptor, 1280 maxSide, blur+lighting computed.
 */
export async function detectAndDescribe(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): Promise<FaceDetectionResult | null> {
  const api = (await getFaceApi()) as any;
  const { w, h } = sourceSize(source);
  if (!w || !h) return null;

  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // High-quality scaling when downsampling
  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, cw, ch);

  const optsHigh = new api.SsdMobilenetv1Options({ minConfidence: 0.45 });
  const optsMid = new api.SsdMobilenetv1Options({ minConfidence: 0.28 });
  const optsLow = new api.SsdMobilenetv1Options({ minConfidence: 0.15 });

  let det =
    (await api
      .detectSingleFace(canvas, optsHigh)
      .withFaceLandmarks()
      .withFaceDescriptor()
      .withAgeAndGender()) ||
    (await api
      .detectSingleFace(canvas, optsMid)
      .withFaceLandmarks()
      .withFaceDescriptor()
      .withAgeAndGender()) ||
    (await api
      .detectSingleFace(canvas, optsLow)
      .withFaceLandmarks()
      .withFaceDescriptor()
      .withAgeAndGender());

  if (!det) {
    const all = await api
      .detectAllFaces(canvas, optsLow)
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withAgeAndGender();
    if (all.length > 0) {
      all.sort(
        (a: any, b: any) =>
          b.detection.box.width * b.detection.box.height -
          a.detection.box.width * a.detection.box.height,
      );
      det = all[0];
    }
  }

  if (!det) return null;

  const box = det.detection.box;
  const pad = 0.35;
  const bx = Math.max(0, box.x - box.width * pad);
  const by = Math.max(0, box.y - box.height * pad * 1.1);
  const bw = Math.min(cw - bx, box.width * (1 + pad * 2));
  const bh = Math.min(ch - by, box.height * (1 + pad * 2.2));

  const faceCanvas = document.createElement("canvas");
  const outSize = 320;
  faceCanvas.width = outSize;
  faceCanvas.height = outSize;
  const fctx = faceCanvas.getContext("2d");
  if (fctx) {
    (fctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
    const side = Math.max(bw, bh);
    const sx = bx + (bw - side) / 2;
    const sy = by + (bh - side) / 2;
    fctx.drawImage(canvas, sx, sy, side, side, 0, 0, outSize, outSize);
  }

  const rawDesc = det.descriptor as ArrayLike<number>;
  const descriptor = l2NormalizeVec(rawDesc);
  const { sharpness, illumination } = computeSharpness(faceCanvas);
  const blurScore = Math.min(1, sharpness / 65);

  return {
    descriptor,
    age: det.age,
    gender: det.gender as "male" | "female",
    genderProbability: det.genderProbability,
    faceCanvas,
    confidence: det.detection.score,
    sharpness,
    blurScore,
    illumination,
    box: {
      x: box.x / scale,
      y: box.y / scale,
      width: box.width / scale,
      height: box.height / scale,
    },
    imageWidth: w,
    imageHeight: h,
    landmarks: det.landmarks,
  };
}

/**
 * High-accuracy TTA: averaged descriptor from original + horizontally flipped view.
 * Returns the higher-confidence result with averaged embedding for better pose invariance.
 */
export async function detectAndDescribeWithTTA(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): Promise<FaceDetectionResult | null> {
  const primary = await detectAndDescribe(source);
  if (!primary) return null;

  // Quick blur gate: if very sharp already, skip TTA to save time
  // For highest accuracy we always do flip averaging when confidence <0.75
  if (primary.confidence > 0.82 && primary.sharpness > 72) return primary;

  try {
    // Create flipped source
    const { w, h } = sourceSize(source);
    const flipCanvas = document.createElement("canvas");
    flipCanvas.width = w;
    flipCanvas.height = h;
    const fctx = flipCanvas.getContext("2d");
    if (!fctx) return primary;
    fctx.translate(w, 0);
    fctx.scale(-1, 1);
    fctx.drawImage(source as unknown as CanvasImageSource, 0, 0);

    const flipped = await detectAndDescribe(flipCanvas);
    if (!flipped) return primary;

    // Average descriptors in normalized space
    const avg = averageDescriptors(primary.descriptor, flipped.descriptor);

    // Keep primary's geometry but use averaged descriptor; age/gender from higher conf
    const bestAgeGender = flipped.confidence > primary.confidence ? flipped : primary;

    return {
      ...primary,
      descriptor: avg,
      age: bestAgeGender.age,
      gender: bestAgeGender.gender,
      genderProbability: Math.max(primary.genderProbability, flipped.genderProbability),
      // marginal sharpness boost from averaging
      sharpness: Math.max(primary.sharpness, flipped.sharpness),
      blurScore: Math.max(primary.blurScore, flipped.blurScore),
    };
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

  if (faceCoverage < 0.025) {
    issues.push(
      "Face was very small in the photo — we zoomed in automatically. A closer selfie will be more accurate.",
    );
  } else if (faceCoverage < 0.06) {
    issues.push(
      "For a sharper match next time, fill more of the frame with your face.",
    );
  }

  if (det.confidence < 0.42) {
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
  if (det.illumination < 0.28) {
    issues.push("Dim lighting detected — brighter, even light improves accuracy.");
  } else if (det.illumination > 0.92) {
    issues.push("Very bright / overexposed — soften harsh light for better detail.");
  }

  const cx = (det.box.x + det.box.width / 2) / det.imageWidth;
  const cy = (det.box.y + det.box.height / 2) / det.imageHeight;
  const centered = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / 0.5);
  if (centered < 0.55) {
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
    det.confidence >= 0.48 &&
    det.sharpness >= 45 &&
    faceCoverage >= 0.04 &&
    det.illumination >= 0.25 &&
    det.illumination <= 0.88;

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
