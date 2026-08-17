/**
 * Enrollment QA for cleaner galleries: frontal pose, expression stillness,
 * single-face sharpness heuristics. Used by audit scripts and future rebuilds.
 */

export interface EnrollmentPoseSignals {
  yawDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  smileIntensity?: number;
}

export interface EnrollmentImageSignals extends EnrollmentPoseSignals {
  faceCount: number;
  faceCoverage: number;
  sharpness: number;
  illumination: number;
  detConfidence: number;
}

export const ENROLL_MAX_YAW_DEG = 18;
export const ENROLL_MAX_PITCH_DEG = 15;
export const ENROLL_MAX_ROLL_DEG = 20;
export const ENROLL_MAX_SMILE = 0.55;
export const ENROLL_MIN_SHARPNESS = 48;
export const ENROLL_MIN_COVERAGE = 0.08;
export const ENROLL_MIN_CONFIDENCE = 0.55;
export const ENROLL_ILLUM_MIN = 0.22;
export const ENROLL_ILLUM_MAX = 0.88;

export interface EnrollmentQaResult {
  ok: boolean;
  score: number;
  issues: string[];
}

export function scoreEnrollmentCandidate(s: EnrollmentImageSignals): EnrollmentQaResult {
  const issues: string[] = [];
  if (s.faceCount !== 1) {
    issues.push(s.faceCount < 1 ? "No face detected" : "Multiple faces in frame");
  }
  const yaw = Math.abs(s.yawDeg ?? 0);
  const pitch = Math.abs(s.pitchDeg ?? 0);
  const roll = Math.abs(s.rollDeg ?? 0);
  if (yaw > ENROLL_MAX_YAW_DEG) issues.push(`Yaw too high (${yaw.toFixed(0)}°)`);
  if (pitch > ENROLL_MAX_PITCH_DEG) issues.push(`Pitch too high (${pitch.toFixed(0)}°)`);
  if (roll > ENROLL_MAX_ROLL_DEG) issues.push(`Roll too high (${roll.toFixed(0)}°)`);
  if ((s.smileIntensity ?? 0) > ENROLL_MAX_SMILE) {
    issues.push("Expression too strong — prefer neutral frontals");
  }
  if (s.sharpness < ENROLL_MIN_SHARPNESS) issues.push("Not sharp enough");
  if (s.faceCoverage < ENROLL_MIN_COVERAGE) issues.push("Face coverage too small");
  if (s.detConfidence < ENROLL_MIN_CONFIDENCE) issues.push("Low detection confidence");
  if (s.illumination < ENROLL_ILLUM_MIN || s.illumination > ENROLL_ILLUM_MAX) {
    issues.push("Illumination out of range");
  }

  const poseScore =
    1 -
    Math.min(1, yaw / (ENROLL_MAX_YAW_DEG * 2)) * 0.35 -
    Math.min(1, pitch / (ENROLL_MAX_PITCH_DEG * 2)) * 0.25 -
    Math.min(1, roll / (ENROLL_MAX_ROLL_DEG * 2)) * 0.1;
  const sharpScore = Math.min(1, s.sharpness / 70);
  const covScore = Math.min(1, s.faceCoverage / 0.2);
  const score = Math.max(
    0,
    Math.min(
      1,
      poseScore * 0.4 +
        sharpScore * 0.25 +
        covScore * 0.15 +
        Math.min(1, s.detConfidence) * 0.2,
    ),
  );

  return {
    ok: issues.length === 0 && score >= 0.55,
    score: Math.round(score * 1000) / 1000,
    issues,
  };
}
