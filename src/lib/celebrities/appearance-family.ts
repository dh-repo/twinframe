import {
  cosineDistance256,
  l2Normalize,
  type CelebrityEmbedding,
} from "../face/embeddings.ts";

/**
 * Coarse glance families for entertainment look-alikes.
 * These are not identity, ancestry, or census labels — they keep a white
 * woman from being shown an East Asian celebrity as her "twin" just because
 * EdgeFace nearest-neighbor liked the bone structure.
 */
export type AppearanceFamily =
  | "east_asian"
  | "south_asian"
  | "black"
  | "white"
  | "latine"
  | "mena"
  | "pacific"
  | "unknown";

export const APPEARANCE_FAMILIES_URL = "/celebs/appearance-families.json";

/** Need this many labeled gallery vectors before a family centroid is used. */
export const APPEARANCE_CENTROID_MIN_N = 8;

/**
 * Cosine-distance gap between the nearest family centroid and the runner-up.
 * Below this, we do not guess — ranking stays unfiltered.
 */
export const APPEARANCE_CLASSIFY_MIN_MARGIN = 0.012;
/**
 * Glance families hide a *weak* cross-family nearest neighbor.
 * A unique tight match (large gap to #2) is identity, not a glance guess —
 * filtering it made Zendaya's own photo return nobody.
 */
export const APPEARANCE_FAMILY_IDENTITY_MARGIN = 0.07;

const LABELED_FAMILIES = [
  "east_asian",
  "south_asian",
  "black",
  "white",
  "latine",
  "mena",
  "pacific",
] as const;

type LabeledFamily = (typeof LABELED_FAMILIES)[number];

let familyById: Record<string, AppearanceFamily> = {};

const FAMILY_SET: ReadonlySet<string> = new Set([
  "east_asian",
  "south_asian",
  "black",
  "white",
  "latine",
  "mena",
  "pacific",
  "unknown",
]);

function isAppearanceFamily(value: string): value is AppearanceFamily {
  return FAMILY_SET.has(value);
}

export function applyAppearanceFamilyManifest(data: unknown): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    familyById = {};
    return;
  }
  const next: Record<string, AppearanceFamily> = {};
  for (const [id, raw] of Object.entries(data as Record<string, unknown>)) {
    if (typeof id !== "string" || !id) continue;
    if (typeof raw === "string" && isAppearanceFamily(raw)) next[id] = raw;
  }
  familyById = next;
}

export function appearanceFamilyFor(id: string | undefined): AppearanceFamily {
  if (!id) return "unknown";
  return familyById[id] ?? "unknown";
}

export function appearanceFamilyCount(): number {
  return Object.keys(familyById).length;
}

export function resetAppearanceFamiliesForTests(): void {
  familyById = {};
}

/**
 * Adjacent European / Mediterranean / Latin presentations may share a
 * glance; East Asian / South Asian / Black / Pacific do not stand in for
 * a white probe.
 */
export function familiesCompatible(
  probe: AppearanceFamily,
  celeb: AppearanceFamily,
): boolean {
  if (probe === "unknown" || celeb === "unknown") return true;
  if (probe === celeb) return true;
  const euroAdjacent = (family: AppearanceFamily): boolean =>
    family === "white" || family === "latine" || family === "mena";
  return euroAdjacent(probe) && euroAdjacent(celeb);
}

export interface ProbeAppearanceGuess {
  family: AppearanceFamily;
  margin: number;
  nearestDistance: number;
  counts: Partial<Record<LabeledFamily, number>>;
}

function meanNormalized(
  rows: readonly CelebrityEmbedding[],
): Float32Array | null {
  if (rows.length === 0) return null;
  const dim = rows[0]?.descriptor.length ?? 0;
  if (dim < 8) return null;
  const acc = new Float64Array(dim);
  let n = 0;
  for (const row of rows) {
    const desc = row.descriptor;
    if (!desc || desc.length !== dim) continue;
    const unit = l2Normalize(desc);
    for (let i = 0; i < dim; i++) acc[i] = (acc[i] ?? 0) + (unit[i] ?? 0);
    n += 1;
  }
  if (n < APPEARANCE_CENTROID_MIN_N) return null;
  const mean = new Float32Array(dim);
  for (let i = 0; i < dim; i++) mean[i] = (acc[i] ?? 0) / n;
  return l2Normalize(mean);
}

/**
 * Guess the probe's glance family as the nearest labeled gallery centroid.
 * Unlabeled celebs do not vote. Weak margins stay `unknown` so we fail open.
 */
export function classifyProbeAppearance(
  probe: ArrayLike<number>,
  gallery: readonly CelebrityEmbedding[],
): ProbeAppearanceGuess {
  const empty: ProbeAppearanceGuess = {
    family: "unknown",
    margin: 0,
    nearestDistance: Number.POSITIVE_INFINITY,
    counts: {},
  };
  if (!probe || probe.length === 0 || gallery.length === 0) return empty;

  const byFamily = new Map<LabeledFamily, CelebrityEmbedding[]>();
  for (const row of gallery) {
    const family = appearanceFamilyFor(row.id);
    if (family === "unknown") continue;
    const list = byFamily.get(family) ?? [];
    list.push(row);
    byFamily.set(family, list);
  }

  const probeUnit = l2Normalize(probe);
  const scored: Array<{ family: LabeledFamily; distance: number; n: number }> = [];
  const counts: Partial<Record<LabeledFamily, number>> = {};

  for (const family of LABELED_FAMILIES) {
    const rows = byFamily.get(family) ?? [];
    counts[family] = rows.length;
    const centroid = meanNormalized(rows);
    if (!centroid) continue;
    scored.push({
      family,
      distance: cosineDistance256(probeUnit, centroid),
      n: rows.length,
    });
  }

  if (scored.length < 2) return { ...empty, counts };
  scored.sort((a, b) => a.distance - b.distance);
  const best = scored[0]!;
  const second = scored[1]!;
  const margin = second.distance - best.distance;
  if (margin < APPEARANCE_CLASSIFY_MIN_MARGIN) {
    return {
      family: "unknown",
      margin,
      nearestDistance: best.distance,
      counts,
    };
  }
  return {
    family: best.family,
    margin,
    nearestDistance: best.distance,
    counts,
  };
}

function rowDistance(row: { dist?: number; adjusted?: number }): number {
  const d = typeof row.dist === "number" && Number.isFinite(row.dist) ? row.dist : Infinity;
  const adj =
    typeof row.adjusted === "number" && Number.isFinite(row.adjusted) ? row.adjusted : Infinity;
  return Math.min(d, adj);
}

function uniqueStrongNearest<T extends { dist?: number; adjusted?: number }>(ranked: readonly T[]): boolean {
  if (ranked.length === 0) return false;
  const d0 = rowDistance(ranked[0]!);
  const d1 = ranked.length > 1 ? rowDistance(ranked[1]!) : Number.POSITIVE_INFINITY;
  return Number.isFinite(d0) && d1 - d0 >= APPEARANCE_FAMILY_IDENTITY_MARGIN;
}

export function filterRanksByAppearanceFamily<
  T extends { celeb: { id?: string }; dist?: number; adjusted?: number },
>(ranked: readonly T[], probeFamily: AppearanceFamily): T[] {
  if (ranked.length === 0) return [];
  if (probeFamily === "unknown") return ranked.slice();
  const keepHead = uniqueStrongNearest(ranked);
  const kept = ranked.filter(
    (row, index) =>
      (index === 0 && keepHead) || familiesCompatible(probeFamily, appearanceFamilyFor(row.celeb.id)),
  );
  return kept.length > 0 ? kept : ranked.slice();
}
