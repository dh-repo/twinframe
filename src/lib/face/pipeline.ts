import type { PackId } from "../celebrities/packs.ts";
import type { FaceFeatures, FaceQuality, FaceTelemetry, MatchResult } from "./types.ts";
import { ENGINE_VERSION } from "./types.ts";
import { emptyFeatures } from "./math.ts";
import { rankByDescriptor } from "./match.ts";
import {
  detectAndDescribe,
  detectAndDescribeWithTTA,
  prefetchFaceApi,
  assessDetectionQuality,
  logFaceTelemetry,
  type FaceDetectionResult,
} from "./faceapi-engine.ts";
import { loadCelebrityEmbeddings, prefetchEmbeddings } from "./embeddings.ts";
import { loadGalleryFeatures } from "../celebrities/load-gallery-features.ts";
import { detectSCRFD } from "./scrfd.ts";
import { runExpNormFrontalizationWGSL } from "./exp-norm-wgsl.ts";
import { align5PointSimilarityTensor } from "./similarity-transform.ts";
import { extractEdgeFaceEmbeddingWithTta } from "./edgeface.ts";
import { computeBiohash } from "./biohash.ts";
import { detectionFromAccuFace, pipelineLog, sourceDimensions, unpadScrfdDetections } from "./accuface-detection.ts";
import {
  hardQualityRefuseGate,
  openSetMissMessage,
  poseRefuseGate,
} from "./lookalike-policy.ts";
import { averageQueryEmbeddings, burstKeepCount, rankBurstDrawables } from "./query-burst.ts";

export type PipelineStatus =
  | "idle"
  | "loading-model"
  | "ready"
  | "analyzing"
  | "error";

export type FaceAnalyzeSource =
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement;

/** Warm models + gallery in the background. */
export function prefetchModel(): void {
  if (typeof window === "undefined") return;
  prefetchFaceApi();
  prefetchEmbeddings();
  void loadGalleryFeatures();
}

/** Paste a tight face crop onto a larger neutral canvas so SCRFD sees margin. */
function padSourceForDetection(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  marginRatio = 0.6,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  let w = 0;
  let h = 0;
  if ("naturalWidth" in source && source.naturalWidth) {
    w = source.naturalWidth;
    h = source.naturalHeight;
  } else if ("videoWidth" in source && source.videoWidth) {
    w = source.videoWidth;
    h = source.videoHeight;
  } else if ("width" in source) {
    w = source.width as number;
    h = source.height as number;
  }
  if (!w || !h) return null;
  const margin = Math.round(Math.max(w, h) * marginRatio);
  const canvas = document.createElement("canvas");
  canvas.width = w + margin * 2;
  canvas.height = h + margin * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, margin, margin, w, h);
  return canvas;
}

