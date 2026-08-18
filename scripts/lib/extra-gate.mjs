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
/** SCRFD confidence floor — low-score detections are usually a background face. */
export const EXTRA_MIN_DET_SCORE = 0.5;
/** Views this close to one already kept add no information to the centroid. */
export const EXTRA_NEAR_DUPLICATE_EPS = 0.02;

export const EXTRA_REJECT_REASONS = /** @type {const} */ ([
  "no-detection",
  "low-detection-score",
  "bad-descriptor",
  "no-primary",
  "too-far-from-primary",
  "near-duplicate",
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
 *   maxDistance?: number,
 *   minDetScore?: number,
 *   nearDuplicateEps?: number,
 *   maxPerId?: number,
 * }} options
 */
export function gateExtraCandidates(candidates, options) {
  const {
    primaries,
    existingById = new Map(),
    maxDistance = EXTRA_MAX_DISTANCE,
    minDetScore = EXTRA_MIN_DET_SCORE,
    nearDuplicateEps = EXTRA_NEAR_DUPLICATE_EPS,
    maxPerId = Infinity,
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
    if (distance > maxDistance) {
      reject(c, "too-far-from-primary", distance);
      continue;
    }
    const kept = keptById.get(c.id) ?? [];
    const dupe = kept.find((k) => cosineDistance(vec, k) < nearDuplicateEps);
    if (dupe) {
      reject(c, "near-duplicate", distance);
      continue;
    }
    if (kept.length >= maxPerId) {
      reject(c, "cap-reached", distance);
      continue;
    }
    kept.push(vec);
    keptById.set(c.id, kept);
    accepted.push({ ...c, distanceToPrimary: Number(distance.toFixed(4)) });
  }

  const byReason = {};
  for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;

  return {
    accepted,
    rejected,
    stats: {
      candidates: candidates.length,
      accepted: accepted.length,
      rejected: rejected.length,
      byReason,
      idsWithNewViews: new Set(accepted.map((a) => a.id)).size,
      maxDistance,
      minDetScore,
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
