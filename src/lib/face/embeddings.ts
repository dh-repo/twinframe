import { catalogFor } from "../celebrities/catalog.ts";
import type { CelebrityProfile } from "../celebrities/types.ts";

export interface CelebrityEmbedding {
  id: string;
  path: string;
  name: string;
  descriptor: number[];
  age: number;
  gender: "male" | "female";
  genderProb: number;
  // age-bucketed gallery extra
  bucketAge?: number;
  fallbackPath?: string;
  path192?: string;
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
const IDB_KEY = "gallery-v3";

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
        if (v && v.version === version) res(v.data);
        else res(null);
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

/** Load precomputed FaceNet-style 128-d celebrity descriptors. */
export async function loadCelebrityEmbeddings(): Promise<CelebrityEmbedding[]> {
  if (galleryCache) return galleryCache;
  if (galleryPromise) return galleryPromise;

  galleryPromise = (async () => {
    // Try efficient binary gallery first (v3): meta + buckets + q8 bin
    try {
      const metaRes = await fetch("/celebs/embeddings.meta.json?v=3.0.0", { cache: "force-cache" });
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as GalleryMeta;
        // check IDB cache
        const cached = await idbGet(meta.version);
        if (cached) {
          galleryCache = cached;
          return galleryCache;
        }

        const [bucketsRes, binRes] = await Promise.all([
          fetch("/celebs/gallery.buckets.json?v=3.0.0", { cache: "force-cache" }),
          fetch(meta.files.q8 + "?v=3.0.0", { cache: "force-cache" }),
        ]);
        if (bucketsRes.ok && binRes.ok) {
          const buckets = (await bucketsRes.json()) as BucketEntry[];
          const bin = new Uint8Array(await binRes.arrayBuffer());
          const scale = meta.scale;
          const dim = meta.dim;
          if (bin.length === buckets.length * dim) {
            const out: CelebrityEmbedding[] = new Array(buckets.length);
            for (let i = 0; i < buckets.length; i++) {
              const b = buckets[i]!;
              const off = i * dim;
              const raw = new Array<number>(dim);
              for (let j = 0; j < dim; j++) {
                const q = bin[off + j]! - 127; // unbias
                raw[j] = q * scale;
              }
              // High-accuracy: ensure gallery vectors are L2-normalized (quantization drifts ~0.02)
              const desc = Array.from(l2Normalize(raw));
              out[i] = {
                id: b.id,
                name: b.name,
                path: b.path, // 96 WebP thumb
                path192: b.path192,
                fallbackPath: b.fallbackPath,
                descriptor: desc,
                age: b.age,
                gender: b.gender,
                genderProb: b.genderProb,
              };
            }
            galleryCache = out;
            void idbSet(meta.version, out);
            return galleryCache;
          }
        }
        // fallback to f32 if q8 failed
        try {
          const f32Res = await fetch(meta.files.f32 + "?v=3.0.0", { cache: "force-cache" });
          const bucketsRes2 = await fetch("/celebs/gallery.buckets.json?v=3.0.0", { cache: "force-cache" });
          if (f32Res.ok && bucketsRes2.ok) {
            const buckets = (await bucketsRes2.json()) as BucketEntry[];
            const f32 = new Float32Array(await f32Res.arrayBuffer());
            const dim = meta.dim;
            const out: CelebrityEmbedding[] = new Array(buckets.length);
            for (let i = 0; i < buckets.length; i++) {
              const b = buckets[i]!;
              const off = i * dim;
              const raw = Array.from(f32.subarray(off, off + dim));
              const desc = Array.from(l2Normalize(raw));
              out[i] = {
                id: b.id,
                name: b.name,
                path: b.path,
                path192: b.path192,
                fallbackPath: b.fallbackPath,
                descriptor: desc,
                age: b.age,
                gender: b.gender,
                genderProb: b.genderProb,
              };
            }
            galleryCache = out;
            void idbSet(meta.version, out);
            return galleryCache;
          }
        } catch {}
      }
    } catch {}

    // Legacy fallback: JSON gallery (v2)
    const res = await fetch("/celebs/embeddings.json?v=2.1.0", { cache: "force-cache" });
    if (!res.ok) throw new Error("Could not load celebrity face gallery.");
    const data = (await res.json()) as EmbeddingsGallery;
    // Normalize legacy descriptors for high accuracy
    galleryCache = data.celebrities.map((c) => ({
      ...c,
      descriptor: Array.from(l2Normalize(c.descriptor)),
    }));
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

/** Ensemble: 0.72 euclidean + 0.28 cosine (both calibrated to ~[0,1.4]) */
export function ensembleDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const euc = euclideanDistance(a, b); // ~0-1.4 for FaceNet
  const cos = cosineDistance(a, b); // 0-2
  // Map cosine to euclidean scale
  const cosAsEuc = cos * 0.85;
  return 0.72 * euc + 0.28 * cosAsEuc;
}

/**
 * Convert FaceNet L2 distance to an honest match percentage.
 * Recalibrated for normalized + ensemble distances and tighter high-accuracy curve.
 */
export function distanceToMatchPercent(distance: number): number {
  const d = Math.max(0, Math.min(1.35, distance));
  // High-accuracy sigmoid: steeper around 0.42-0.62, 0.50 center
  const t = (0.50 - d) / 0.13;
  const sig = 1 / (1 + Math.exp(-t));
  const pct = 16 + sig * 80;
  return Math.round(Math.max(16, Math.min(96, pct)) * 10) / 10;
}

/** Relative ranking percents from absolute distances (preserves order). */
export function rankPercentsFromDistances(distances: number[]): number[] {
  if (distances.length === 0) return [];
  const raw = distances.map(distanceToMatchPercent);
  const sortedIdx = raw
    .map((p, i) => ({ p, i, d: distances[i]! }))
    .sort((a, b) => a.d - b.d || b.p - a.p);
  const out = new Array<number>(raw.length);
  let last = 100;
  for (const item of sortedIdx) {
    const v = Math.min(item.p, last - 0.1);
    out[item.i] = Math.round(Math.max(15, v) * 10) / 10;
    last = out[item.i]!;
  }
  return out;
}

export function genderAffinity(
  userGender: "male" | "female" | "unknown",
  userProb: number,
  celeb: CelebrityEmbedding,
): number {
  if (userGender === "unknown" || userProb < 0.58) return 1;
  if (userGender === celeb.gender) return 1;
  // High-accuracy: softer penalty, never dominate face distance
  const base = 0.78 + (1 - userProb) * 0.16;
  return Math.max(0.78, Math.min(1, base));
}

export function ageAffinity(userAge: number, celebAge: number): number {
  // Gaussian-like falloff for high accuracy: precise near age, gentle far
  const diff = Math.abs(userAge - celebAge);
  if (diff <= 6) return 1;
  if (diff <= 12) return 0.97;
  if (diff <= 20) return 0.91;
  if (diff <= 30) return 0.84;
  return 0.76;
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
