import type { FaceFeatures, FaceQuality, MatchResult } from "./types";
import { ENGINE_VERSION } from "./types";
import { emptyFeatures } from "./math";
import { rankByDescriptor } from "./match";
import {
  detectAndDescribeWithTTA,
  prefetchFaceApi,
  assessDetectionQuality,
} from "./faceapi-engine";
import { loadCelebrityEmbeddings, prefetchEmbeddings } from "./embeddings";

export type PipelineStatus =
  | "idle"
  | "loading-model"
  | "ready"
  | "analyzing"
  | "error";

/** Warm models + gallery in the background. */
export function prefetchModel(): void {
  if (typeof window === "undefined") return;
  prefetchFaceApi();
  prefetchEmbeddings();
}

export interface AnalyzeOptions {
  topK?: number;
}

/**
 * Full pipeline v2:
 * FaceNet 128-d descriptor → rank against enrolled celebrity embeddings.
 * Auto-handles small faces in full-body photos via detector + crop.
 */
export async function analyzeFaceSource(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: AnalyzeOptions = {},
): Promise<MatchResult> {
  const topK = options.topK ?? 5;

  const [det, gallery] = await Promise.all([
    detectAndDescribeWithTTA(source),
    loadCelebrityEmbeddings(),
  ]);

  if (!det) {
    return {
      features: emptyFeatures(),
      quality: {
        ok: false,
        score: 0,
        faceCoverage: 0,
        centered: 0,
        sharpness: 0,
        illumination: 0,
        issues: [
          "No face found. Use a clear photo with your face visible — front-facing works best.",
        ],
      },
      matches: [],
      analyzedAt: Date.now(),
      engineVersion: ENGINE_VERSION,
    };
  }

  const quality: FaceQuality = assessDetectionQuality(det);
  const matches = rankByDescriptor(
    {
      descriptor: det.descriptor,
      age: det.age,
      gender: det.gender,
      genderProbability: det.genderProbability,
    },
    gallery,
    topK,
  );

  let facePreviewUrl: string | undefined;
  try {
    facePreviewUrl = det.faceCanvas.toDataURL("image/jpeg", 0.88);
  } catch {
    facePreviewUrl = undefined;
  }

  // Geometry features left empty for embedding path (traits come from age/gender/embedding)
  const features: FaceFeatures = emptyFeatures();

  return {
    features,
    quality,
    matches,
    analyzedAt: Date.now(),
    engineVersion: ENGINE_VERSION,
    facePreviewUrl,
    estimatedAge: Math.round(det.age),
    estimatedGender: det.gender,
  };
}

/**
 * Load a File / Blob into an HTMLImageElement (decode ready).
 */
export function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode that image. Try a JPG or PNG."));
    };
    img.src = url;
  });
}
