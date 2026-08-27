import type { CelebrityEmbedding } from "./embeddings.ts";
import {
  cosineDistance256,
  ensembleDistance,
  l2Normalize,
} from "./embeddings.ts";

/** Near-zero ensemble distance treats gallery vectors as clones. */
export const GALLERY_CLONE_EPS = 1e-4;
/**
 * Thumb-only enrollments that share one poisoned face sit at AdaFace d≈0.02–0.10
 * across dozens of different names. Exact-clone eps (1e-4) misses them, and
 * ranking then returns a random extra as a "look-alike". A connected component
 * of this many distinct ids at this distance is not a celebrity neighborhood.
 * 0.10 (not 0.08) also absorbs the halo of the same face that sat just outside
 * the tighter cutoff; verified jpg primaries stay at d≈0.7 from the pile.
 */
export const POISONED_CLUSTER_MAX_DISTANCE = 0.1;
export const POISONED_CLUSTER_MIN_IDS = 8;

function fingerprint(d: ArrayLike<number>): string {
  let a = 0;
  let b = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i] ?? 0;
    a = (a + v * (i + 1)) % 1e9;
    b = (b + v * (i + 1) * (i + 3)) % 1e9;
  }
  return `${a.toFixed(6)}:${b.toFixed(6)}`;
}

/**
 * Collapse exact same-id descriptor clones to a single bucket per unique vector.
 * Keeps the first occurrence of each (id, fingerprint) pair — typically the
 * youngest age-bucket ordering as stored. Distinct multi-view embeddings for
 * the same id are preserved.
 */
export function collapseSameIdDescriptorClones(
  gallery: CelebrityEmbedding[],
  eps = GALLERY_CLONE_EPS,
): CelebrityEmbedding[] {
  const out: CelebrityEmbedding[] = [];
  const byId = new Map<string, CelebrityEmbedding[]>();

  for (const entry of gallery) {
    const list = byId.get(entry.id) ?? [];
    list.push(entry);
    byId.set(entry.id, list);
  }

  for (const list of byId.values()) {
    const kept: CelebrityEmbedding[] = [];
    for (const candidate of list) {
      const isClone = kept.some(
        (k) => ensembleDistance(k.descriptor, candidate.descriptor) < eps,
      );
      if (!isClone) kept.push(candidate);
    }
    out.push(...kept);
  }

  return out;
}

/**
 * Drop embeddings that are exact (or near-exact) collisions across different
 * celebrity ids. Those vectors are poisoned for look-alike ranking — whoever
 * "owns" the shared vector wins unfairly.
 *
 * Returns cleaned gallery + dropped ids.
 */
export function dropCrossIdExactCollisions(
  gallery: CelebrityEmbedding[],
  eps = GALLERY_CLONE_EPS,
): { gallery: CelebrityEmbedding[]; droppedIds: string[] } {
  // Group by fingerprint (exact bitwise path after L2 is enough for clones)
  const byFp = new Map<string, CelebrityEmbedding[]>();
  for (const e of gallery) {
    const fp = fingerprint(e.descriptor);
    const list = byFp.get(fp) ?? [];
    list.push(e);
    byFp.set(fp, list);
  }

  const drop = new Set<string>();
  for (const group of byFp.values()) {
    const ids = new Set(group.map((g) => g.id));
    if (ids.size <= 1) continue;
    // Also verify near-zero ensemble in case fingerprint is coarse
    let confirmed = false;
    outer: for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i]!.id === group[j]!.id) continue;
        if (ensembleDistance(group[i]!.descriptor, group[j]!.descriptor) < eps) {
          confirmed = true;
          break outer;
        }
      }
    }
    if (!confirmed && ids.size > 1) {
      // Fingerprint collision without metric collision — keep
      continue;
    }
    for (const id of ids) drop.add(id);
  }

  if (drop.size === 0) return { gallery, droppedIds: [] };
  return {
    gallery: gallery.filter((e) => !drop.has(e.id)),
    droppedIds: [...drop],
  };
}

function findRoot(parent: number[], i: number): number {
  return parent[i] === i ? i : (parent[i] = findRoot(parent, parent[i]!));
}

/**
 * Drop every identity in a large near-clone component. Two similar celebrities
 * at d≈0.10 stay (component size 2 < minIds); a 80-id+ thumb cluster of the
 * same poisoned face does not.
 */
