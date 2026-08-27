/**
 * Margin-aware verdict tiers.
 *
 * The displayed percent already blends absolute distance (Hill) with the
 * top-2 gap (open-set factor). A verdict answers the blunter question a user
 * actually asks: "is this my twin, or just the closest enrolled face?"
 *
 * Two independent signals decide it:
 *  - absolute adjusted distance — how close the nearest face really is
 *  - rank margin (d2 - d1) — whether that face stands out from the pack
 *
 * A tiny margin means the gallery is crowded at that point, so even a small
 * absolute distance is not a distinctive twin.
 */

import {
  OPEN_SET_IDENTITY_DISTANCE,
  STRONG_LOOKALIKE_MIN_MARGIN,
} from "./open-set-score.ts";

export type VerdictTier =
  | "dead-ringer"
  | "strong-resemblance"
  | "soft-match"
  | "distant-twin";

export interface VerdictInput {
  /** Age/gender-adjusted cosine distance to the #1 celebrity. */
  adjustedDistance: number;
  /** d2 - d1 across the real gallery ranking. */
  rankMargin: number;
  /** Displayed match percent (post open-set suppression). */
  matchPercent: number;
}

/** A dead ringer must be inside identity range, not merely "closest". */
export const DEAD_RINGER_MAX_DISTANCE = OPEN_SET_IDENTITY_DISTANCE;

/** ...and must clearly beat #2, or it is a crowded neighborhood. */
export const DEAD_RINGER_MIN_MARGIN = 0.07;

/** Below this percent nothing above "distant twin" can be claimed. */
export const DISTANT_TWIN_MAX_PERCENT = 55;

/**
 * Minimum top-2 separation for any look-alike claim above distant twin.
 * Held-out evidence (v2.1, n=301): soft matches with margin < 0.02 were only
 * 42% correct — a lying label. At >= 0.02 they are 100% correct (n=19).
 */
export const SOFT_MATCH_MIN_MARGIN = 0.02;

/** Percent floor for the two upper tiers. */
export const STRONG_MIN_PERCENT = 70;

function finite(value: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function verdictFromMatch(input: VerdictInput): VerdictTier {
  const distance = finite(input.adjustedDistance, Number.POSITIVE_INFINITY);
  const margin = Math.max(0, finite(input.rankMargin, 0));
  const percent = finite(input.matchPercent, 0);

  if (percent < DISTANT_TWIN_MAX_PERCENT) return "distant-twin";

  // A crowded top-2 makes any look-alike claim fiction — demote to the honest
  // nearest-neighbor label even when the percent looks plausible.
  if (margin < SOFT_MATCH_MIN_MARGIN) return "distant-twin";

  if (
    distance <= DEAD_RINGER_MAX_DISTANCE &&
    margin >= DEAD_RINGER_MIN_MARGIN &&
    percent >= STRONG_MIN_PERCENT
  ) {
    return "dead-ringer";
  }

  if (percent >= STRONG_MIN_PERCENT && margin >= STRONG_LOOKALIKE_MIN_MARGIN) {
    return "strong-resemblance";
  }

  return "soft-match";
}

export function verdictLabel(tier: VerdictTier): string {
  switch (tier) {
    case "dead-ringer":
      return "Dead Ringer";
    case "strong-resemblance":
      return "Strong Resemblance";
    case "soft-match":
      return "Soft Match";
    case "distant-twin":
      return "Distant Twin";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/** Short line under the stamp. Honest about what the tier means. */
export function verdictSubtitle(tier: VerdictTier): string {
  switch (tier) {
    case "dead-ringer":
      return "Identity-range distance with a clear gap to #2.";
    case "strong-resemblance":
      return "Close face geometry that stands out from the runner-up.";
    case "soft-match":
      return "Close, but the runner-up is right behind.";
    case "distant-twin":
      return "Nearest face in the gallery — not a real look-alike.";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}
