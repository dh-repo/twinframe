import { STRONG_LOOKALIKE_MIN_MARGIN } from "../face/open-set-score.ts";
import type { AttributeConflict } from "../face/lookalike-policy.ts";

/** FaceNet mid-scores are not real look-alikes. Shared by results UI + share card. */
export type HonestyBand = "weak" | "soft" | "strong";

/** Below this: closest available match, not a look-alike. */
export const WEAK_MATCH_MAX = 60;
/** Below this: possible resemblance; at/above: strong visual resemblance (if margin OK). */
export const SOFT_MATCH_MAX = 80;

export function honestyBand(
  matchPercent: number,
  rankMargin?: number,
  attributeConflict?: AttributeConflict,
): HonestyBand {
  let band: HonestyBand;
  if (matchPercent < WEAK_MATCH_MAX) band = "weak";
  else if (matchPercent < SOFT_MATCH_MAX) band = "soft";
  else band = "strong";

  if (
    band === "strong" &&
    typeof rankMargin === "number" &&
    Number.isFinite(rankMargin) &&
    rankMargin < STRONG_LOOKALIKE_MIN_MARGIN
  ) {
    band = "soft";
  }

  if (attributeConflict === "strong" && band !== "weak") return "weak";
  if (attributeConflict === "partial" && band === "strong") return "soft";
  return band;
}

export function honestyHeadline(band: HonestyBand): string {
  switch (band) {
    case "weak":
      return "CLOSEST AVAILABLE MATCH";
    case "soft":
      return "POSSIBLE LOOK-ALIKE";
    case "strong":
      return "STRONG VISUAL RESEMBLANCE";
    default: {
      const _exhaustive: never = band;
      return _exhaustive;
    }
  }
}

export function honestyShareLabel(band: HonestyBand): string {
  switch (band) {
    case "weak":
      return "Closest available match";
    case "soft":
      return "Possible look-alike";
    case "strong":
      return "Visual resemblance";
    default: {
      const _exhaustive: never = band;
      return _exhaustive;
    }
  }
}

export function honestyRating(
  band: HonestyBand,
  confidenceScore: number,
): string {
  switch (band) {
    case "weak":
      return "NO STRONG DOUBLE";
    case "soft":
      return "MODERATE RESEMBLANCE";
    case "strong":
      if (confidenceScore >= 80) return "HIGH CONFIDENCE";
      if (confidenceScore >= 60) return "MODERATE CONFIDENCE";
      return "CALIBRATED MATCH";
    default: {
      const _exhaustive: never = band;
      return _exhaustive;
    }
  }
}

export function restListHeading(topPercent: number, rankMargin?: number, attributeConflict?: AttributeConflict): string {
  return honestyBand(topPercent, rankMargin, attributeConflict) === "weak"
    ? "OTHER NEAREST NEIGHBORS"
    : "ALSO CLOSE";
}

/** Weak tops are a nearest neighbor, not a look-alike pack — don't list the crowd. */
export function shouldShowContenders(
  topPercent: number,
  rankMargin?: number,
  attributeConflict?: AttributeConflict,
): boolean {
  return honestyBand(topPercent, rankMargin, attributeConflict) !== "weak";
}

export function shareText(
  name: string,
  matchPercent: number,
  rankMargin?: number,
  attributeConflict?: AttributeConflict,
): string {
  const band = honestyBand(matchPercent, rankMargin, attributeConflict);
  const pct = Math.round(matchPercent);
  if (band === "weak") {
    return `Closest available celebrity on Twinframe: ${name} (${pct}% resemblance index) — no strong double found.`;
  }
  if (band === "soft") {
    return `Possible look-alike on Twinframe: ${name} at ${pct}% resemblance.`;
  }
  return `Strong visual resemblance to ${name} (${pct}%) on Twinframe.`;
}

/** Hide age when the estimate is likely junk (cartoons, blur, extreme values). */
export function shouldShowEstimatedAge(
  age: number | null | undefined,
  quality?: { score?: number; sharpness?: number },
  extras?: { youthfulness?: number },
): boolean {
  if (age == null || !Number.isFinite(age)) return false;
  // Never display a child age — the net overshoots kids and it is the wrong label.
  if (age < 16 || age > 80) return false;
  const score = quality?.score ?? 1;
  const sharpness = quality?.sharpness ?? 100;
  if (score < 0.35 || sharpness < 40) return false;
  if (age > 75 && (score < 0.55 || sharpness < 55)) return false;
  const youth = extras?.youthfulness;
  // Age-net often reports ~18–21 for children. High youthfulness + "teen" → hide.
  if (typeof youth === "number" && age <= 22 && youth >= 0.68) return false;
  return true;
}