export function dropPoisonedNearCloneClusters<T extends { id: string; descriptor: ArrayLike<number> }>(
  gallery: T[],
  maxDistance = POISONED_CLUSTER_MAX_DISTANCE,
  minIds = POISONED_CLUSTER_MIN_IDS,
): { gallery: T[]; droppedIds: string[] } {
  const primary = new Map<string, ArrayLike<number>>();
  const order: string[] = [];
  for (const row of gallery) {
    if (primary.has(row.id)) continue;
    primary.set(row.id, row.descriptor);
    order.push(row.id);
  }
  const n = order.length;
  if (n < minIds) return { gallery, droppedIds: [] };
  const parent = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    const vi = primary.get(order[i]!)!;
    for (let j = i + 1; j < n; j++) {
      if (cosineDistance256(vi, primary.get(order[j]!)!) < maxDistance) {
        const a = findRoot(parent, i);
        const b = findRoot(parent, j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const r = findRoot(parent, i);
    const g = groups.get(r) ?? [];
    g.push(order[i]!);
    groups.set(r, g);
  }
  const drop = new Set<string>();
  for (const g of groups.values()) {
    if (g.length >= minIds) for (const id of g) drop.add(id);
  }
  if (drop.size === 0) return { gallery, droppedIds: [] };
  return {
    gallery: gallery.filter((e) => !drop.has(e.id)),
    droppedIds: [...drop],
  };
}

/** Full production hygiene: same-id clone collapse + cross-id collision drop. */
export function sanitizeGalleryEmbeddings(
  gallery: CelebrityEmbedding[],
): { gallery: CelebrityEmbedding[]; droppedCrossId: string[] } {
  const collapsed = collapseSameIdDescriptorClones(gallery);
  const exact = dropCrossIdExactCollisions(collapsed);
  const poisoned = dropPoisonedNearCloneClusters(exact.gallery);
  return {
    gallery: poisoned.gallery,
    droppedCrossId: [...new Set([...exact.droppedIds, ...poisoned.droppedIds])],
  };
}

/**
 * Computes the normalized centroid embedding for multi-shot celebrity vectors:
 * c = sum(v_k) / ||sum(v_k)||_2
 */
export function computeCentroidEmbedding(vectors: ArrayLike<number>[]): Float32Array {
  if (!vectors || vectors.length === 0) return new Float32Array(256);
  const dim = vectors[0]!.length;
  const sum = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += v[i] ?? 0;
    }
  }
  return l2Normalize(sum);
}

/**
 * FaceNet→256 pad heuristic: trailing half near-zero **and** a dense lower
 * half (real 128-d FaceNet). Sparse one-hot EdgeFace probes must not match.
 */
export function isPaddedFaceNetDescriptor(
  descriptor: ArrayLike<number>,
  eps = 1e-6,
): boolean {
  if (descriptor.length < 256) return descriptor.length > 0 && descriptor.length <= 128;
  let energyHigh = 0;
  let nonzeroLow = 0;
  for (let i = 0; i < 128; i++) {
    const lo = descriptor[i] ?? 0;
    const hi = descriptor[i + 128] ?? 0;
    energyHigh += hi * hi;
    if (Math.abs(lo) > eps) nonzeroLow++;
  }
  return energyHigh <= eps && nonzeroLow >= 32;
}

/**
 * Multi-shot prototype set per id: keep every distinct real template (matching
 * is best-of-N per id) and append the normalized centroid as one extra
 * prototype. Never drop the primary — off-angle extras must not replace the
 * clean frontal enrollment.
 */
export function buildMultiShotCentroidGallery(
  gallery: CelebrityEmbedding[],
): CelebrityEmbedding[] {
  const byId = new Map<string, CelebrityEmbedding[]>();
  for (const entry of gallery) {
    if (isPaddedFaceNetDescriptor(entry.descriptor)) continue;
    const list = byId.get(entry.id) ?? [];
    list.push(entry);
    byId.set(entry.id, list);
  }

  // Preserve ids whose only rows were padded FaceNet (fall back to original row)
  for (const entry of gallery) {
    if (byId.has(entry.id)) continue;
    byId.set(entry.id, [entry]);
  }

  const result: CelebrityEmbedding[] = [];
  for (const [, entries] of byId.entries()) {
    const distinct = collapseSameIdDescriptorClones(entries);
    result.push(...distinct);
    if (distinct.length < 2) continue;

    const centroidDesc = Array.from(
      computeCentroidEmbedding(distinct.map((e) => e.descriptor)),
    );
    const isClone = distinct.some(
      (e) => cosineDistance256(centroidDesc, e.descriptor) < GALLERY_CLONE_EPS,
    );
    if (!isClone) {
      result.push({
        ...distinct[0]!,
        descriptor: centroidDesc,
      });
    }
  }
  return dropPoisonedNearCloneClusters(result).gallery;
}
export function galleryCloneStats(gallery: CelebrityEmbedding[], eps = GALLERY_CLONE_EPS) {
  const byId = new Map<string, CelebrityEmbedding[]>();
  for (const e of gallery) {
    const list = byId.get(e.id) ?? [];
    list.push(e);
    byId.set(e.id, list);
  }

  let sameIdPairs = 0;
  let sameIdClones = 0;
  for (const list of byId.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        sameIdPairs++;
        if (ensembleDistance(list[i]!.descriptor, list[j]!.descriptor) < eps) {
          sameIdClones++;
        }
      }
    }
  }

  return {
    uniqueIds: byId.size,
    totalBuckets: gallery.length,
    sameIdCloneRate: sameIdPairs > 0 ? sameIdClones / sameIdPairs : 0,
    collapsedSize: collapseSameIdDescriptorClones(gallery, eps).length,
  };
}
