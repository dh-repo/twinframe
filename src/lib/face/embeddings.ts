import { catalogFor } from "../celebrities/catalog.ts";
import { CELEBRITIES, getCelebrityById, generateDemographicFeatures } from "../celebrities/database.ts";
import type { CelebrityProfile } from "../celebrities/types.ts";
import type {
  FaceFeatures,
  CelebrityEmbedding,
  ReferenceVector,
  FaceViewType,
  HeadPoseOrientation,
  MatchScoreResult,
  EthnicCluster,
} from "./types.ts";
export type { CelebrityEmbedding, ReferenceVector, FaceViewType, HeadPoseOrientation, MatchScoreResult, EthnicCluster };
import { sanitizeGalleryEmbeddings } from "./gallery-dedupe.ts";
import { morphologicalDistance, crossDemographicMismatchPenalty, ensureAnatomicalFeatures } from "./geometry.ts";
import { getPoseAdaptiveLandmarkWeight } from "./pose.ts";

const FRONTAL_NEUTRAL_POSE: HeadPoseOrientation = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };

/** Attach derived clinical anatomical ratios when a gallery feature pack omitted them. */
export function hydrateFaceFeatures(feat: FaceFeatures): FaceFeatures {
  if (feat.anatomical) return feat;
  return { ...feat, anatomical: ensureAnatomicalFeatures(feat) };
}

function makeReferenceVector(
  descriptor: Float32Array,
  feat: FaceFeatures,
  photoUrl: string | undefined,
  viewType: FaceViewType,
  pose?: HeadPoseOrientation,
): ReferenceVector {
  return {
    descriptor,
    viewType,
    pose: pose ?? (viewType === "frontal" ? FRONTAL_NEUTRAL_POSE : undefined),
    photoUrl,
    features: feat,
  };
}

export interface EmbeddingsGallery {
  version: string;
  model: string;
  count: number;
  celebrities: CelebrityEmbedding[];
}

interface GalleryMeta {
  version: string;
  model: string;
  dim: number;
  countCelebs: number;
  countBuckets: number;
  scale: number;
  maxAbs: number;
  quantization: string;
  files: { q8: string; f32: string; index: string };
}

interface BucketEntry {
  id: string;
  name: string;
  path: string;
  path192: string;
  fallbackPath: string;
  age: number;
  gender: "male" | "female";
  genderProb: number;
}

let galleryPromise: Promise<CelebrityEmbedding[]> | null = null;
let galleryCache: CelebrityEmbedding[] | null = null;

// IndexedDB cache for binary gallery (avoids re-fetch + decode on every reload)
const IDB_NAME = "twinframe-gallery";
const IDB_STORE = "embeddings";
const IDB_KEY = "gallery-v5-reencode";

