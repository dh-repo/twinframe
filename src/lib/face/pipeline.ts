import type { FaceFeatures, FaceQuality, FaceTelemetry, MatchResult } from "./types";
import { ENGINE_VERSION } from "./types";
import { emptyFeatures } from "./math";
import { enrichWithColor68, extractGeometryFeatures68 } from "./geometry";
import { rankByDescriptor } from "./match";
import {
  detectAndDescribeWithTTA,
  prefetchFaceApi,
  loadFaceApi,
  assessDetectionQuality,
  logFaceTelemetry,
  rasterizePaddedFaceImage,
} from "./faceapi-engine";
import { estimateRegionalOcclusion } from "./occlusion";
import { consensusFromFrames } from "./temporal";
import { loadCelebrityEmbeddings, prefetchEmbeddings } from "./embeddings";
import { estimateHeadPose68 } from "./pose";
import { analyzeImageQuality } from "./quality";

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
  void loadFaceApi().catch(() => {});
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
 * Full pipeline v2:
 * FaceNet 128-d descriptor + 68-point Landmark Fusion → rank against enrolled celebrity embeddings.
 * Auto-handles small faces in full-body photos via detector + crop.
 */
export async function analyzeFaceSource(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  options: AnalyzeOptions = {},
): Promise<MatchResult> {
  const topK = options.topK ?? 5;
  const onProgress = options.onProgress;

  onProgress?.(0, 15);
  const galleryPromise = loadCelebrityEmbeddings();

  // Pre-detection image quality gate: reject solid dark, bright, or featureless images
  try {
    const sw = (source as any).videoWidth || (source as any).naturalWidth || source.width || 0;
    const sh = (source as any).videoHeight || (source as any).naturalHeight || source.height || 0;
    if (sw > 0 && sh > 0 && typeof document !== "undefined") {
      const qCanvas = document.createElement("canvas");
      const sampleSize = 128;
      qCanvas.width = sampleSize;
      qCanvas.height = sampleSize;
      const qCtx = qCanvas.getContext("2d", { willReadFrequently: true });
      if (qCtx) {
        qCtx.drawImage(source as CanvasImageSource, 0, 0, sampleSize, sampleSize);
        const imgData = qCtx.getImageData(0, 0, sampleSize, sampleSize);
        const qMetrics = analyzeImageQuality(imgData);
        if (qMetrics.illuminationBalance < 0.05 || qMetrics.overallQuality < 0.12) {
          onProgress?.(3, 100);
          return {
            features: emptyFeatures(),
            quality: {
              ok: false,
              score: qMetrics.overallQuality,
              faceCoverage: 0,
              centered: 0,
              sharpness: qMetrics.sharpnessScore * 100,
              illumination: qMetrics.illuminationBalance,
              issues: [
                "No face found. Image is featureless, dark, or overexposed.",
                ...qMetrics.issues,
              ],
            },
            matches: [],
            analyzedAt: Date.now(),
            engineVersion: ENGINE_VERSION,
          };
        }
      }
    }
  } catch {
    /* quality check optional */
  }

  onProgress?.(1, 35);
  const det = await detectAndDescribeWithTTA(source, options);

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

  // Prefer croppedLandmarks (0–100 on faceCanvas) over normalizedLandmarks.
  const landmarkPoints = det.croppedLandmarks?.length
    ? det.croppedLandmarks
    : det.normalizedLandmarks;
  let features: FaceFeatures =
    landmarkPoints && landmarkPoints.length >= 68
      ? extractGeometryFeatures68(landmarkPoints)
      : emptyFeatures();

  // Live pose estimate damps geom fusion under large yaw (POS wired into ranking).
  const headPose =
    landmarkPoints && landmarkPoints.length >= 68
      ? estimateHeadPose68(landmarkPoints)
      : undefined;

  // Color wants native-res (24MP rims / hair). Occlusion stays on the 320
  // faceCanvas — high-res lash/brow texture false-positives clean faces.
  let previewImage: ImageData | null = null;
  if (det.faceCanvas) {
    const ctx = det.faceCanvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      previewImage = ctx.getImageData(0, 0, det.faceCanvas.width, det.faceCanvas.height);
    }
  }
  const detailImage =
    rasterizePaddedFaceImage(source, det.box, det.imageWidth, det.imageHeight) ??
    previewImage;
  if (detailImage && landmarkPoints && landmarkPoints.length >= 68) {
    features = enrichWithColor68(features, landmarkPoints, detailImage);
  }
  const occlusion =
    landmarkPoints && landmarkPoints.length >= 68
      ? estimateRegionalOcclusion(landmarkPoints, previewImage)
      : undefined;

  const matches = rankByDescriptor(
    {
      descriptor: det.descriptor,
      // Phase 0: min-distance over primary / flip / avg templates when TTA ran
      descriptors: det.descriptors,
      age: det.age,
      gender: det.gender,
      genderProbability: det.genderProbability,
      detConfidence: det.confidence,
      sharpness: det.sharpness,
      faceCoverage,
      qualityScore: quality.score,
      features,
      headPose,
      occlusion,
      projectIdentity: true,
    },
    gallery,
    topK,
  );

  onProgress?.(3, 98);

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
    candidates: det.allFaces,
    candidateBoxes: det.candidateBoxes,
    croppedLandmarks: landmarkPoints,
    occlusion,
  };
}

