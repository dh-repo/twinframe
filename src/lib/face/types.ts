import type { VerdictTier } from "./verdict.ts";

/** Normalized facial feature vector used for matching (0–1 scale unless noted). */
export interface FaceFeatures {
  faceAspect: number;
  jawWidth: number;
  chinSharpness: number;
  foreheadHeight: number;
  eyeSpacing: number;
  eyeOpenness: number;
  eyeSlant: number;
  browHeight: number;
  noseLength: number;
  noseWidth: number;
  mouthWidth: number;
  lipFullness: number;
  cheekboneProminence: number;
  faceRoundness: number;
  skinL: number;
  skinA: number;
  skinB: number;
  hairL: number;
  hairA: number;
  hairB: number;
  masculine: number;
  feminine: number;
  youthfulness: number;
}

export type FeatureKey = keyof FaceFeatures;

export const FEATURE_KEYS: FeatureKey[] = [
  "faceAspect",
  "jawWidth",
  "chinSharpness",
  "foreheadHeight",
  "eyeSpacing",
  "eyeOpenness",
  "eyeSlant",
  "browHeight",
  "noseLength",
  "noseWidth",
  "mouthWidth",
  "lipFullness",
  "cheekboneProminence",
  "faceRoundness",
  "skinL",
  "skinA",
  "skinB",
  "hairL",
  "hairA",
  "hairB",
  "masculine",
  "feminine",
  "youthfulness",
];

export const FEATURE_WEIGHTS: Record<FeatureKey, number> = {
  faceAspect: 1.4,
  jawWidth: 1.5,
  chinSharpness: 1.1,
  foreheadHeight: 0.9,
  eyeSpacing: 1.3,
  eyeOpenness: 0.8,
  eyeSlant: 1.2,
  browHeight: 0.7,
  noseLength: 1.2,
  noseWidth: 1.1,
  mouthWidth: 1.0,
  lipFullness: 1.0,
  cheekboneProminence: 1.3,
  faceRoundness: 1.2,
  skinL: 1.6,
  skinA: 1.4,
  skinB: 1.4,
  hairL: 0.9,
  hairA: 0.7,
  hairB: 0.7,
  masculine: 1.8,
  feminine: 1.8,
  youthfulness: 1.0,
};

export interface FaceQuality {
  ok: boolean;
  score: number;
  faceCoverage: number;
  centered: number;
  sharpness: number;
  illumination: number;
  issues: string[];
}

export interface TraitInsight {
  trait: string;
  userValue: number;
  celebValue: number;
  similarity: number;
  label: string;
}

export interface CelebrityMatch {
  celebrityId: string;
  name: string;
  knownFor: string;
  matchPercent: number;
  rawScore: number;
  confidenceScore?: number;
  traits: TraitInsight[];
  accentHue: number;
  initials: string;
  tags: string[];
  gender?: "male" | "female" | "unknown";
  photoUrl?: string;
  photoUrl192?: string;
  fallbackPhotoUrl?: string;
  distance?: number;
  /** Age/gender-adjusted cosine distance used for ranking. */
  adjustedDistance?: number;
  /** Hill percent before open-set margin suppression. */
  hillPercent?: number;
  /** Adjusted d2 − d1. Small values mean a crowded nearest-neighbor, not a doppelgänger. */
  rankMargin?: number;
  /** Named look-alike tier from absolute distance + margin. */
  verdict?: VerdictTier;
  /** One-line shared-trait copy for the reveal / share card. */
  blurb?: string;
  /**
   * Calibrated P(this candidate is the true identity), measured on the leak-excluded
   * held-out protocol (see src/lib/face/calibration.ts). Set on rank-1 only — the
   * claim is not defined for deeper ranks.
   */
  probabilityCorrect?: number;
}

/**
 * Detailed breakdown of face processing stage execution latencies in milliseconds.
 */
export interface FaceStageLatencies {
  /** Time spent loading/fetching ONNX Runtime / WASM / neural network models */
  modelLoadMs: number;
  /** Time spent downscaling input image to detection canvas dimensions */
  downscaleMs: number;
  /** Time spent on SCRFD-2.5G face detection pass */
  scrfdPassMs?: number;
  /** Time spent on ExpNorm 3D UV WGSL frontalization pass (or 5-point similarity fallback) */
  frontalizationMs?: number;
  /** Time spent on EdgeFace-M 256-d Float16 descriptor embedding extraction */
  embeddingMs: number;
  /** Explicit latency for EdgeFace-M embedding extraction pass */
  embeddingPassMs?: number;
  /** Time spent on 512-bit binary Biohashing projection & candidate screening */
  biohashMs?: number;
  /** Total wall-clock execution latency for full face analysis */
  totalMs: number;
  /** Legacy SSD MobileNet detector latency */
  ssdPassMs?: number;
  /** Legacy CLAHE contrast boost latency */
  claheMs?: number;
}