/** Cache-bust gallery assets with the live meta version, not a frozen ?v=3.0.0. */
function galleryUrl(path: string, bust: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}v=${encodeURIComponent(bust)}`;
}

function openIDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbGet(version: string): Promise<CelebrityEmbedding[] | null> {
  try {
    const db = await openIDB();
    if (!db) return null;
    return await new Promise((res) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const st = tx.objectStore(IDB_STORE);
      const rq = st.get(IDB_KEY);
      rq.onsuccess = () => {
        const v = rq.result as { version: string; data: CelebrityEmbedding[] } | undefined;
        if (v && v.version === version && Array.isArray(v.data)) {
          const hydrated = v.data.map((c) => {
            const feat = hydrateFaceFeatures(
              c.features
                ?? getCelebrityById(c.id)?.features
                ?? generateDemographicFeatures(c.gender, c.genderProb, c.age, c.id),
            );
            const descs = getCelebrityDescriptors(c);
            const refs = c.referenceVectors && c.referenceVectors.length > 0
              ? c.referenceVectors.map((r, idx) => ({
                  ...r,
                  descriptor: r.descriptor instanceof Float32Array ? r.descriptor : l2Normalize(r.descriptor),
                  viewType: r.viewType ?? (idx === 0 ? "frontal" : "expression"),
                  pose: r.pose ?? (idx === 0 ? FRONTAL_NEUTRAL_POSE : r.pose),
                  features: r.features ? hydrateFaceFeatures(r.features) : feat,
                }))
              : descs.map((d, idx) =>
                  makeReferenceVector(d, feat, c.path, idx === 0 ? "frontal" : "expression"),
                );
            return {
              ...c,
              descriptor: c.descriptor || Array.from(descs[0]!),
              descriptors: descs,
              referenceVectors: refs,
              features: feat,
            };
          });
          res(hydrated);
        } else {
          res(null);
        }
      };
      rq.onerror = () => res(null);
    });
  } catch { return null; }
}

async function idbSet(version: string, data: CelebrityEmbedding[]): Promise<void> {
  try {
    const db = await openIDB();
    if (!db) return;
    await new Promise<void>((res) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ version, data }, IDB_KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch {}
}

/**
 * Retrieve all 128-d descriptor vectors available for a celebrity identity.
 * Order of precedence:
 *   1. celeb.referenceVectors (extracted descriptor Float32Arrays)
 *   2. celeb.descriptors (Float32Array list)
 *   3. celeb.descriptor (primary vector wrapped into [Float32Array])
 *   4. [] (empty array fallback)
 */
export interface ExtraReference {
  id: string;
  descriptor: number[];
  photoUrl?: string;
  distanceToPrimary?: number;
  viewType?: FaceViewType;
  pose?: HeadPoseOrientation;
}

/** Attach extra views that already passed a same-person distance gate. */
export function mergeExtraReferences(
  gallery: CelebrityEmbedding[],
  extras: ExtraReference[],
  cloneEps = 1e-4,
): CelebrityEmbedding[] {
  if (!extras.length) return gallery;
  const byId = new Map(gallery.map((g) => [g.id, g]));
  let added = 0;
  for (const extra of extras) {
    const celeb = byId.get(extra.id);
    if (!celeb || !extra.descriptor || extra.descriptor.length !== 128) continue;
    const vec = l2Normalize(extra.descriptor);
    const primary = celeb.descriptor instanceof Float32Array
      ? celeb.descriptor
      : Float32Array.from(celeb.descriptor);
    celeb.descriptors = celeb.descriptors ?? [primary];
    const isClone = celeb.descriptors.some((d) => ensembleDistance(d, vec) < cloneEps);
    if (isClone) continue;
    if (!celeb.referenceVectors || celeb.referenceVectors.length === 0) {
      const feat = celeb.features ?? hydrateFaceFeatures(
        getCelebrityById(celeb.id)?.features ?? generateDemographicFeatures(celeb.gender, celeb.genderProb, celeb.age, celeb.id),
      );
      celeb.referenceVectors = [makeReferenceVector(primary, feat, celeb.path, "frontal")];
    }
    celeb.descriptors.push(vec);
    celeb.referenceVectors.push({
      descriptor: vec,
      viewType: extra.viewType ?? "expression",
      pose: extra.pose,
      photoUrl: extra.photoUrl,
    });
    delete (celeb as { _f32Descriptors?: Float32Array[] })._f32Descriptors;
    added++;
  }
  void added;
  return gallery;
}

async function applyExtraReferences(
  gallery: CelebrityEmbedding[],
): Promise<CelebrityEmbedding[]> {
  if (typeof fetch !== "function") return gallery;
  try {
    const res = await fetch("/celebs/extra-references.json", { cache: "no-cache" });
    if (!res.ok) return gallery;
    const data = (await res.json()) as { references?: ExtraReference[] };
    return mergeExtraReferences(gallery, data.references ?? []);
  } catch {
    return gallery;
  }
}

export function getCelebrityDescriptors(celeb: CelebrityEmbedding): Float32Array[] {
  if ((celeb as any)._f32Descriptors) return (celeb as any)._f32Descriptors;

  let result: Float32Array[] = [];
  if (celeb.referenceVectors && celeb.referenceVectors.length > 0) {
    result = celeb.referenceVectors.map((r) =>
      r.descriptor instanceof Float32Array ? r.descriptor : Float32Array.from(r.descriptor),
    );
  } else if (celeb.descriptors && celeb.descriptors.length > 0) {
    result = celeb.descriptors.map((d) =>
      d instanceof Float32Array ? d : Float32Array.from(d),
    );
  } else if (celeb.descriptor && celeb.descriptor.length > 0) {
    result = [
      celeb.descriptor instanceof Float32Array
        ? celeb.descriptor
        : Float32Array.from(celeb.descriptor),
    ];
  }

  (celeb as any)._f32Descriptors = result;
  return result;
}

/** Returns true only if both feature objects contain valid anatomical morphological ratios. */
export function hasMorphologicalFeatures(
  featA?: FaceFeatures | null,
  featB?: FaceFeatures | null,
): boolean {
  if (!featA || !featB) return false;
  return Boolean(featA.anatomical && featB.anatomical);
}

/** SIMD-friendly dot product for Float32Arrays. Zero allocation. */
export function fastDot32(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

/** Fast single-pass ensemble distance for vectors. Zero allocation. */
export function fastEnsembleDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 1.0;
  if (a instanceof Float32Array && b instanceof Float32Array && a.length === b.length) {
    const len = a.length;
    let dot0 = 0, dot1 = 0, dot2 = 0, dot3 = 0;
    let na0 = 0, na1 = 0, na2 = 0, na3 = 0;
    let nb0 = 0, nb1 = 0, nb2 = 0, nb3 = 0;
    let i = 0;
    for (; i + 7 < len; i += 8) {
      const a0 = a[i]!, a1 = a[i + 1]!, a2 = a[i + 2]!, a3 = a[i + 3]!;
      const a4 = a[i + 4]!, a5 = a[i + 5]!, a6 = a[i + 6]!, a7 = a[i + 7]!;
      const b0 = b[i]!, b1 = b[i + 1]!, b2 = b[i + 2]!, b3 = b[i + 3]!;
      const b4 = b[i + 4]!, b5 = b[i + 5]!, b6 = b[i + 6]!, b7 = b[i + 7]!;
      dot0 += a0 * b0 + a4 * b4;
      dot1 += a1 * b1 + a5 * b5;
      dot2 += a2 * b2 + a6 * b6;
      dot3 += a3 * b3 + a7 * b7;
      na0 += a0 * a0 + a4 * a4;
      na1 += a1 * a1 + a5 * a5;
      na2 += a2 * a2 + a6 * a6;
      na3 += a3 * a3 + a7 * a7;
      nb0 += b0 * b0 + b4 * b4;
      nb1 += b1 * b1 + b5 * b5;
      nb2 += b2 * b2 + b6 * b6;
      nb3 += b3 * b3 + b7 * b7;
    }
    let dot = (dot0 + dot1) + (dot2 + dot3);
    let na = (na0 + na1) + (na2 + na3);
    let nb = (nb0 + nb1) + (nb2 + nb3);
    for (; i < len; i++) {
      const av = a[i]!;
      const bv = b[i]!;
      dot += av * bv;
      na += av * av;
      nb += bv * bv;
    }
    if (!Number.isFinite(dot) || na <= 0 || nb <= 0) return ensembleDistance(a, b);
    const normProduct = Math.sqrt(na * nb);
    const cos = dot / normProduct;
    const clampedCos = cos > 1.0 ? 1.0 : cos < -1.0 ? -1.0 : cos;
    const eucDist = Math.sqrt(Math.max(0, na + nb - 2.0 * dot));
    const cosDist = 1.0 - clampedCos;
    return 0.90 * eucDist + 0.42 * cosDist;
  }
  return ensembleDistance(a, b);
}

export const ensembleKernel128 = fastEnsembleDistance;

/**
 * Fast topological manifold vector distance scanning query templates against candidate reference vectors.
 * Incorporates head pose manifold alignment and view-type affinity bonuses.
 */
export function fastTopologicalManifoldDistance(
  qDescs: Float32Array[],
  celeb: CelebrityEmbedding,
  queryPose?: HeadPoseOrientation,
  maxDist?: number,
): number {
  const refVecs = celeb.referenceVectors;
  const cDescs = getCelebrityDescriptors(celeb);
  const cLen = cDescs.length;
  if (cLen === 0) return 1.0;

  const qLen = qDescs.length;
  let best = Infinity;
  const pruneThreshold = maxDist !== undefined ? maxDist : Infinity;

  for (let i = 0; i < qLen; i++) {
    const q = qDescs[i]!;

    for (let j = 0; j < cLen; j++) {
      const c = cDescs[j]!;
      const baseDist = fastEnsembleDistance(q, c);

      let posePenalty = 0;
      let viewBonus = 0;

      const ref = refVecs && refVecs[j] ? refVecs[j] : undefined;
      if (queryPose && ref && ref.pose) {
        const dYaw = (queryPose.yawDeg - ref.pose.yawDeg) / 45.0;
        const dPitch = (queryPose.pitchDeg - ref.pose.pitchDeg) / 30.0;
        const dRoll = (queryPose.rollDeg - ref.pose.rollDeg) / 20.0;
        const poseDist = Math.sqrt(dYaw * dYaw + dPitch * dPitch + dRoll * dRoll);
        posePenalty = 0.04 * Math.min(1.0, poseDist);

        if (
          Math.abs(queryPose.yawDeg) > 15 &&
          ref.viewType &&
          ref.viewType !== "frontal" &&
          ref.pose.yawDeg !== undefined &&
          queryPose.yawDeg * ref.pose.yawDeg > 0
        ) {
          viewBonus = -0.035;
        }
      }

      const manifoldDist = baseDist + posePenalty + viewBonus;
      if (manifoldDist < best) {
        best = manifoldDist;
        if (best < 1e-4) return best;
      }
    }
  }

  return best === Infinity ? 1.0 : best;
}

/** Fast multi-vector distance scanning query templates against candidate descriptors. */
export function fastMinMultiVectorDistance(
  qDescs: Float32Array[],
  celeb: CelebrityEmbedding,
  queryPose?: HeadPoseOrientation,
  maxDist?: number,
): number {
  return fastTopologicalManifoldDistance(qDescs, celeb, queryPose, maxDist);
}

/**
 * Retrieve the best matching reference vector or descriptor for a celebrity identity
 * matching against a set of query template descriptors.
 */
export function getBestMatchingReferenceVector(
  qDescs: Float32Array[],
  celeb: CelebrityEmbedding,
  queryPose?: HeadPoseOrientation,
): { descriptor: Float32Array; refVec?: ReferenceVector; distance: number; index: number } {
  const cDescs = getCelebrityDescriptors(celeb);
  const cLen = cDescs.length;
  const refVecs = celeb.referenceVectors;

  if (cLen === 0) {
    const fallbackDesc = celeb.descriptor instanceof Float32Array
      ? celeb.descriptor
      : Float32Array.from(celeb.descriptor || []);
    return { descriptor: fallbackDesc, distance: 1.0, index: -1 };
  }

  const qLen = qDescs.length;
  let bestDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < qLen; i++) {
    const q = qDescs[i]!;

    for (let j = 0; j < cLen; j++) {
      const c = cDescs[j]!;
      const baseDist = fastEnsembleDistance(q, c);

      let posePenalty = 0;
      let viewBonus = 0;

      const ref = refVecs && refVecs[j] ? refVecs[j] : undefined;
      if (queryPose && ref && ref.pose) {
        const dYaw = (queryPose.yawDeg - ref.pose.yawDeg) / 45.0;
        const dPitch = (queryPose.pitchDeg - ref.pose.pitchDeg) / 30.0;
        const dRoll = (queryPose.rollDeg - ref.pose.rollDeg) / 20.0;
        const poseDist = Math.sqrt(dYaw * dYaw + dPitch * dPitch + dRoll * dRoll);
        posePenalty = 0.04 * Math.min(1.0, poseDist);

        if (
          Math.abs(queryPose.yawDeg) > 15 &&
          ref.viewType &&
          ref.viewType !== "frontal" &&
          ref.pose.yawDeg !== undefined &&
          queryPose.yawDeg * ref.pose.yawDeg > 0
        ) {
          viewBonus = -0.035;
        }
      }

      const manifoldDist = baseDist + posePenalty + viewBonus;
      if (manifoldDist < bestDist) {
        bestDist = manifoldDist;
        bestIdx = j;
      }
    }
  }

  const bestDesc = cDescs[bestIdx]!;
  const refVec = refVecs && refVecs[bestIdx] ? refVecs[bestIdx] : undefined;
  return { descriptor: bestDesc, refVec, distance: bestDist === Infinity ? 1.0 : bestDist, index: bestIdx };
}


/** Load precomputed FaceNet-style 128-d celebrity descriptors. */
export async function loadCelebrityEmbeddings(): Promise<CelebrityEmbedding[]> {
  if (galleryCache) return galleryCache;
  if (galleryPromise) return galleryPromise;

  galleryPromise = (async () => {
    // Try efficient binary gallery first (v3): meta + buckets + q8 bin
    try {
      const metaRes = await fetch("/celebs/embeddings.meta.json", { cache: "no-store" });
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as GalleryMeta;
        const bust = `${meta.version}:${meta.countCelebs}:${meta.countBuckets}`;
        const cacheKey = `${bust}-dedupe-v1-m1-multivec-v9-frontal-anat`;
        const cached = await idbGet(cacheKey);
        if (cached) {
          galleryCache = await applyExtraReferences(sanitizeGalleryEmbeddings(cached).gallery);
          return galleryCache;
        }

        const [bucketsRes, binRes, featuresRes] = await Promise.all([
          fetch(galleryUrl("/celebs/gallery.buckets.json", bust), { cache: "no-cache" }),
          fetch(galleryUrl(meta.files.q8, bust), { cache: "no-cache" }),
          fetch(galleryUrl("/celebs/gallery.features.json", bust), { cache: "no-cache" }).catch(() => null),
        ]);

        let featuresMap: Record<string, FaceFeatures> = {};
        if (featuresRes && featuresRes.ok) {
          try {
            featuresMap = await featuresRes.json();
          } catch {}
        }

        if (bucketsRes.ok && binRes.ok) {
          const buckets = (await bucketsRes.json()) as BucketEntry[];
          const bin = new Uint8Array(await binRes.arrayBuffer());
          const scale = meta.scale;
          const dim = meta.dim;
          if (bin.length === buckets.length * dim) {
            const byId = new Map<string, CelebrityEmbedding>();
            for (let i = 0; i < buckets.length; i++) {
              const b = buckets[i]!;
              const off = i * dim;
              const raw = new Float32Array(dim);
              for (let j = 0; j < dim; j++) {
                const q = bin[off + j]! - 127; // unbias
                raw[j] = q * scale;
              }
              const f32Desc = l2Normalize(raw);
              const feat = hydrateFaceFeatures(
                featuresMap[b.id]
                  ?? getCelebrityById(b.id)?.features
                  ?? generateDemographicFeatures(b.gender, b.genderProb, b.age, b.id),
              );

              const existing = byId.get(b.id);
              const refVec = makeReferenceVector(
                f32Desc,
                feat,
                b.path ?? b.fallbackPath,
                existing ? "expression" : "frontal",
              );

              if (!existing) {
                byId.set(b.id, {
                  id: b.id,
                  name: b.name,
                  path: b.path,
                  path192: b.path192,
                  fallbackPath: b.fallbackPath,
                  descriptor: Array.from(f32Desc),
                  descriptors: [f32Desc],
                  referenceVectors: [refVec],
                  age: b.age,
                  gender: b.gender,
                  genderProb: b.genderProb,
                  features: feat,
                });
              } else {
                const isClone = existing.descriptors!.some(
                  (d) => ensembleDistance(d, f32Desc) < 1e-4,
                );
                if (!isClone) {
                  existing.descriptors!.push(f32Desc);
                  existing.referenceVectors!.push(refVec);
                }
              }
            }
            galleryCache = await applyExtraReferences(
              sanitizeGalleryEmbeddings(Array.from(byId.values())).gallery,
            );
            void idbSet(cacheKey, galleryCache);
            return galleryCache;
          }
        }
        // fallback to f32 if q8 failed
        try {
          const [f32Res, bucketsRes2, featuresRes2] = await Promise.all([
            fetch(galleryUrl(meta.files.f32, bust), { cache: "no-cache" }),
            fetch(galleryUrl("/celebs/gallery.buckets.json", bust), { cache: "no-cache" }),
            fetch(galleryUrl("/celebs/gallery.features.json", bust), { cache: "no-cache" }).catch(() => null),
          ]);

          let featuresMap2: Record<string, FaceFeatures> = {};
          if (featuresRes2 && featuresRes2.ok) {
            try { featuresMap2 = await featuresRes2.json(); } catch {}
          }

          if (f32Res.ok && bucketsRes2.ok) {
            const buckets = (await bucketsRes2.json()) as BucketEntry[];
            const f32 = new Float32Array(await f32Res.arrayBuffer());
            const dim = meta.dim;
            const byId = new Map<string, CelebrityEmbedding>();
            for (let i = 0; i < buckets.length; i++) {
              const b = buckets[i]!;
              const off = i * dim;
              const f32Desc = l2Normalize(f32.subarray(off, off + dim));
              const feat = hydrateFaceFeatures(
                featuresMap2[b.id]
                  ?? getCelebrityById(b.id)?.features
                  ?? generateDemographicFeatures(b.gender, b.genderProb, b.age, b.id),
              );

              const existing = byId.get(b.id);
              const refVec = makeReferenceVector(
                f32Desc,
                feat,
                b.path ?? b.fallbackPath,
                existing ? "expression" : "frontal",
              );

              if (!existing) {
                byId.set(b.id, {
                  id: b.id,
                  name: b.name,
                  path: b.path,
                  path192: b.path192,
                  fallbackPath: b.fallbackPath,
                  descriptor: Array.from(f32Desc),
                  descriptors: [f32Desc],
                  referenceVectors: [refVec],
                  age: b.age,
                  gender: b.gender,
                  genderProb: b.genderProb,
                  features: feat,
                });
              } else {
                const isClone = existing.descriptors!.some(
                  (d) => ensembleDistance(d, f32Desc) < 1e-4,
                );
                if (!isClone) {
                  existing.descriptors!.push(f32Desc);
                  existing.referenceVectors!.push(refVec);
                }
              }
            }
            galleryCache = await applyExtraReferences(
              sanitizeGalleryEmbeddings(Array.from(byId.values())).gallery,
            );
            void idbSet(cacheKey, galleryCache);
            return galleryCache;
          }
        } catch {}
      }
    } catch {}

    // Legacy fallback: JSON gallery (v2)
    try {
      const res = await fetch("/celebs/embeddings.json", { cache: "no-cache" });
      if (res.ok) {
        const data = (await res.json()) as EmbeddingsGallery;
        galleryCache = await applyExtraReferences(sanitizeGalleryEmbeddings(
          data.celebrities.map((c) => {
            const f32Desc = l2Normalize(c.descriptor);
            const feat = hydrateFaceFeatures(
              c.features ?? getCelebrityById(c.id)?.features ?? generateDemographicFeatures(c.gender, c.genderProb, c.age, c.id),
            );
            const refVec = makeReferenceVector(f32Desc, feat, c.path, "frontal");
            return {
              ...c,
              descriptor: Array.from(f32Desc),
              descriptors: [f32Desc],
              referenceVectors: [refVec],
              features: feat,
            };
          }),
        ).gallery);
        return galleryCache;
      }
    } catch {
      /* fallback to CELEBRITIES */
    }

    // Node / test fallback using CELEBRITIES database with multi-vector expansion
    galleryCache = sanitizeGalleryEmbeddings(
      CELEBRITIES.map((c, i) => {
        const feat = hydrateFaceFeatures(
          c.features ?? getCelebrityById(c.id)?.features ?? generateDemographicFeatures("male", 0.85, 35, c.id),
        );

        const referenceVectors: ReferenceVector[] = [];
        const descriptors: Float32Array[] = [];

        if (c.referenceViews && c.referenceViews.length > 0) {
          c.referenceViews.forEach((rv, k) => {
            const raw = new Float32Array(128);
            for (let j = 0; j < 128; j++) {
              raw[j] = Math.sin((i + 1) * (j + 1) * 0.1) + (k * 0.04) * Math.cos((j + 1) * 0.15);
            }
            const desc = l2Normalize(raw);
            descriptors.push(desc);
            const defaultPose =
              rv.pose ??
              (rv.viewType === "frontal"
                ? FRONTAL_NEUTRAL_POSE
                : rv.viewType === "expression"
                  ? { yawDeg: 2, pitchDeg: 4, rollDeg: 0 }
                  : undefined);
            referenceVectors.push({
              descriptor: desc,
              viewType: rv.viewType,
              pose: defaultPose,
              photoUrl: rv.photoUrl ?? `/celebs/${c.id}.jpg`,
              features: rv.features ? { ...feat, ...rv.features } : feat,
            });
          });
        } else {
          const raw = new Float32Array(128);
          for (let j = 0; j < 128; j++) {
            raw[j] = Math.sin((i + 1) * (j + 1) * 0.1);
          }
          const desc = l2Normalize(raw);
          descriptors.push(desc);
          referenceVectors.push(makeReferenceVector(desc, feat, `/celebs/${c.id}.jpg`, "frontal"));
        }

        const primaryDesc = descriptors[0]!;
        return {
          id: c.id,
          name: c.name,
          path: `/celebs/${c.id}.jpg`,
          descriptor: Array.from(primaryDesc),
          descriptors,
          referenceVectors,
          age: 35,
          gender: (feat.masculine ?? 0.5) > 0.5 ? "male" : "female",
          genderProb: 0.85,
          features: feat,
        };
      }),
    ).gallery;
    return galleryCache;
  })().catch((err) => {
    galleryPromise = null;
    throw err;
  });

  return galleryPromise;
}

export function prefetchEmbeddings(): void {
  if (typeof window === "undefined") return;
  void loadCelebrityEmbeddings().catch(() => {});
}

function l2Norm(v: ArrayLike<number>): number {
  if (!v || v.length === 0) return 1.0;
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const val = v[i];
    if (typeof val === "number" && Number.isFinite(val)) {
      s += val * val;
    }
  }
  return Math.sqrt(s) || 1.0;
}

export function l2Normalize(v: ArrayLike<number>): Float32Array {
  if (!v || v.length === 0) return new Float32Array(0);
  const n = l2Norm(v);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const val = v[i];
    out[i] = typeof val === "number" && Number.isFinite(val) ? val / n : 0.0;
  }
  return out;
}

/** Euclidean distance between two equal-length vectors. Returns 1.0 for empty or invalid vectors. */
export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 1.0;
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1.0;
  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    const aNum = typeof av === "number" && Number.isFinite(av) ? av : 0;
    const bNum = typeof bv === "number" && Number.isFinite(bv) ? bv : 0;
    const d = aNum - bNum;
    sum += d * d;
    validCount++;
  }
  if (validCount === 0) return 1.0;
  return Math.sqrt(sum);
}

/** Cosine distance in [0,2] (0=identical). Vectors are L2-normalized internally. Returns 1.0 for empty vectors. */
export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 1.0;
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1.0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  let validCount = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    const aNum = typeof av === "number" && Number.isFinite(av) ? av : 0;
    const bNum = typeof bv === "number" && Number.isFinite(bv) ? bv : 0;
    dot += aNum * bNum;
    na += aNum * aNum;
    nb += bNum * bNum;
    validCount++;
  }
  if (validCount === 0 || na === 0 || nb === 0) return 1.0;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  const result = 1.0 - Math.max(-1.0, Math.min(1.0, cos));
  return Number.isFinite(result) ? result : 1.0;
}

/** Ensemble: 0.90 euclidean + 0.42 cosine */
export function ensembleDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const euc = euclideanDistance(a, b);
  const cos = cosineDistance(a, b);
  return 0.90 * euc + 0.42 * cos;
}

/**
 * Combines normalized 23-d canonical morphological descriptors with 128-d deep vector representations.
 * Incorporates head pose adaptive landmark weighting, cross-demographic mismatch penalty, and calibrated age gap penalty.
 */
export function combinedDescriptorDistance(
  deepVecA: ArrayLike<number>,
  deepVecB: ArrayLike<number>,
  featA?: FaceFeatures | null,
  featB?: FaceFeatures | null,
  options?: {
    headPose?: HeadPoseOrientation;
    ethnicClusterA?: EthnicCluster | null;
    ethnicClusterB?: EthnicCluster | null;
    userAge?: number | null;
    celebAge?: number | null;
  },
): number {
  const deepDist = ensembleDistance(deepVecA, deepVecB);
  const hasMorph = hasMorphologicalFeatures(featA, featB);
  const morphDist = hasMorph ? morphologicalDistance(featA, featB) : 0;
  const wGeom = hasMorph
    ? (options?.headPose ? getPoseAdaptiveLandmarkWeight(options.headPose as any, 0.10) : 0.10)
    : 0.0;
  const crossPenalty = crossDemographicMismatchPenalty(featA, featB, options?.ethnicClusterA, options?.ethnicClusterB);
  const agePenalty = calibratedAgeGapPenalty(deepDist, options?.userAge, options?.celebAge);
  
  return (1 - wGeom) * deepDist + wGeom * morphDist + crossPenalty + agePenalty;
}

/**
 * Convert FaceNet L2 distance to a calibrated match percentage using the Hill Equation curve:
 * P(d) = 15.0 + 85.0 / (1 + (d / 0.32)^3.5)
 * rounded to 1 decimal place. distanceToMatchPercent(0) returns 100.0.
 */
export function distanceToMatchPercent(distance: number): number {
  if (Number.isNaN(distance)) return 15.0;
  if (distance <= 0) return 100.0;
  if (!Number.isFinite(distance)) return 15.0;
  const d = Math.max(0, distance);
  const hill = 15.0 + 85.0 / (1 + Math.pow(d / 0.32, 3.5));
  const pct = Math.max(15.0, Math.min(100.0, hill));
  return Math.round(pct * 10) / 10;
}

/**
 * Computes calibrated MatchScoreResult for two face identities matching contract in PROJECT.md.
 */
export function computeMatchScore(
  deepVecA: ArrayLike<number>,
  deepVecB: ArrayLike<number>,
  featA?: FaceFeatures | null,
  featB?: FaceFeatures | null,
  options?: {
    gateThresholdPct?: number;
    headPose?: HeadPoseOrientation;
    ethnicClusterA?: EthnicCluster | null;
    ethnicClusterB?: EthnicCluster | null;
    userAge?: number | null;
    celebAge?: number | null;
  },
): MatchScoreResult {
  const deepVectorDistance = cosineDistance(deepVecA, deepVecB);
  const deepEnsembleDist = ensembleDistance(deepVecA, deepVecB);
  const hasMorph = hasMorphologicalFeatures(featA, featB);
  const morphDist = hasMorph ? morphologicalDistance(featA, featB) : 0;
  
  const wGeom = hasMorph
    ? (options?.headPose ? getPoseAdaptiveLandmarkWeight(options.headPose as any, 0.10) : 0.10)
    : 0.0;
  const crossPenalty = crossDemographicMismatchPenalty(featA, featB, options?.ethnicClusterA, options?.ethnicClusterB);
  const agePenalty = calibratedAgeGapPenalty(deepEnsembleDist, options?.userAge, options?.celebAge);
  
  const descriptorDistance = (1 - wGeom) * deepEnsembleDist + wGeom * morphDist + crossPenalty + agePenalty;
  const confidencePct = distanceToMatchPercent(descriptorDistance);
  
  const gateThresholdPct = options?.gateThresholdPct ?? 20.0;
  const passedLookalikeGate =
    confidencePct >= gateThresholdPct &&
    confidencePct >= 20.0 &&
    descriptorDistance <= 0.70 &&
    crossPenalty < 0.20 &&
    agePenalty < 0.15;

  return {
    confidencePct,
    descriptorDistance,
    morphologicalDistance: hasMorph ? morphDist : 0,
    deepVectorDistance,
    passedLookalikeGate,
  };
}

/** Relative ranking percents from absolute distances (preserves order). */
export function rankPercentsFromDistances(distances: number[]): number[] {
  if (distances.length === 0) return [];
  const raw = distances.map(distanceToMatchPercent);
  const sortedIdx = raw
    .map((p, i) => ({ p, i, d: distances[i]! }))
    .sort((a, b) => a.d - b.d || b.p - a.p);
  const out = new Array<number>(raw.length);
  let last = Infinity;
  for (const item of sortedIdx) {
    const v = Math.min(item.p, last - 0.1);
    out[item.i] = Math.round(Math.max(15, v) * 10) / 10;
    last = out[item.i]!;
  }
  return out;
}

/**
 * Soft gender prior in (0, 1]. Same gender → 1.
 * Opposite gender is heavily down-weighted when the detector is confident
 * (was floor 0.78 — too weak; men still ranked for high-confidence female queries).
 */
export function genderAffinity(
  userGender: "male" | "female" | "unknown",
  userProb: number,
  celeb: CelebrityEmbedding,
): number {
  if (userGender === "unknown") return 1;
  if (userGender === celeb.gender) return 1;
  const prob = Math.max(0, Math.min(1, userProb));
  // High gender confidence → strong penalty (floor ~0.20 at prob=1)
  return Math.max(0.20, Math.min(1, 1 - 0.80 * prob));
}

/**
 * Continuous Gaussian age affinity.
 * Sigma 18yr (tighter than 28) so a ~70y query prefers older gallery faces.
 * Floored so extreme gaps stay a tiny positive soft prior (never hard-zero).
 */
export function ageAffinity(userAge: number, celebAge: number): number {
  const sigma = 18;
  const raw = Math.exp(-Math.pow(Math.abs(userAge - celebAge) / sigma, 2));
  return Math.max(1e-6, raw);
}

/**
 * Calibrated Non-Linear Age-Gap Penalty (Requirement R2 / Features F5, F6, F7).
 *
 * Applies a steep continuous non-linear penalty when:
 * 1. Match distance is in the weak/borderline regime (rawDist > 0.40), AND
 * 2. Age discrepancy is large (|Δage| > 20 years), particularly for mature users (userAge >= 40).
 *
 * Mathematical formulation:
 * P_age = P_max * sqrt(min(1, max(0, (rawDist - 0.40) / 0.10))) * min(1, max(0, (|Δage| - 20) / 20))^0.80 * min(1, max(0.5, userAge / 40))
 * where P_max = 0.22.
 *
 * Invariant properties:
 * - Strong matches (rawDist <= 0.40) return exactly 0.0.
 * - Age peers (|Δage| <= 20) return exactly 0.0.
 * - Missing/invalid/non-positive ages return 0.0.
 * - Max penalty is bounded at 0.22.
 */
export function calibratedAgeGapPenalty(
  rawDist: number,
  userAge?: number | null,
  celebAge?: number | null,
  options?: { matureThreshold?: number; maxPenalty?: number },
): number {
  if (!Number.isFinite(rawDist) || rawDist <= 0.40) return 0.0;
  if (userAge === null || userAge === undefined || !Number.isFinite(userAge) || userAge <= 0) return 0.0;
  if (celebAge === null || celebAge === undefined || !Number.isFinite(celebAge) || celebAge <= 0) return 0.0;

  const deltaAge = Math.abs(userAge - celebAge);
  if (deltaAge <= 20) return 0.0;

  const maxPenalty = options?.maxPenalty ?? 0.22;
  const matureThreshold = options?.matureThreshold ?? 40;

  // Distance excess factor with square root curve for immediate response at d > 0.40
  const distExcess = Math.min(1.0, Math.max(0.0, (rawDist - 0.40) / 0.10));
  const gDist = Math.sqrt(distExcess);

  // Age excess factor ramping smoothly from delta = 20 to delta = 40 with concave 0.80 exponent
  const ageExcess = Math.min(1.0, Math.max(0.0, (deltaAge - 20) / 20));
  const gAge = Math.pow(ageExcess, 0.80);

  // Mature weighting factor: 1.0 for userAge >= matureThreshold (40), floor 0.5 for younger users
  const matureWeight = Math.min(1.0, Math.max(0.5, userAge / matureThreshold));

  const penalty = maxPenalty * gDist * gAge * matureWeight;
  return Math.round(penalty * 1e6) / 1e6;
}

/**
 * Capture-quality confidence from detection metrics (not twin similarity).
 * Prefer blendWithMatchConfidence for user-facing badges.
 */
export function computeMatchConfidence(
  detConfidence: number,
  sharpness: number,
  faceCoverage: number,
  genderProb: number,
): number {
  const det = Math.max(0, Math.min(1, detConfidence > 1 ? detConfidence / 100 : detConfidence));
  const sharp = Math.max(0, Math.min(1, sharpness > 1 ? sharpness / 100 : sharpness));
  const covRaw = faceCoverage > 1 ? faceCoverage / 100 : faceCoverage;
  const cov = Math.max(0, Math.min(1, covRaw / 0.25));
  const gProb = Math.max(0, Math.min(1, genderProb > 1 ? genderProb / 100 : genderProb));

  const weighted = 0.35 * det + 0.25 * sharp + 0.20 * cov + 0.20 * gProb;
  const score = 10.0 + 90.0 * weighted;
  return Math.round(Math.max(10.0, Math.min(100.0, score)) * 10) / 10;
}

/**
 * User-facing confidence: blend capture quality with similarity so a weak twin
 * never shows "HIGH CONFIDENCE (98%)" next to 40% match.
 */
export function blendWithMatchConfidence(
  captureConfidence: number,
  matchPercent: number,
): number {
  const cap = Math.max(0, Math.min(100, captureConfidence));
  const sim = Math.max(0, Math.min(100, matchPercent));
  // Similarity dominates the badge; capture quality is a soft ceiling/floor.
  const blended = 0.35 * cap + 0.65 * sim;
  return Math.round(Math.max(10, Math.min(100, blended)) * 10) / 10;
}

export function mergeWithProfile(
  emb: CelebrityEmbedding,
  _profiles: CelebrityProfile[],
): {
  knownFor: string;
  tags: string[];
  accentHue: number;
} {
  void _profiles;
  return catalogFor(emb.id);
}
