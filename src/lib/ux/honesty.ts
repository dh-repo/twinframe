import { STRONG_LOOKALIKE_MIN_MARGIN } from "../face/open-set-score.ts";
import type { VerdictTier } from "../face/verdict.ts";

/** FaceNet mid-scores are not real look-alikes. Shared by results UI + share card. */
export type HonestyBand = "weak" | "soft" | "strong";

export const WEAK_MATCH_MAX = 55;
export const SOFT_MATCH_MAX = 70;

export function honestyBand(matchPercent: number, rankMargin?: number): HonestyBand {
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
    return "soft";
  }
  return band;
}

/** Named verdict → the share / list honesty band. Dead ringer is still "strong". */
export function honestyBandFromVerdict(tier: VerdictTier): HonestyBand {
  switch (tier) {
    case "distant-twin":
      return "weak";
    case "soft-match":
      return "soft";
    case "strong-resemblance":
    case "dead-ringer":
      return "strong";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/** Reverse map for callers that still speak in bands. Strong cannot recover dead-ringer. */
export function verdictFromHonestyBand(band: HonestyBand): VerdictTier {
  switch (band) {
    case "weak":
      return "distant-twin";
    case "soft":
      return "soft-match";
    case "strong":
      return "strong-resemblance";
    default: {
      const _exhaustive: never = band;
      return _exhaustive;
    }
  }
}

function bandFromSignals(
  matchPercent: number,
  rankMargin?: number,
  verdict?: VerdictTier,
): HonestyBand {
  if (verdict) return honestyBandFromVerdict(verdict);
  return honestyBand(matchPercent, rankMargin);
}

export function honestyHeadline(band: HonestyBand): string {
  switch (band) {
    case "weak":
      return "NEAREST GALLERY NEIGHBOR";
    case "soft":
      return "POSSIBLE LOOK-ALIKE";
    case "strong":
      return "TOP DOPPELGÄNGER MATCH";
    default: {
      const _exhaustive: never = band;
      return _exhaustive;
    }
  }
}

export function honestyShareLabel(band: HonestyBand): string {
  switch (band) {
    case "weak":
      return "Nearest neighbor";
    case "soft":
      return "Possible look-alike";
    case "strong":
      return "Look-alike";
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
      return "NOT A STRONG MATCH";
    case "soft":
      return "MODERATE MATCH";
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

export function restListHeading(
  topPercent: number,
  rankMargin?: number,
  verdict?: VerdictTier,
): string {
  return bandFromSignals(topPercent, rankMargin, verdict) === "weak"
    ? "OTHER NEAREST NEIGHBORS"
    : "ALSO CLOSE";
}

/** Weak / distant-twin tops are a nearest neighbor, not a look-alike pack. */
export function shouldShowContenders(
  topPercent: number,
  rankMargin?: number,
  verdict?: VerdictTier,
): boolean {
  return bandFromSignals(topPercent, rankMargin, verdict) !== "weak";
}

export function shareText(
  name: string,
  matchPercent: number,
  rankMargin?: number,
  verdict?: VerdictTier,
): string {
  const band = bandFromSignals(matchPercent, rankMargin, verdict);
  const pct = Math.round(matchPercent);
  if (verdict === "dead-ringer") {
    return `Dead ringer: I matched ${name} at ${pct}% on Twinframe.`;
  }
  if (band === "weak") {
    return `Nearest gallery neighbor on Twinframe: ${name} (${pct}% face similarity) — not a strong look-alike.`;
  }
  if (band === "soft") {
    return `Possible look-alike on Twinframe: ${name} at ${pct}% similarity.`;
  }
  return `I matched ${name} at ${pct}% on Twinframe.`;
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
