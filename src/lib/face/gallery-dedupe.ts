import type { CelebrityEmbedding } from "./embeddings.ts";
import { ensembleDistance } from "./embeddings.ts";

/** Near-zero ensemble distance treats gallery vectors as clones. */
export const GALLERY_CLONE_EPS = 1e-4;

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

/** Full production hygiene: same-id clone collapse + cross-id collision drop. */
export function sanitizeGalleryEmbeddings(
  gallery: CelebrityEmbedding[],
): { gallery: CelebrityEmbedding[]; droppedCrossId: string[] } {
  const collapsed = collapseSameIdDescriptorClones(gallery);
  const { gallery: cleaned, droppedIds } = dropCrossIdExactCollisions(collapsed);
  return { gallery: cleaned, droppedCrossId: droppedIds };
}

/**
 * Count same-id clone pairs and unique descriptor fingerprints (for telemetry).
 */
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
