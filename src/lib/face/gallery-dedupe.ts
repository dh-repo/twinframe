import type { CelebrityEmbedding } from "./embeddings.ts";
import { ensembleDistance } from "./embeddings.ts";

/** Near-zero ensemble distance treats gallery vectors as clones. */
export const GALLERY_CLONE_EPS = 1e-4;

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