/**
 * Multi-frame burst: detect each frame without TTA, EMA consensus, one rank.
 */
export async function analyzeFaceBurst(
  sources: Array<HTMLImageElement | HTMLCanvasElement | HTMLVideoElement>,
  options: AnalyzeOptions = {},
): Promise<MatchResult> {
  if (!sources.length) {
    return {
      features: emptyFeatures(),
      quality: {
        ok: false,
        score: 0,
        faceCoverage: 0,
        centered: 0,
        sharpness: 0,
        illumination: 0,
        issues: ["No frames in burst."],
      },
      matches: [],
      analyzedAt: Date.now(),
      engineVersion: ENGINE_VERSION,
    };
  }
  if (sources.length === 1) return analyzeFaceSource(sources[0]!, options);

  const topK = options.topK ?? 5;
  const onProgress = options.onProgress;
  onProgress?.(0, 12);
  const galleryPromise = loadCelebrityEmbeddings();

  const frames: Array<{
    descriptor: Float32Array;
    features: FaceFeatures;
    headPose?: ReturnType<typeof estimateHeadPose68>;
    confidence: number;
    det: NonNullable<Awaited<ReturnType<typeof detectAndDescribeWithTTA>>>;
  }> = [];

  for (let i = 0; i < sources.length; i++) {
    const det = await detectAndDescribeWithTTA(sources[i]!, {
      ...options,
      tta: false,
      enableContrastBoost: i === 0,
    });
    onProgress?.(1, 20 + Math.round((i / sources.length) * 50));
    if (!det) continue;
    const lms = det.croppedLandmarks?.length ? det.croppedLandmarks : det.normalizedLandmarks;
    const features =
      lms && lms.length >= 68 ? extractGeometryFeatures68(lms) : emptyFeatures();
    const headPose = lms && lms.length >= 68 ? estimateHeadPose68(lms) : undefined;
    const desc = det.descriptor instanceof Float32Array
      ? det.descriptor
      : Float32Array.from(det.descriptor);
    frames.push({
      descriptor: desc,
      features,
      headPose,
      confidence: det.confidence,
      det,
    });
  }

  if (frames.length === 0) {
    return analyzeFaceSource(sources[sources.length - 1]!, options);
  }

  const consensus = consensusFromFrames(frames);
  const last = frames[frames.length - 1]!;
  const det = last.det;
  const gallery = await galleryPromise;
  onProgress?.(3, 88);

  const quality: FaceQuality = assessDetectionQuality(det);
  const faceCoverage =
    (det.box.width * det.box.height) /
    Math.max(1, det.imageWidth * det.imageHeight);
  // Prefer croppedLandmarks (0–100 on faceCanvas) over normalizedLandmarks.
  const landmarkPoints = det.croppedLandmarks?.length
    ? det.croppedLandmarks
    : det.normalizedLandmarks;
  let features = consensus?.features ?? last.features;
  const descriptor = consensus?.descriptor ?? last.descriptor;
  const headPose = consensus?.headPose ?? last.headPose;

  const burstSource = sources[sources.length - 1]!;
  let previewImage: ImageData | null = null;
  if (det.faceCanvas) {
    const ctx = det.faceCanvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      previewImage = ctx.getImageData(0, 0, det.faceCanvas.width, det.faceCanvas.height);
    }
  }
  const detailImage =
    rasterizePaddedFaceImage(
      burstSource,
      det.box,
      det.imageWidth,
      det.imageHeight,
    ) ?? previewImage;
  if (detailImage && landmarkPoints && landmarkPoints.length >= 68) {
    features = enrichWithColor68(features, landmarkPoints, detailImage);
  }
  const occlusion =
    landmarkPoints && landmarkPoints.length >= 68
      ? estimateRegionalOcclusion(landmarkPoints, previewImage)
      : undefined;

  let facePreviewUrl: string | undefined;
  if (det.faceCanvas) {
    try {
      facePreviewUrl = det.faceCanvas.toDataURL("image/jpeg", 0.88);
    } catch {
      facePreviewUrl = undefined;
    }
  }

  const matches = rankByDescriptor(
    {
      descriptor,
      descriptors: [descriptor],
      age: det.age,
      gender: det.gender,
      genderProbability: det.genderProbability,
      detConfidence: det.confidence,
      sharpness: det.sharpness,
      faceCoverage,
      qualityScore: quality.score,
      features,
      headPose,
      occlusion,
      projectIdentity: true,
    },
    gallery,
    topK,
  );

  onProgress?.(3, 100);
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
    candidates: det.allFaces,
    candidateBoxes: det.candidateBoxes,
    croppedLandmarks: landmarkPoints,
    occlusion,
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
