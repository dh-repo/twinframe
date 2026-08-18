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
 * Max adjusted cosine distance still treated as a presentable look-alike.
 * Beyond this, rankByDescriptor returns [] (no forced top-K).
 * EdgeFace-512 calibration: best-of-1000 impostor p90 ≈ 0.67; refusing past
 * 0.72 (≈32% on the Hill map) keeps genuinely-far probes out of top-K.
 */
export const LOOKALIKE_MAX_ADJUSTED_DISTANCE = 0.72;

/** Match percent below this is not shown as a look-alike top-K. */
export const LOOKALIKE_MIN_PERCENT = 32;

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

export type AttributeConflict = "none" | "partial" | "strong";

/** Soft presentation clash — never a hard rank drop (inferred attributes). */
export const GENDER_CONFLICT_MIN_PROB = 0.72;
export const AGE_CONFLICT_DELTA_YRS = 28;

export function attributeConflictLevel(
  user: {
    gender?: string;
    genderProbability?: number;
    age?: number;
  },
  celeb: {
    gender?: string;
    age?: number;
  },
): AttributeConflict {
  let clashes = 0;
  const genderKnown = user.gender === "male" || user.gender === "female";
  const celebGender = celeb.gender === "male" || celeb.gender === "female" ? celeb.gender : undefined;
  const gProb =
    typeof user.genderProbability === "number" && Number.isFinite(user.genderProbability)
      ? user.genderProbability
      : 0;
  if (genderKnown && celebGender && user.gender !== celebGender && gProb >= GENDER_CONFLICT_MIN_PROB) {
    clashes += 1;
  }
  const userAge = typeof user.age === "number" && Number.isFinite(user.age) ? user.age : undefined;
  const celebAge = typeof celeb.age === "number" && Number.isFinite(celeb.age) ? celeb.age : undefined;
  if (userAge !== undefined && celebAge !== undefined && Math.abs(userAge - celebAge) > AGE_CONFLICT_DELTA_YRS) {
    clashes += 1;
  }
  if (clashes >= 2) return "strong";
  if (clashes === 1) return "partial";
  return "none";
}

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

export function distanceLookalikeGate(
  bestAdjustedDistance: number,
  topMatchPercent?: number,
): LookalikeGateResult {
  if (
    !Number.isFinite(bestAdjustedDistance) ||
    bestAdjustedDistance > LOOKALIKE_MAX_ADJUSTED_DISTANCE
  ) {
    return {
      pass: false,
      reason: "distance",
      message: "No close look-alike in the gallery — try another photo or angle.",
    };
  }
  if (
    typeof topMatchPercent === "number" &&
    Number.isFinite(topMatchPercent) &&
    topMatchPercent < LOOKALIKE_MIN_PERCENT
  ) {
    return {
      pass: false,
      reason: "distance",
      message: "No close look-alike in the gallery — try another photo or angle.",
    };
  }
  return { pass: true };
}
