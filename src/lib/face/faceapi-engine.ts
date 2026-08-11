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
  box: { x: number; y: number; width: number; height: number };
  imageWidth: number;
  imageHeight: number;
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

/**
 * Detect the largest face, extract FaceNet descriptor + age/gender, crop face.
 */
export async function detectAndDescribe(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): Promise<FaceDetectionResult | null> {
  const api = (await getFaceApi()) as any;
  const { w, h } = sourceSize(source);
  if (!w || !h) return null;

  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, cw, ch);

  const optsHigh = new api.SsdMobilenetv1Options({ minConfidence: 0.4 });
  const optsLow = new api.SsdMobilenetv1Options({ minConfidence: 0.15 });

  let det =
    (await api
      .detectSingleFace(canvas, optsHigh)
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
    const side = Math.max(bw, bh);
    const sx = bx + (bw - side) / 2;
    const sy = by + (bh - side) / 2;
    fctx.drawImage(canvas, sx, sy, side, side, 0, 0, outSize, outSize);
  }

  return {
    descriptor: det.descriptor,
    age: det.age,
    gender: det.gender as "male" | "female",
    genderProbability: det.genderProbability,
    faceCanvas,
    confidence: det.detection.score,
    box: {
      x: box.x / scale,
      y: box.y / scale,
      width: box.width / scale,
      height: box.height / scale,
    },
    imageWidth: w,
    imageHeight: h,
  };
}

export function assessDetectionQuality(det: FaceDetectionResult): {
  ok: boolean;
  score: number;
  faceCoverage: number;
  centered: number;
  issues: string[];
} {
  const issues: string[] = [];
  const area = det.box.width * det.box.height;
  const imgArea = det.imageWidth * det.imageHeight || 1;
  const faceCoverage = area / imgArea;

  if (faceCoverage < 0.02) {
    issues.push(
      "Face was very small in the photo — we zoomed in automatically. A closer selfie will be more accurate.",
    );
  } else if (faceCoverage < 0.05) {
    issues.push(
      "For a sharper match next time, fill more of the frame with your face.",
    );
  }

  if (det.confidence < 0.35) {
    issues.push(
      "Low face confidence — try better lighting and a clearer front view.",
    );
  }

  const cx = (det.box.x + det.box.width / 2) / det.imageWidth;
  const cy = (det.box.y + det.box.height / 2) / det.imageHeight;
  const centered = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / 0.5);

  const score = Math.min(
    1,
    det.confidence * 0.55 +
      Math.min(1, faceCoverage / 0.12) * 0.25 +
      centered * 0.2,
  );

  return {
    ok: issues.length === 0 && det.confidence >= 0.4,
    score,
    faceCoverage,
    centered,
    issues,
  };
}
