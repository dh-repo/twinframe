/**
 * Open-set look-alike policy: quality/pose refuse gates and distance floors.
 * Verification Top-1 on enrolled celebs is a different objective — these gates
 * keep the product from presenting weak nearest neighbors as doppelgängers.
 * Displayed percents are further calibrated by open-set-score.ts (Hill × margin).
 */

/** Absolute yaw (degrees) beyond which we refuse ranking. */
export const POSE_YAW_REFUSE_DEG = 40;
/** Absolute pitch (degrees) beyond which we refuse ranking. */
export const POSE_PITCH_REFUSE_DEG = 35;

/** Hard blur floor — below this we refuse (sharper than soft quality.ok). */
export const HARD_SHARPNESS_MIN = 35;
/** Hard detection confidence floor. */
export const HARD_DET_CONFIDENCE_MIN = 0.35;
/** Hard minimum face coverage (fraction of image area). */
export const HARD_FACE_COVERAGE_MIN = 0.02;

/**
 * Max adjusted cosine distance still treated as a presentable nearest neighbor.
 * Beyond this, rankByDescriptor returns [] (orthogonal / garbage probes).
 * EdgeFace-512 calibration: best-of-1000 impostor p90 ≈ 0.67.
 *
 * Percents below Distant Twin (<55%) are still a card — labeled Distant Twin,
 * not a doppelgänger. Refusing those emptied the product for ordinary selfies.
 */
export const LOOKALIKE_MAX_ADJUSTED_DISTANCE = 0.72;

export interface PoseGateInput {
  yaw?: number | null;
  pitch?: number | null;
}

export interface QualityGateInput {
  ok: boolean;
  score: number;
  faceCoverage: number;
  sharpness: number;
  illumination: number;
  confidence: number;
  issues: string[];
}

export type LookalikeRefuseReason =
  | "pose"
  | "blur"
  | "confidence"
  | "coverage"
  | "illumination"
  | "quality"
  | "distance";

export interface LookalikeGateResult {
  pass: boolean;
  reason?: LookalikeRefuseReason;
  message?: string;
}

export function poseRefuseGate(pose: PoseGateInput): LookalikeGateResult {
  const yaw = typeof pose.yaw === "number" && Number.isFinite(pose.yaw) ? Math.abs(pose.yaw) : 0;
  const pitch =
    typeof pose.pitch === "number" && Number.isFinite(pose.pitch) ? Math.abs(pose.pitch) : 0;
  if (yaw > POSE_YAW_REFUSE_DEG || pitch > POSE_PITCH_REFUSE_DEG) {
    return {
      pass: false,
      reason: "pose",
      message:
        "Head angle is too extreme for a reliable look-alike — face the camera more directly.",
    };
  }
  return { pass: true };
}

/**
 * Hard refuse before ranking. Soft quality.ok failures are handled in the UI
 * (quality-blocked with optional override) when matches still exist.
 */
export function hardQualityRefuseGate(q: QualityGateInput): LookalikeGateResult {
  if (q.faceCoverage < HARD_FACE_COVERAGE_MIN) {
    return {
      pass: false,
      reason: "coverage",
      message: "Face is too small in the frame — move closer and fill the square.",
    };
  }
  if (q.sharpness < HARD_SHARPNESS_MIN) {
    return {
      pass: false,
      reason: "blur",
      message: "Photo is too blurry for a reliable look-alike — hold steady and retake.",
    };
  }
  if (q.confidence < HARD_DET_CONFIDENCE_MIN) {
    return {
      pass: false,
      reason: "confidence",
      message: "Could not lock a clear face — try better light and a front view.",
    };
  }
  if (q.illumination < 0.12 || q.illumination > 0.96) {
    return {
      pass: false,
      reason: "illumination",
      message: "Lighting is too extreme — use even, front-facing light.",
    };
  }
  return { pass: true };
}

/** Soft UI gate: block auto-results but allow “see low-confidence” override. */
export function softQualityBlockGate(q: QualityGateInput): LookalikeGateResult {
  if (!q.ok || q.score < 0.45 || q.faceCoverage < 0.035 || q.sharpness < 42) {
    return {
      pass: false,
      reason: "quality",
      message: q.issues[0] ?? "Photo quality is too low for a high-confidence look-alike.",
    };
  }
  return { pass: true };
}

export const OPEN_SET_MISS_GALLERY =
  "No close look-alike in the gallery — try another photo or angle.";

export const OPEN_SET_MISS_PACK =
  "No close look-alike in this pack — try Everyone or another gallery.";

export function openSetMissMessage(scopedPack: boolean): string {
  return scopedPack ? OPEN_SET_MISS_PACK : OPEN_SET_MISS_GALLERY;
}

export function distanceLookalikeGate(
  bestAdjustedDistance: number,
  scopedPack = false,
): LookalikeGateResult {
  if (
    !Number.isFinite(bestAdjustedDistance) ||
    bestAdjustedDistance > LOOKALIKE_MAX_ADJUSTED_DISTANCE
  ) {
    return {
      pass: false,
      reason: "distance",
      message: openSetMissMessage(scopedPack),
    };
  }
  return { pass: true };
}
