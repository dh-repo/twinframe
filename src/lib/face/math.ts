import type { FaceFeatures, FeatureKey } from "./types.ts";
import { FEATURE_KEYS, FEATURE_WEIGHTS } from "./types.ts";

/** Clamp value into [min, max]. */
export function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

/** Euclidean distance between two 2D points. */
export function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Midpoint of two points. */
export function mid(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Weighted cosine similarity in [0, 1] (mapped from [-1,1]). */
export function weightedCosineSimilarity(
  a: FaceFeatures,
  b: FaceFeatures,
  weights: Record<FeatureKey, number> = FEATURE_WEIGHTS,
): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const key of FEATURE_KEYS) {
    const w = weights[key];
    const av = a[key] * w;
    const bv = b[key] * w;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return clamp((cos + 1) / 2);
}

/**
 * Weighted L1 similarity (1 − average weighted absolute difference).
 * Often more stable than cosine for bounded face metrics.
 */
export function weightedL1Similarity(
  a: FaceFeatures,
  b: FaceFeatures,
  weights: Record<FeatureKey, number> = FEATURE_WEIGHTS,
): number {
  let sumW = 0;
  let sumDiff = 0;
  for (const key of FEATURE_KEYS) {
    const w = weights[key];
    sumW += w;
    sumDiff += w * Math.abs(a[key] - b[key]);
  }
  if (sumW === 0) return 0;
  return clamp(1 - sumDiff / sumW);
}

/**
 * Ensemble score: blend L1 structure match with cosine for robustness.
 * Returns raw score in ~[0, 1].
 */
export function ensembleScore(
  a: FaceFeatures,
  b: FaceFeatures,
  weights: Record<FeatureKey, number> = FEATURE_WEIGHTS,
): number {
  const l1 = weightedL1Similarity(a, b, weights);
  const cos = weightedCosineSimilarity(a, b, weights);
  return clamp(0.68 * l1 + 0.32 * cos);
}

/**
 * Convert raw ensemble scores into calibrated match percentages.
 * Uses a temperature-scaled softmax over the top candidates, then maps
 * the winner into a human-friendly 62–98% band so results feel credible.
 */
export function calibrateMatchPercents(
  rawScores: number[],
  temperature = 0.08,
): number[] {
  if (rawScores.length === 0) return [];
  const max = Math.max(...rawScores);
  const exps = rawScores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const soft = exps.map((e) => e / sum);

  const topRaw = max;
  const topSoft = Math.max(...soft);
  const topPercent = clamp(62 + topRaw * 32 + topSoft * 6, 62, 98);

  return soft.map((p, i) => {
    if (rawScores[i] === max && p === topSoft)
      return Math.round(topPercent * 10) / 10;
    const rel = p / topSoft;
    return (
      Math.round(clamp(topPercent * rel * 0.96, 18, topPercent - 1) * 10) / 10
    );
  });
}

/** Per-trait similarity for explainability. */
export function traitSimilarity(user: number, celeb: number): number {
  return clamp(1 - Math.abs(user - celeb));
}

/** Convert RGB 0–255 to approximate Lab-normalized 0–1 channels. */
export function rgbToApproxLab(
  r: number,
  g: number,
  b: number,
): { L: number; a: number; b: number } {
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = toLin(r);
  const G = toLin(g);
  const B = toLin(b);
  let x = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  let z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  x /= 0.95047;
  y /= 1.0;
  z /= 1.08883;
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bLab = 200 * (fy - fz);
  return {
    L: clamp(L / 100),
    a: clamp((a + 128) / 255),
    b: clamp((bLab + 128) / 255),
  };
}

/** Create a zeroed feature vector (for tests / defaults). */
export function emptyFeatures(): FaceFeatures {
  return {
    faceAspect: 0.5,
    jawWidth: 0.5,
    chinSharpness: 0.5,
    foreheadHeight: 0.5,
    eyeSpacing: 0.5,
    eyeOpenness: 0.5,
    eyeSlant: 0.5,
    browHeight: 0.5,
    noseLength: 0.5,
    noseWidth: 0.5,
    mouthWidth: 0.5,
    lipFullness: 0.5,
    cheekboneProminence: 0.5,
    faceRoundness: 0.5,
    skinL: 0.5,
    skinA: 0.5,
    skinB: 0.5,
    hairL: 0.5,
    hairA: 0.5,
    hairB: 0.5,
    masculine: 0.5,
    feminine: 0.5,
    youthfulness: 0.5,
  };
}

/** Merge partial features over defaults. */
export function mergeFeatures(
  partial: Partial<FaceFeatures>,
  base: FaceFeatures = emptyFeatures(),
): FaceFeatures {
  return { ...base, ...partial };
}
