/**
 * Quality gate + merge helpers for multi-shot extra templates.
 *
 * An extra view only helps if it is the same person and a usable crop: a
 * mislabeled photo or a group shot cropped onto the wrong face both poison the
 * celebrity's centroid prototype. Mirrors the distance gate that
 * scripts/build-extra-references.ts applies to held-out references, retuned for
 * EdgeFace-512 cosine distance.
 *
 * Measured on the shipping gallery (552 extras vs their enrolled primary):
 * genuine p50 0.45 / p90 0.72, random impostor pairs p01 0.72 / p50 0.98.
 */
import { cosineDistance, l2Normalize } from "./gallery-binary.mjs";

/** Above this cosine distance from the enrolled primary the view is treated as a different person. */
export const EXTRA_MAX_DISTANCE = 0.7;
/**
 * Rescue path for celebrities enrolled from a 96px webp thumbnail: their primary
 * sits in impostor range from every real photo of them, so agreement between
 * independent candidates is the more trustworthy same-person signal.
 */
export const EXTRA_CLUSTER_EPS = 0.62;
export const EXTRA_MIN_CLUSTER = 3;
/** SCRFD confidence floor — low-score detections are usually a background face. */
export const EXTRA_MIN_DET_SCORE = 0.5;
/** Views this close to one already kept add no information to the centroid. */
export const EXTRA_NEAR_DUPLICATE_EPS = 0.02;
/**
 * A crop this close to the enrolled primary double-weights that look in the
 * multi-shot centroid and can pull the prototype away from a different-era
 * held-out probe. Distinct extra views sit well above this.
 */
export const EXTRA_PRIMARY_NEAR_DUPLICATE_EPS = 0.05;
/**
 * A crop this close to held-out `001` is an eval leak even when the bytes
 * differ (alternate crop of the same sitting). Enrollment must not see it.
 */
export const EXTRA_EVAL_NEAR_CLONE_EPS = 0.05;

export const EXTRA_REJECT_REASONS = /** @type {const} */ ([
  "no-detection",
  "low-detection-score",
  "bad-descriptor",
  "no-primary",
  "too-far-from-primary",
  "near-duplicate",
  "eval-near-clone",
  "cap-reached",
]);

function normalized(descriptor) {
  return l2Normalize(Float32Array.from(descriptor));
}

/**
 * Decide which candidate extra views may join the gallery.
 *
 * @param {Array<{ id: string, source: string, descriptor: number[] | Float32Array,
 *   score?: number, usedDetection?: boolean }>} candidates
 * @param {{
 *   primaries: Map<string, ArrayLike<number>>,
 *   existingById?: Map<string, ArrayLike<number>[]>,
 *   probesById?: Map<string, ArrayLike<number>>,
 *   maxDistance?: number,
 *   minDetScore?: number,
 *   nearDuplicateEps?: number,
 *   primaryNearDuplicateEps?: number,
 *   evalNearCloneEps?: number,
 *   maxPerId?: number,
 *   clusterEps?: number,
 *   minCluster?: number,
 * }} options
 */