export interface SCRFDBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SCRFDLandmark {
  x: number;
  y: number;
}

export interface SCRFDPose {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface SmileMetrics {
  /** Mouth width to inter-ocular distance ratio */
  smileRatio: number;
  /** Oral commissure elevation delta (un-rolled) relative to nose base */
  commissureElevation: number;
  /** Estimated smile expression intensity [0.0..1.0] */
  smileIntensity: number;
}

/**
 * Computes smile and oral deformation metrics from 5 canonical landmarks.
 */
export function estimateSmileMetrics(landmarks: Float32Array | number[][]): SmileMetrics {
  let lx: number, ly: number, rx: number, ry: number, nx: number, ny: number, lmx: number, lmy: number, rmx: number, rmy: number;

  if (Array.isArray(landmarks)) {
    [lx, ly] = landmarks[0];
    [rx, ry] = landmarks[1];
    [nx, ny] = landmarks[2];
    [lmx, lmy] = landmarks[3];
    [rmx, rmy] = landmarks[4];
  } else {
    lx = landmarks[0]; ly = landmarks[1];
    rx = landmarks[2]; ry = landmarks[3];
    nx = landmarks[4]; ny = landmarks[5];
    lmx = landmarks[6]; lmy = landmarks[7];
    rmx = landmarks[8]; rmy = landmarks[9];
  }

  const dxEye = rx - lx;
  const dyEye = ry - ly;
  const iod = Math.sqrt(dxEye * dxEye + dyEye * dyEye);
  const safeIod = Math.max(1e-5, iod);
  const rollRad = Math.atan2(dyEye, dxEye);
  const sinR = Math.sin(-rollRad);
  const cosR = Math.cos(-rollRad);

  // Mouth width
  const dxMouth = rmx - lmx;
  const dyMouth = rmy - lmy;
  const mouthWidth = Math.sqrt(dxMouth * dxMouth + dyMouth * dyMouth);
  const smileRatio = mouthWidth / safeIod;

  // Un-rolled mouth corner vertical positions relative to nose
  const lCornerDy = (lmx - nx) * sinR + (lmy - ny) * cosR;
  const rCornerDy = (rmx - nx) * sinR + (rmy - ny) * cosR;
  const avgCornerDy = (lCornerDy + rCornerDy) / 2;

  // Neutral mouth width ratio is ~0.65-0.75. Wide smile is > 0.82.
  // Commissure elevation pulls mouth corners up towards nose.
  const rawSmile = (smileRatio - 0.72) / 0.20;
  const smileIntensity = Math.max(0.0, Math.min(1.0, rawSmile));

  return {
    smileRatio: Math.round(smileRatio * 100) / 100,
    commissureElevation: Math.round(avgCornerDy * 100) / 100,
    smileIntensity: Math.round(smileIntensity * 100) / 100,
  };
}

export interface SCRFDDetectionResult {
  bbox: SCRFDBoundingBox;
  normalizedBox: SCRFDBoundingBox;
  score: number;
  confidence: number;
  landmarks: Float32Array; // 5x2 landmarks as flat Float32Array(10)
  normalizedLandmarks: SCRFDLandmark[];
  pose: SCRFDPose;
  smile?: SmileMetrics;
}

export interface ExpNormOptions {
  outputSize?: 112 | 160;
  blendshapeWeights?: Float32Array;
  device?: any;
}

/**
 * Diagnostic telemetry data recorded during face detection and analysis.
 */
export interface FaceTelemetry {
  /** Original image source width in pixels */
  originalWidth: number;
  /** Original image source height in pixels */
  originalHeight: number;
  /** Downscaled detection canvas width in pixels */
  downscaledWidth: number;
  /** Downscaled detection canvas height in pixels */
  downscaledHeight: number;
  /** Number of face candidates detected in original image */
  faceCount: number;
  /** Detector confidence score for primary selected face [0.0..1.0] */
  primaryConfidence: number;
  /** Breakdown of stage latencies */
  latencies: FaceStageLatencies;
  /** Frontalization method executed for alignment */
  frontalizationMethod?: "exp-norm-wgsl" | "5pt-similarity" | "bbox-crop";
  /** Estimated head yaw angle in degrees */
  estimatedYaw?: number;
  /** Estimated head pitch angle in degrees */
  estimatedPitch?: number;
  /** Estimated head roll angle in degrees */
  estimatedRoll?: number;
  /** Estimated smile intensity [0.0..1.0] */
  smileIntensity?: number;
}

export interface MatchResult {
  features: FaceFeatures | null;
  quality: FaceQuality;
  matches: CelebrityMatch[];
  analyzedAt: number;
  engineVersion: string;
  facePreviewUrl?: string;
  estimatedAge?: number;
  estimatedGender?: string;
  telemetry?: FaceTelemetry;
}

export const ENGINE_VERSION = "4.0.0-accuface";


