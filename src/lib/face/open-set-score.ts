/**
 * Open-set look-alike calibration.
 *
 * Closed-set ranking (who is nearest) stays cosine distance. Displayed percent
 * answers a different question: is this a distinctive look-alike, or just the
 * nearest of ~1,000 famous faces?
 *
 * Hill(d) maps absolute cosine distance. Margin (d2 − d1) down-weights crowded
 * nearest-neighbors so typical open-set 60–75% scores become honest
 * nearest-neighbor numbers. Identity-range distances (d ≤ 0.40) keep full
 * Hill credit so enrolled-celeb probes are unchanged.
 */

/** Distances at or below this are identity / very-strong look-alike — no margin tax. */
export const OPEN_SET_IDENTITY_DISTANCE = 0.4;

/** Margin (d2 − d1) that earns full Hill credit outside identity range. */
export const OPEN_SET_MARGIN_FULL = 0.08;

/** Margins at or below this get the strongest suppression. */
export const OPEN_SET_MARGIN_FLOOR = 0.015;

/** Multiplier applied to Hill percent when the top-2 gap is at the floor. */
export const OPEN_SET_MARGIN_FACTOR_MIN = 0.68;

/** A "strong doppelgänger" claim also needs this much top-2 separation. */
export const STRONG_LOOKALIKE_MIN_MARGIN = 0.05;

export function rankMargin(adjustedDistances: readonly number[]): number {
  if (adjustedDistances.length < 2) return OPEN_SET_MARGIN_FULL;
  const d1 = adjustedDistances[0];
  const d2 = adjustedDistances[1];
  if (typeof d1 !== "number" || typeof d2 !== "number") return OPEN_SET_MARGIN_FULL;
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return OPEN_SET_MARGIN_FULL;
  return Math.max(0, d2 - d1);
}

export function openSetMarginFactor(margin: number, bestDistance?: number): number {
  if (
    typeof bestDistance === "number" &&
    Number.isFinite(bestDistance) &&
    bestDistance <= OPEN_SET_IDENTITY_DISTANCE
  ) {
    return 1;
  }
  if (typeof margin !== "number" || !Number.isFinite(margin)) return 1;
  const m = Math.max(0, margin);
  if (m >= OPEN_SET_MARGIN_FULL) return 1;
  if (m <= OPEN_SET_MARGIN_FLOOR) return OPEN_SET_MARGIN_FACTOR_MIN;
  const span = OPEN_SET_MARGIN_FULL - OPEN_SET_MARGIN_FLOOR;
  const t = (m - OPEN_SET_MARGIN_FLOOR) / span;
  return OPEN_SET_MARGIN_FACTOR_MIN + t * (1 - OPEN_SET_MARGIN_FACTOR_MIN);
}

export function applyOpenSetLookalikePercent(
  hillPercent: number,
  margin: number,
  bestDistance?: number,
): number {
  if (typeof hillPercent !== "number" || Number.isNaN(hillPercent)) return 0;
  const factor = openSetMarginFactor(margin, bestDistance);
  const pct = Math.max(0, Math.min(100, hillPercent * factor));
  return Math.round(pct * 10) / 10;
}

export function applyOpenSetLookalikePercents(
  hillPercents: readonly number[],
  margin: number,
  bestDistance?: number,
): number[] {
  return hillPercents.map((p) => applyOpenSetLookalikePercent(p, margin, bestDistance));
}
