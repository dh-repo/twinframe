/**
 * Hard-probe conditions for honest accuracy evaluation.
 *
 * Tier-1 self-portraits measure the easy case. Real users shoot in bad light,
 * wearing glasses, mid-laugh, turned away, or with the phone six inches from
 * their nose. Accuracy claims are only meaningful when stratified by these.
 */

export type HardProbeCondition =
  | "low-light"
  | "glasses"
  | "big-smile"
  | "yaw-gt-25"
  | "phone-closeup";

export const HARD_PROBE_CONDITIONS: readonly HardProbeCondition[] = [
  "low-light",
  "glasses",
  "big-smile",
  "yaw-gt-25",
  "phone-closeup",
];

export function isHardProbeCondition(value: string): value is HardProbeCondition {
  return (HARD_PROBE_CONDITIONS as readonly string[]).includes(value);
}

export function hardProbeLabel(condition: HardProbeCondition): string {
  switch (condition) {
    case "low-light":
      return "Low light";
    case "glasses":
      return "Glasses";
    case "big-smile":
      return "Big smile";
    case "yaw-gt-25":
      return "Yaw > 25°";
    case "phone-closeup":
      return "Phone close-up";
    default: {
      const _exhaustive: never = condition;
      return _exhaustive;
    }
  }
}

/** Signals available from the existing detect + quality pass. */
export interface HardProbeSignals {
  /** Mean luma of the face crop, 0-1. */
  meanLuma?: number;
  /** Absolute head yaw in degrees. */
  yawDeg?: number;
  /** Detected smile intensity, 0-1. */
  smileIntensity?: number;
  /** Face box area / image area. */
  faceCoverage?: number;
  /** Glasses cannot be inferred from geometry; supplied by labeling metadata. */
  glasses?: boolean;
}

export const LOW_LIGHT_MAX_LUMA = 0.34;
export const YAW_HARD_MIN_DEG = 25;
export const BIG_SMILE_MIN_INTENSITY = 0.6;
export const PHONE_CLOSEUP_MIN_COVERAGE = 0.42;

/** Derive every condition a probe satisfies. A probe may be hard in several ways. */
export function classifyHardProbe(signals: HardProbeSignals): HardProbeCondition[] {
  const out: HardProbeCondition[] = [];
  const { meanLuma, yawDeg, smileIntensity, faceCoverage, glasses } = signals;

  if (typeof meanLuma === "number" && Number.isFinite(meanLuma) && meanLuma <= LOW_LIGHT_MAX_LUMA) {
    out.push("low-light");
  }
  if (glasses === true) out.push("glasses");
  if (
    typeof smileIntensity === "number" &&
    Number.isFinite(smileIntensity) &&
    smileIntensity >= BIG_SMILE_MIN_INTENSITY
  ) {
    out.push("big-smile");
  }
  if (typeof yawDeg === "number" && Number.isFinite(yawDeg) && Math.abs(yawDeg) > YAW_HARD_MIN_DEG) {
    out.push("yaw-gt-25");
  }
  if (
    typeof faceCoverage === "number" &&
    Number.isFinite(faceCoverage) &&
    faceCoverage >= PHONE_CLOSEUP_MIN_COVERAGE
  ) {
    out.push("phone-closeup");
  }
  return out;
}
