/**
 * EdgeFace-512 gallery collision bands. Used by the v4 audit script and tests.
 * Ranking still uses cosine distance; this only classifies cross-id neighbors.
 */
import { cosineDistance256 } from "./embeddings.ts";
import { GALLERY_CLONE_EPS, isPaddedFaceNetDescriptor } from "./gallery-dedupe.ts";
import { OPEN_SET_IDENTITY_DISTANCE } from "./open-set-score.ts";

/** Exact / near-exact clone (same epsilon as gallery-dedupe). */
export const AUDIT_CLONE_MAX = GALLERY_CLONE_EPS;

/** Identity-range / donor-clone band — matches open-set identity exemption. */
export const AUDIT_IDENTITY_MAX = OPEN_SET_IDENTITY_DISTANCE;

/** Hill 70%+ needs d ≤ 0.49; pairs here are crowded, not necessarily bugs. */
export const AUDIT_LOOKALIKE_MAX = 0.49;

export type CrossIdPairBand = "clone" | "identity-range" | "lookalike-range" | "far";

export interface GalleryAuditRow {
  id: string;
  name?: string;
  descriptor: ArrayLike<number>;
}

export interface CrossIdPair {
  a: string;
  b: string;
  aName?: string;
  bName?: string;
  distance: number;
  band: CrossIdPairBand;
}

export interface SuspectVector {
  id: string;
  name?: string;
  reason: string;
}

export function classifyCrossIdPair(distance: number): CrossIdPairBand {
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) {
    return "far";
  }
  if (distance < AUDIT_CLONE_MAX) return "clone";
  if (distance <= AUDIT_IDENTITY_MAX) return "identity-range";
  if (distance <= AUDIT_LOOKALIKE_MAX) return "lookalike-range";
  return "far";
}

export function pairBandLabel(band: CrossIdPairBand): string {
  switch (band) {
    case "clone":
      return "exact/near-exact cross-id clone";
    case "identity-range":
      return "identity-range neighbor (review for donor clone)";
    case "lookalike-range":
      return "look-alike-range neighbor (crowded gallery)";
    case "far":
      return "far";
    default: {
      const _exhaustive: never = band;
      return _exhaustive;
    }
  }
}

/** Best (min) cosine distance between any templates of two different ids. */
export function minCrossIdDistance(
  aRows: readonly GalleryAuditRow[],
  bRows: readonly GalleryAuditRow[],
): number {
  let best = Infinity;
  for (const ar of aRows) {
    for (const br of bRows) {
      const d = cosineDistance256(ar.descriptor, br.descriptor);
      if (d < best) best = d;
    }
  }
  return best;
}

export function collectCrossIdPairs(rows: readonly GalleryAuditRow[]): CrossIdPair[] {
  const byId = new Map<string, GalleryAuditRow[]>();
  for (const row of rows) {
    const list = byId.get(row.id) ?? [];
    list.push(row);
    byId.set(row.id, list);
  }
  const ids = [...byId.keys()].sort((a, b) => a.localeCompare(b));
  const pairs: CrossIdPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    const aId = ids[i]!;
    const aRows = byId.get(aId)!;
    for (let j = i + 1; j < ids.length; j++) {
      const bId = ids[j]!;
      const bRows = byId.get(bId)!;
      const distance = minCrossIdDistance(aRows, bRows);
      const band = classifyCrossIdPair(distance);
      if (band === "far") continue;
      pairs.push({
        a: aId,
        b: bId,
        aName: aRows[0]?.name,
        bName: bRows[0]?.name,
        distance,
        band,
      });
    }
  }
  pairs.sort((x, y) => x.distance - y.distance || x.a.localeCompare(y.a));
  return pairs;
}

export function findSuspectVectors(rows: readonly GalleryAuditRow[]): SuspectVector[] {
  const out: SuspectVector[] = [];
  for (const row of rows) {
    const d = row.descriptor;
    if (isPaddedFaceNetDescriptor(d)) {
      out.push({ id: row.id, name: row.name, reason: "padded-facenet" });
    }
    let maxAbs = 0;
    let mean = 0;
    const n = d.length;
    if (n === 0) {
      out.push({ id: row.id, name: row.name, reason: "empty-descriptor" });
      continue;
    }
    for (let i = 0; i < n; i++) {
      const v = d[i] ?? 0;
      maxAbs = Math.max(maxAbs, Math.abs(v));
      mean += v;
    }
    mean /= n;
    if (maxAbs < 0.05) {
      out.push({ id: row.id, name: row.name, reason: `tiny-maxAbs=${maxAbs.toFixed(4)}` });
    }
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const x = (d[i] ?? 0) - mean;
      varSum += x * x;
    }
    const std = Math.sqrt(varSum / n);
    if (std < 0.02) {
      out.push({ id: row.id, name: row.name, reason: `low-std=${std.toFixed(4)}` });
    }
  }
  return out;
}

/** Ids to review — clones and identity-range collisions only, not look-alike crowding. */
export function demotionIds(pairs: readonly CrossIdPair[], suspects: readonly SuspectVector[]): string[] {
  const ids = new Set<string>();
  for (const p of pairs) {
    if (p.band === "clone" || p.band === "identity-range") {
      ids.add(p.a);
      ids.add(p.b);
    }
  }
  for (const s of suspects) ids.add(s.id);
  return [...ids].sort((a, b) => a.localeCompare(b));
}