export interface AnalyzeOptions {
  topK?: number;
  /** Restrict ranking to a themed pack before scoring. */
  pack?: PackId;
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

interface QueryEmbedPass {
  source: FaceAnalyzeSource;
  alignmentSource: FaceAnalyzeSource | HTMLCanvasElement | OffscreenCanvas;
  padMargin: number;
  scrfdResult: Awaited<ReturnType<typeof detectSCRFD>> | null;
  alignedTensor: Float32Array | null;
  frontalizationMethod: "exp-norm-wgsl" | "5pt-similarity" | "bbox-crop";
  frontalizationMs: number;
  scrfdPassMs: number;
  edgeFaceEmbedding: Float32Array | null;
  embeddingPassMs: number;
  ttaApplied: boolean;
  ttaViews: number;
}

/**
 * Detect, align, and embed a single source. Burst ranking happens *before*
 * this so we never run 10 full SCRFD+EdgeFace passes.
 */
async function runDetectAlignEmbed(
  source: FaceAnalyzeSource,
): Promise<QueryEmbedPass> {
  pipelineLog("scrfd:start");

  // 1. Run SCRFD-2.5G face detection pass. The analysis source is usually the
  // tight face crop approved in crop review; SCRFD misses faces that fill the
  // whole frame, so retry once on a margin-padded canvas (mirrors enrollment).
  const scrfdStart = performance.now();
  let alignmentSource: FaceAnalyzeSource | HTMLCanvasElement | OffscreenCanvas = source;
  let padMargin = 0;
  let scrfdResult = await detectSCRFD(source).catch((err) => {
    console.warn("[Pipeline] SCRFD-2.5G detection pass failed; proceeding to fallback:", err);
    return null;
  });
  if (scrfdResult && !scrfdResult.primary) {
    pipelineLog("scrfd:pad-retry");
    const padded = padSourceForDetection(source);
    if (padded) {
      const retry = await detectSCRFD(padded).catch(() => null);
      if (retry?.primary) {
        scrfdResult = retry;
        alignmentSource = padded;
        padMargin = Math.round((padded.width - sourceDimensions(source).w) / 2);
      }
    }
  }
  const scrfdPassMs = scrfdResult ? scrfdResult.latencyMs : Math.round(performance.now() - scrfdStart);
  pipelineLog("scrfd:done", {
    ms: scrfdPassMs,
    faces: scrfdResult?.detections.length ?? 0,
    hasPrimary: Boolean(scrfdResult?.primary),
    yaw: scrfdResult?.primary?.pose.yaw ?? null,
  });

  // 2. Expression-Aware 3D UV WGSL Frontalization vs 5-Point Similarity Fallback
  let alignedTensor: Float32Array | null = null;
  let frontalizationMethod: "exp-norm-wgsl" | "5pt-similarity" | "bbox-crop" = "5pt-similarity";
  let frontalizationMs = 0;

  if (scrfdResult && scrfdResult.primary) {
    const primary = scrfdResult.primary;
    const absYaw = Math.abs(primary.pose.yaw);
    const tFrontStart = performance.now();

    if (absYaw > 25) {
      pipelineLog("frontalize:wgsl", { yaw: primary.pose.yaw });
      try {
        alignedTensor = await runExpNormFrontalizationWGSL(
          alignmentSource as HTMLImageElement,
          primary.bbox,
          primary.pose,
          primary.landmarks,
          undefined,
          { outputSize: 112 }
        );
        frontalizationMethod = "exp-norm-wgsl";
      } catch (err) {
        console.warn("[Pipeline] ExpNorm WGSL failed; executing 5-point similarity fallback:", err);
        alignedTensor = align5PointSimilarityTensor(alignmentSource as HTMLImageElement, primary.landmarks, 112);
        frontalizationMethod = "5pt-similarity";
      }
    } else {
      pipelineLog("frontalize:5pt", { yaw: primary.pose.yaw });
      alignedTensor = align5PointSimilarityTensor(alignmentSource as HTMLImageElement, primary.landmarks, 112);
      frontalizationMethod = "5pt-similarity";
    }

    frontalizationMs = Math.round(performance.now() - tFrontStart);
    pipelineLog("frontalize:done", { ms: frontalizationMs, method: frontalizationMethod });
  }

  // 3. Execute EdgeFace-M feature extraction (TTA when the EP is GPU)
  const tEmbStart = performance.now();
  let edgeFaceEmbedding: Float32Array | null = null;
  let embeddingPassMs = 0;
  let ttaApplied = false;
  let ttaViews = 0;

  try {
    pipelineLog("edgeface:start", { hasAlignedTensor: Boolean(alignedTensor) });
    const efRes = await extractEdgeFaceEmbeddingWithTta(
      alignedTensor ?? source,
      scrfdResult?.primary?.landmarks
    );
    edgeFaceEmbedding = efRes.embedding;
    embeddingPassMs = efRes.latencyMs;
    ttaApplied = efRes.ttaApplied;
    ttaViews = efRes.ttaViews;
    pipelineLog("edgeface:done", {
      ms: embeddingPassMs,
      dim: edgeFaceEmbedding.length,
      ttaApplied,
      ttaViews,
      provider: efRes.providerUsed,
    });
  } catch (err) {
    console.warn("[Pipeline] EdgeFace-M extraction failed; falling back:", err);
    embeddingPassMs = Math.round(performance.now() - tEmbStart);
    pipelineLog("edgeface:fail", { ms: embeddingPassMs });
  }

  return {
    source,
    alignmentSource,
    padMargin,
    scrfdResult,
    alignedTensor,
    frontalizationMethod,
    frontalizationMs,
    scrfdPassMs,
    edgeFaceEmbedding,
    embeddingPassMs,
    ttaApplied,
    ttaViews,
  };
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
  const onProgress = options.onProgress;
  const tPipeline = performance.now();
  pipelineLog("start");

  onProgress?.(0, 12);
  const galleryPromise = loadCelebrityEmbeddings();

  onProgress?.(1, 28);
  const pass = await runDetectAlignEmbed(source);

  onProgress?.(2, 62);
  return completeQueryAnalysis(pass, options, tPipeline, galleryPromise);
}

/**
 * Rank sharpest burst frames (Laplacian, no detector), embed the top 3–5,
 * then L2-average. Single-image uploads should keep using analyzeFaceSource.
 */
export async function analyzeFaceBurst(
  sources: FaceAnalyzeSource[],
  options: AnalyzeOptions = {},
): Promise<MatchResult> {
  if (sources.length <= 1) {
    const only = sources[0];
    if (!only) {
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
    return analyzeFaceSource(only, options);
  }

  const onProgress = options.onProgress;
  const tPipeline = performance.now();
  pipelineLog("burst:start", { n: sources.length });
  onProgress?.(0, 10);
  const galleryPromise = loadCelebrityEmbeddings();

  const ranked = rankBurstDrawables(sources);
  const selected = ranked.slice(0, burstKeepCount(ranked.length));
  pipelineLog("burst:ranked", {
    kept: selected.length,
    topSharpness: selected[0]?.score.sharpness ?? null,
  });

  onProgress?.(1, 24);
  const passes: QueryEmbedPass[] = [];
  for (let i = 0; i < selected.length; i++) {
    const row = selected[i]!;
    const pass = await runDetectAlignEmbed(row.source);
    passes.push(pass);
    onProgress?.(1, 24 + Math.round(((i + 1) / selected.length) * 36));
  }

  const embeddings = passes
    .map((p) => p.edgeFaceEmbedding)
    .filter((v): v is Float32Array => Boolean(v));
  const primary =
    passes.find((p) => p.edgeFaceEmbedding) ??
    passes[0] ??
    (await runDetectAlignEmbed(selected[0]!.source));

  if (embeddings.length >= 2) {
    primary.edgeFaceEmbedding = averageQueryEmbeddings(embeddings);
    pipelineLog("burst:centroid", { views: embeddings.length });
  }

  onProgress?.(2, 62);
  return completeQueryAnalysis(primary, options, tPipeline, galleryPromise);
}

async function completeQueryAnalysis(
  pass: QueryEmbedPass,
  options: AnalyzeOptions,
  tPipeline: number,
  galleryPromise: ReturnType<typeof loadCelebrityEmbeddings>,
): Promise<MatchResult> {
  const topK = options.topK ?? 5;
  const onProgress = options.onProgress;
  const source = pass.source;
  const {
    padMargin,
    scrfdResult,
    frontalizationMethod,
    frontalizationMs,
    scrfdPassMs,
    embeddingPassMs,
  } = pass;
  const edgeFaceEmbedding = pass.edgeFaceEmbedding;

  // 3b. Biohashing telemetry pass — never allowed to break the analysis
  let biohashMs = 0;
  if (edgeFaceEmbedding) {
    const tBioStart = performance.now();
    try {
      computeBiohash(edgeFaceEmbedding);
    } catch (err) {
      console.warn("[Pipeline] Biohash telemetry failed (non-fatal):", err);
    }
    biohashMs = Math.round(performance.now() - tBioStart);
  }

  const accufaceLatencies = {
    modelLoadMs: 0,
    downscaleMs: 0,
    scrfdPassMs,
    frontalizationMs,
    embeddingMs: embeddingPassMs,
    embeddingPassMs,
    biohashMs,
    totalMs: Math.round(performance.now() - tPipeline),
    ssdPassMs: 0,
    claheMs: 0,
  };

  // AccuFace already has box + landmarks + the matching embedding. FaceAPI
  // SSD/age/FaceNet is a second detector that parked the UI at step 2
  // (ticker capped at 88%) for tens of seconds on CPU-only devices.
  let det: FaceDetectionResult | null = null;
  if (edgeFaceEmbedding && scrfdResult?.primary) {
    pipelineLog("faceapi:skip", { reason: "edgeface+scrfd", padMargin });
    const orig = sourceDimensions(source);
    const detections =
      padMargin > 0
        ? unpadScrfdDetections(scrfdResult.detections, padMargin, orig.w, orig.h)
        : scrfdResult.detections;
    const primaryIndex = scrfdResult.detections.indexOf(scrfdResult.primary);
    const primary = detections[primaryIndex] ?? detections[0]!;
    det = detectionFromAccuFace({
      source,
      embedding: edgeFaceEmbedding,
      detections,
      primary,
      latencies: accufaceLatencies,
      frontalizationMethod,
    });
  } else {
    pipelineLog("faceapi:fallback", {
      hasEdgeFace: Boolean(edgeFaceEmbedding),
      hasScrfd: Boolean(scrfdResult?.primary),
    });
    det = edgeFaceEmbedding
      ? await detectAndDescribe(source, { ...options, skipDescriptor: true, maxSide: 512 })
      : await detectAndDescribeWithTTA(source, options);
    pipelineLog("faceapi:fallback-done");
  }

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
    onProgress?.(2, 72, {
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

  onProgress?.(3, 84);
  pipelineLog("gallery:wait");
  const gallery = await galleryPromise;
  pipelineLog("gallery:ready", { n: gallery.length });

  onProgress?.(3, 92);

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

  const poseGate = poseRefuseGate({
    yaw: det.telemetry?.estimatedYaw ?? scrfdResult?.primary?.pose.yaw,
    pitch: det.telemetry?.estimatedPitch ?? scrfdResult?.primary?.pose.pitch,
  });
  const hardGate = hardQualityRefuseGate({
    ok: quality.ok,
    score: quality.score,
    faceCoverage,
    sharpness: quality.sharpness,
    illumination: quality.illumination,
    confidence: det.confidence,
    issues: quality.issues,
  });

  const features: FaceFeatures = emptyFeatures();

  if (!poseGate.pass || !hardGate.pass) {
    const refuse = !poseGate.pass ? poseGate : hardGate;
    const issues = [...quality.issues];
    if (refuse.message && !issues.includes(refuse.message)) {
      issues.unshift(refuse.message);
    }
    onProgress?.(3, 100);
    return {
      features,
      quality: {
        ...quality,
        ok: false,
        issues,
      },
      matches: [],
      analyzedAt: Date.now(),
      engineVersion: ENGINE_VERSION,
      facePreviewUrl,
      estimatedAge: Number.isFinite(det.age) ? Math.round(det.age) : undefined,
      estimatedGender: det.gender === "male" || det.gender === "female" ? det.gender : undefined,
      telemetry: det.telemetry,
    };
  }

  const matches = rankByDescriptor(
    {
      descriptor: det.descriptor,
      age: det.age,
      gender: det.gender,
      genderProbability: det.genderProbability,
      detConfidence: det.confidence,
      sharpness: det.sharpness,
      faceCoverage,
      qualityScore: quality.score,
      smileIntensity: det.telemetry?.smileIntensity,
    },
    gallery,
    topK,
    { pack: options.pack },
  );

  onProgress?.(3, 98);

  // Distance floor emptied the top-K — surface as a soft open-set miss.
  if (matches.length === 0) {
    const issues = [...quality.issues];
    const miss = openSetMissMessage(Boolean(options.pack && options.pack !== "all"));
    if (!issues.includes(miss)) issues.unshift(miss);
    return {
      features,
      quality: {
        ...quality,
        ok: false,
        issues,
      },
      matches: [],
      analyzedAt: Date.now(),
      engineVersion: ENGINE_VERSION,
      facePreviewUrl,
      estimatedAge: Number.isFinite(det.age) ? Math.round(det.age) : undefined,
      estimatedGender: det.gender === "male" || det.gender === "female" ? det.gender : undefined,
      telemetry: det.telemetry,
    };
  }

  pipelineLog("rank:done", {
    matches: matches.length,
    top: matches[0]?.name ?? null,
    totalMs: Math.round(performance.now() - tPipeline),
  });

  return {
    features,
    quality,
    matches,
    analyzedAt: Date.now(),
    engineVersion: ENGINE_VERSION,
    facePreviewUrl,
    estimatedAge: Number.isFinite(det.age) ? Math.round(det.age) : undefined,
    estimatedGender: det.gender === "male" || det.gender === "female" ? det.gender : undefined,
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

