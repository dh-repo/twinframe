import { catalogFor } from "../celebrities/catalog.ts";
import { CELEBRITIES, getCelebrityById, generateDemographicFeatures } from "../celebrities/database.ts";
import type { CelebrityProfile } from "../celebrities/types.ts";
import type {
  FaceFeatures,
  CelebrityEmbedding,
  ReferenceVector,
  FaceViewType,
  HeadPoseOrientation,
} from "./types.ts";
export type { CelebrityEmbedding, ReferenceVector, FaceViewType, HeadPoseOrientation };
import { sanitizeGalleryEmbeddings } from "./gallery-dedupe.ts";

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
            const descs = getCelebrityDescriptors(c);
            const refs = c.referenceVectors && c.referenceVectors.length > 0
              ? c.referenceVectors.map((r) => ({
                  ...r,
                  descriptor: r.descriptor instanceof Float32Array ? r.descriptor : l2Normalize(r.descriptor),
                }))
              : descs.map((d) => ({
                  descriptor: d,
                  photoUrl: c.path,
                  features: c.features,
                }));
            return {
              ...c,
              descriptor: c.descriptor || Array.from(descs[0]!),
              descriptors: descs,
              referenceVectors: refs,
              features: c.features ?? getCelebrityById(c.id)?.features ?? generateDemographicFeatures(c.gender, c.genderProb, c.age, c.id),
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
    celeb.descriptors = celeb.descriptors ?? [
      celeb.descriptor instanceof Float32Array
        ? celeb.descriptor
        : Float32Array.from(celeb.descriptor),
    ];
    const isClone = celeb.descriptors.some((d) => ensembleDistance(d, vec) < cloneEps);
    if (isClone) continue;
    celeb.descriptors.push(vec);
    celeb.referenceVectors = celeb.referenceVectors ?? [];
    celeb.referenceVectors.push({
      descriptor: vec,
      viewType: "expression",
      photoUrl: extra.photoUrl,
    });
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
  if (celeb.referenceVectors && celeb.referenceVectors.length > 0) {
    return celeb.referenceVectors.map((r) =>
      r.descriptor instanceof Float32Array ? r.descriptor : Float32Array.from(r.descriptor),
    );
  }

  if (celeb.descriptors && celeb.descriptors.length > 0) {
    return celeb.descriptors.map((d) =>
      d instanceof Float32Array ? d : Float32Array.from(d),
    );
  }

  if (celeb.descriptor && celeb.descriptor.length > 0) {
    return [
      celeb.descriptor instanceof Float32Array
        ? celeb.descriptor
        : Float32Array.from(celeb.descriptor),
    ];
  }

  return [];
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
        const cacheKey = `${bust}-dedupe-v1-m1-multivec-v8-plan-extras`;
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
              const feat = featuresMap[b.id]
                ?? getCelebrityById(b.id)?.features
                ?? generateDemographicFeatures(b.gender, b.genderProb, b.age, b.id);

              const refVec: ReferenceVector = {
                descriptor: f32Desc,
                photoUrl: b.path ?? b.fallbackPath,
                features: feat,
              };

              const existing = byId.get(b.id);
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
              const feat = featuresMap2[b.id]
                ?? getCelebrityById(b.id)?.features
                ?? generateDemographicFeatures(b.gender, b.genderProb, b.age, b.id);

              const refVec: ReferenceVector = {
                descriptor: f32Desc,
                photoUrl: b.path ?? b.fallbackPath,
                features: feat,
              };

              const existing = byId.get(b.id);
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
            const feat = c.features ?? getCelebrityById(c.id)?.features ?? generateDemographicFeatures(c.gender, c.genderProb, c.age, c.id);
            const refVec: ReferenceVector = { descriptor: f32Desc, photoUrl: c.path, features: feat };
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

    // Node / test fallback using CELEBRITIES database
    galleryCache = sanitizeGalleryEmbeddings(
      CELEBRITIES.map((c, i) => {
        const desc = new Float32Array(128);
        for (let j = 0; j < 128; j++) desc[j] = Math.sin((i + 1) * (j + 1) * 0.1);
        const f32Desc = l2Normalize(desc);
        const feat = c.features ?? getCelebrityById(c.id)?.features ?? generateDemographicFeatures("male", 0.85, 35, c.id);
        const refVec: ReferenceVector = { descriptor: f32Desc, photoUrl: `/celebs/${c.id}.jpg`, features: feat };
        return {
          id: c.id,
          name: c.name,
          path: `/celebs/${c.id}.jpg`,
          descriptor: Array.from(f32Desc),
          descriptors: [f32Desc],
          referenceVectors: [refVec],
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
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] ?? 0) * (v[i] ?? 0);
  return Math.sqrt(s) || 1;
}

export function l2Normalize(v: ArrayLike<number>): Float32Array {
  const n = l2Norm(v);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) / n;
  return out;
}

/** Euclidean distance between two equal-length vectors. */
export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Cosine distance in [0,2] (0=identical). Vectors are L2-normalized internally. */
export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 1;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return 1 - Math.max(-1, Math.min(1, cos));
}

/** Ensemble: 0.90 euclidean + 0.42 cosine */
export function ensembleDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const euc = euclideanDistance(a, b);
  const cos = cosineDistance(a, b);
  return 0.90 * euc + 0.42 * cos;
}

/**
 * Convert FaceNet L2 distance to a calibrated match percentage using the Hill Equation curve:
 * P(d) = 15.0 + 85.0 / (1 + (d / 0.32)^3.5)
 * rounded to 1 decimal place. distanceToMatchPercent(0) returns 100.0.
 */
export function distanceToMatchPercent(distance: number): number {
  const d = Math.max(0, distance);
  const hill = 15.0 + 85.0 / (1 + Math.pow(d / 0.32, 3.5));
  const pct = Math.max(15.0, Math.min(100.0, hill));
  return Math.round(pct * 10) / 10;
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
