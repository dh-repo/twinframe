/**
 * Measured calibration of P(rank-1 is the true identity | geometry), fitted by
 * scripts/calibrate-edgeface.mjs successor logic against the leak-excluded
 * held-out protocol v2.1 in full 512-d geometry (n=303, 2026-08): refit via scripts/refit-calibration.ts, deterministic.
 *
 * Features are raw EdgeFace cosine distances:
 *   f1 = dTrue        (distance of the candidate shown to the user)
 *   f2 = gap          (dBestWrong - dTrue: separability from the nearest other identity)
 * Standardized with the recorded mu/sd, then logistic(w . z).
 */
export const CALIBRATION_VERSION = "heldout-v2.1-logistic-512d-n303-2026-08";

export const CALIBRATION_COEFFS = {
  intercept: 4.3639,
  wDtrue: -1.9435,
  wGap: 6.5781,
  muDtrue: 0.4146,
  muGap: 0.1493,
  sdDtrue: 0.2961,
  sdGap: 0.3233,
} as const;

const clampProb = (p: number) => Math.max(0.001, Math.min(0.999, p));

export function probabilityCorrect(dCandidate: number, gapToBestOther: number): number {
  const c = CALIBRATION_COEFFS;
  if (!Number.isFinite(dCandidate) || !Number.isFinite(gapToBestOther)) return clampProb(0);
  const z1 = (dCandidate - c.muDtrue) / c.sdDtrue;
  const z2 = (gapToBestOther - c.muGap) / c.sdGap;
  const logit = c.intercept + c.wDtrue * z1 + c.wGap * z2;
  return clampProb(1 / (1 + Math.exp(-logit)));
}

/** Minimal shape calibration needs — avoids coupling to the full CelebrityMatch. */
export interface CalibratableMatch {
  celebrityId: string;
  distance?: number;
}

/**
 * Calibrated P(rank-1 is the true identity) given the observed geometry.
 * Only meaningful for the TOP match: deeper ranks lack a well-defined dTrue
 * (the true identity may not be ranked at all), so they are left unannotated.
 *
 * Train/serve note: training used dTrue of the actual identity; serving uses the
 * top match's own distance as its proxy. On misses this overestimates the
 * candidate's quality-distance, pushing probability DOWN — a conservative bias,
 * which is the honest direction.
 */
export function calibratedRank1Probability(matches: CalibratableMatch[]): number | undefined {
  const top = matches[0];
  if (!top || !Number.isFinite(top.distance)) return undefined;
  let bestOther = Infinity;
  for (let j = 1; j < matches.length; j++) {
    if (matches[j]!.celebrityId === top.celebrityId) continue;
    const d = matches[j]!.distance;
    if (Number.isFinite(d)) bestOther = Math.min(bestOther, d as number);
  }
  // Unknown separability (single candidate or all-others-hidden): fall back to the
  // training-mean gap instead of pretending infinite separation.
  const gap = Number.isFinite(bestOther)
    ? bestOther - (top.distance as number)
    : CALIBRATION_COEFFS.muGap;
  return probabilityCorrect(top.distance as number, gap);
}
