import type { FaceFeatures, FaceQuality, FaceTelemetry, MatchResult } from "./types.ts";
import { ENGINE_VERSION } from "./types.ts";
import { emptyFeatures } from "./math.ts";
import { rankByDescriptor } from "./match.ts";
import {
  detectAndDescribeWithTTA,
  prefetchFaceApi,
  assessDetectionQuality,
  logFaceTelemetry,
} from "./faceapi-engine.ts";
import { loadCelebrityEmbeddings, prefetchEmbeddings } from "./embeddings.ts";
import { detectSCRFD } from "./scrfd.ts";
import { runExpNormFrontalizationWGSL } from "./exp-norm-wgsl.ts";
import { align5PointSimilarityTensor } from "./similarity-transform.ts";
import { extractEdgeFaceEmbedding } from "./edgeface.ts";
import { computeBiohash } from "./biohash.ts";

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
  selectedCandidateIndex?: number;
  selectedBox?: { x: number; y: number; width: number; height: number };
  onProgress?: (
    stepIndex: number,
    progressPct: number,
    details?: {
      normalizedBox?: { x: number; y: number; width: number; height: number };
      normalizedLandmarks?: { x: number; y: number }[];
      croppedLandmarks?: { x: number; y: number }[];
      facePreviewUrl?: string;
      imageWidth?: number;
      imageHeight?: number;
      candidateBoxes?: Array<{ x: number; y: number; width: number; height: number; isPrimary: boolean }>;
      telemetry?: FaceTelemetry;
    },
  ) => void;
}

/**
 * AccuFace v4.0 Pipeline:
 * SCRFD-2.5G Face Detection -> Expression-Aware 3D UV WGSL Frontalization (|yaw| > 25°)
 * / 5-Point Umeyama Similarity Transform (|yaw| <= 25°) -> Embedding Extraction & Matcher.
 */
export async function analyzeFaceSource(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: AnalyzeOptions = {},
): Promise<MatchResult> {
  const topK = options.topK ?? 5;
  const onProgress = options.onProgress;

  onProgress?.(0, 15);
  const galleryPromise = loadCelebrityEmbeddings();

  onProgress?.(1, 35);

  // 1. Run SCRFD-2.5G face detection pass
  const scrfdStart = performance.now();
  const scrfdResult = await detectSCRFD(source).catch((err) => {
    console.warn("[Pipeline] SCRFD-2.5G detection pass failed; proceeding to fallback:", err);
    return null;
  });
  const scrfdPassMs = scrfdResult ? scrfdResult.latencyMs : Math.round(performance.now() - scrfdStart);

  // 2. Expression-Aware 3D UV WGSL Frontalization vs 5-Point Similarity Fallback
  let alignedTensor: Float32Array | null = null;
  let frontalizationMethod: "exp-norm-wgsl" | "5pt-similarity" | "bbox-crop" = "5pt-similarity";
  let frontalizationMs = 0;

  if (scrfdResult && scrfdResult.primary) {
    const primary = scrfdResult.primary;
    const absYaw = Math.abs(primary.pose.yaw);
    const tFrontStart = performance.now();

    if (absYaw > 25) {
      try {
        alignedTensor = await runExpNormFrontalizationWGSL(
          source,
          primary.bbox,
          primary.pose,
          primary.landmarks,
          undefined,
          { outputSize: 112 }
        );
        frontalizationMethod = "exp-norm-wgsl";
      } catch (err) {
        console.warn("[Pipeline] ExpNorm WGSL failed; executing 5-point similarity fallback:", err);
        alignedTensor = align5PointSimilarityTensor(source, primary.landmarks, 112);
        frontalizationMethod = "5pt-similarity";
      }
    } else {
      alignedTensor = align5PointSimilarityTensor(source, primary.landmarks, 112);
      frontalizationMethod = "5pt-similarity";
    }

    frontalizationMs = Math.round(performance.now() - tFrontStart);
  }

  // 3. Execute EdgeFace-M 256-d feature extraction pass
  const tEmbStart = performance.now();
  let edgeFaceEmbedding: Float32Array | null = null;
  let embeddingPassMs = 0;

  try {
    const efRes = await extractEdgeFaceEmbedding(
      alignedTensor ?? source,
      scrfdResult?.primary?.landmarks
    );
    edgeFaceEmbedding = efRes.embedding;
    embeddingPassMs = efRes.latencyMs;
  } catch (err) {
    console.warn("[Pipeline] EdgeFace-M extraction failed; falling back:", err);
    embeddingPassMs = Math.round(performance.now() - tEmbStart);
  }

  // 3b. Biohashing telemetry pass (bypassing destructive Anti-GAN subspace projection)
  let biohashMs = 0;
  if (edgeFaceEmbedding) {
    const tBioStart = performance.now();
    computeBiohash(edgeFaceEmbedding);
    biohashMs = Math.round(performance.now() - tBioStart);
  }

  // 4. Execute detection & age/gender analysis pass
  const det = await detectAndDescribeWithTTA(source, options);

  // 5. Update stage latencies and telemetry metadata
  if (det) {
    if (edgeFaceEmbedding) {
      det.descriptor = edgeFaceEmbedding;
    }
    if (det.telemetry) {
      det.telemetry.latencies.scrfdPassMs = scrfdPassMs;
      det.telemetry.latencies.frontalizationMs = frontalizationMs;
      det.telemetry.latencies.embeddingPassMs = embeddingPassMs;
      det.telemetry.latencies.embeddingMs = embeddingPassMs;
      det.telemetry.latencies.biohashMs = biohashMs;
      det.telemetry.frontalizationMethod = frontalizationMethod;

      if (scrfdResult?.primary) {
        det.telemetry.estimatedYaw = scrfdResult.primary.pose.yaw;
        det.telemetry.estimatedPitch = scrfdResult.primary.pose.pitch;
        det.telemetry.estimatedRoll = scrfdResult.primary.pose.roll;
        det.telemetry.smileIntensity = scrfdResult.primary.smile?.smileIntensity;
      }
    }
  }

  let facePreviewUrl: string | undefined;
  if (det?.faceCanvas) {
    try {
      facePreviewUrl = det.faceCanvas.toDataURL("image/jpeg", 0.88);
    } catch {
      facePreviewUrl = undefined;
    }
  }

  if (det) {
    onProgress?.(1, 55, {
      normalizedBox: det.normalizedBox,
      normalizedLandmarks: det.normalizedLandmarks,
      croppedLandmarks: det.croppedLandmarks,
      facePreviewUrl,
      imageWidth: det.imageWidth,
      imageHeight: det.imageHeight,
      candidateBoxes: det.candidateBoxes,
      telemetry: det.telemetry,
    });
    if (det.telemetry) {
      logFaceTelemetry(det.telemetry);
    }
  }

  onProgress?.(2, 75);
  const gallery = await galleryPromise;

  onProgress?.(3, 90);

  if (!det) {
    onProgress?.(3, 100);
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
  const faceCoverage =
    (det.box.width * det.box.height) /
    Math.max(1, det.imageWidth * det.imageHeight);
  const matches = rankByDescriptor(
    {
      descriptor: det.descriptor,
      age: det.age,
      gender: det.gender,
      genderProbability: det.genderProbability,
      // Feed real detection quality into match confidence (was defaulting to optimistic values)
      detConfidence: det.confidence,
      sharpness: det.sharpness,
      faceCoverage,
      qualityScore: quality.score,
      smileIntensity: det.telemetry?.smileIntensity,
    },
    gallery,
    topK,
  );

  onProgress?.(3, 98);

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
    telemetry: det.telemetry,
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