export function gateExtraCandidates(candidates, options) {
  const {
    primaries,
    existingById = new Map(),
    probesById = new Map(),
    maxDistance = EXTRA_MAX_DISTANCE,
    minDetScore = EXTRA_MIN_DET_SCORE,
    nearDuplicateEps = EXTRA_NEAR_DUPLICATE_EPS,
    primaryNearDuplicateEps = EXTRA_PRIMARY_NEAR_DUPLICATE_EPS,
    evalNearCloneEps = EXTRA_EVAL_NEAR_CLONE_EPS,
    maxPerId = Infinity,
    clusterEps = EXTRA_CLUSTER_EPS,
    minCluster = EXTRA_MIN_CLUSTER,
  } = options;

  const accepted = [];
  const rejected = [];
  const keptById = new Map();
  for (const [id, vectors] of existingById) {
    keptById.set(
      id,
      vectors.map((v) => normalized(v)),
    );
  }

  const reject = (c, reason, distance) => {
    rejected.push({
      id: c.id,
      source: c.source,
      reason,
      distance: distance === undefined ? null : Number(distance.toFixed(4)),
    });
  };

  // Pass 1: cheap signal gates, then split on agreement with the enrolled primary.
  const scored = [];
  for (const c of candidates) {
    if (c.usedDetection === false) {
      reject(c, "no-detection");
      continue;
    }
    if (typeof c.score === "number" && c.score < minDetScore) {
      reject(c, "low-detection-score");
      continue;
    }
    if (!c.descriptor || c.descriptor.length === 0) {
      reject(c, "bad-descriptor");
      continue;
    }
    const primary = primaries.get(c.id);
    if (!primary) {
      reject(c, "no-primary");
      continue;
    }
    const vec = normalized(c.descriptor);
    const distance = cosineDistance(vec, normalized(primary));
    if (!Number.isFinite(distance)) {
      reject(c, "bad-descriptor");
      continue;
    }
    scored.push({ candidate: c, vec, distance, nearPrimary: distance <= maxDistance });
  }

  // Pass 2: a candidate the primary disagrees with is still credible when enough
  // independent candidates for that id agree with each other.
  const clusterOk = new Set();
  if (minCluster > 0 && clusterEps > 0) {
    const byIdScored = new Map();
    for (const s of scored) {
      const list = byIdScored.get(s.candidate.id) ?? [];
      list.push(s);
      byIdScored.set(s.candidate.id, list);
    }
    for (const [id, list] of byIdScored) {
      if (list.length < minCluster) continue;
      // Only rescue when the primary agrees with nothing: if it validates some
      // views (or already validated the shipped ones), trust it over the crowd.
      if (list.some((s) => s.nearPrimary) || (existingById.get(id)?.length ?? 0) > 0) continue;
      for (const s of list) {
        if (s.nearPrimary) continue;
        const neighbours = list.filter(
          (o) => o !== s && cosineDistance(s.vec, o.vec) <= clusterEps,
        ).length;
        if (neighbours >= minCluster - 1) clusterOk.add(s);
      }
    }
  }

  for (const s of scored) {
    const { candidate: c, vec, distance } = s;
    const viaCluster = !s.nearPrimary && clusterOk.has(s);
    if (!s.nearPrimary && !viaCluster) {
      reject(c, "too-far-from-primary", distance);
      continue;
    }
    if (distance < primaryNearDuplicateEps) {
      reject(c, "near-duplicate", distance);
      continue;
    }
    const probe = probesById.get(c.id);
    if (probe) {
      const dProbe = cosineDistance(vec, normalized(probe));
      if (dProbe < evalNearCloneEps) {
        reject(c, "eval-near-clone", dProbe);
        continue;
      }
    }
    const kept = keptById.get(c.id) ?? [];
    if (kept.some((k) => cosineDistance(vec, k) < nearDuplicateEps)) {
      reject(c, "near-duplicate", distance);
      continue;
    }
    if (kept.length >= maxPerId) {
      reject(c, "cap-reached", distance);
      continue;
    }
    kept.push(vec);
    keptById.set(c.id, kept);
    accepted.push({
      ...c,
      distanceToPrimary: Number(distance.toFixed(4)),
      via: viaCluster ? "cluster" : "primary",
    });
  }

  const byReason = {};
  for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;

  return {
    accepted,
    rejected,
    stats: {
      candidates: candidates.length,
      accepted: accepted.length,
      acceptedViaCluster: accepted.filter((a) => a.via === "cluster").length,
      rejected: rejected.length,
      byReason,
      idsWithNewViews: new Set(accepted.map((a) => a.id)).size,
      maxDistance,
      minDetScore,
      clusterEps,
      minCluster,
    },
  };
}

/**
 * Merge freshly enrolled templates into an existing extra-templates.json body.
 * Existing rows win on (id, source) so a re-run is idempotent and never drops
 * previously shipped views.
 *
 * @param {{ templates?: Array<{ id: string, source: string, descriptor: number[] }> }} existing
 * @param {Array<{ id: string, source: string, descriptor: number[] }>} incoming
 */
export function mergeExtraTemplates(existing, incoming) {
  const templates = [...(existing?.templates ?? [])];
  const seen = new Set(templates.map((t) => `${t.id}\u0000${t.source}`));
  let added = 0;
  let replaced = 0;
  for (const t of incoming) {
    const key = `${t.id}\u0000${t.source}`;
    if (seen.has(key)) {
      const idx = templates.findIndex((e) => `${e.id}\u0000${e.source}` === key);
      templates[idx] = t;
      replaced++;
      continue;
    }
    seen.add(key);
    templates.push(t);
    added++;
  }
  const idCounts = new Map();
  for (const t of templates) idCounts.set(t.id, (idCounts.get(t.id) ?? 0) + 1);
  return {
    templates,
    added,
    replaced,
    ids: idCounts.size,
    total: templates.length,
  };
}
