import { catalogFor } from "../celebrities/catalog.ts";
import type { CelebrityProfile } from "../celebrities/types.ts";

export interface CelebrityEmbedding {
  id: string;
  path: string;
  name: string;
  descriptor: number[] | Float32Array;
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
const IDB_KEY = "gallery-v4";

export interface V4BinaryHeader {
  magic: string;
  version: number;
  flags: number;
  vectorCount: number;
  dimension: number;
  quantType: number;
  globalScale: number;
  globalOffset: number;
  checksum: number;
}

export function parseV4BinaryHeader(buffer: ArrayBuffer): V4BinaryHeader | null {
  if (!buffer || buffer.byteLength < 32) return null;
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );

  if (magic !== "AFv4") return null;

  return {
    magic,
    version: view.getUint16(4, true),
    flags: view.getUint16(6, true),
    vectorCount: view.getUint32(8, true),
    dimension: view.getUint16(12, true),
    quantType: view.getUint8(14),
    globalScale: view.getFloat32(16, true),
    globalOffset: view.getFloat32(20, true),
    checksum: view.getUint32(24, true),
  };
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

/** Load precomputed FaceNet/EdgeFace 256-d celebrity descriptors. */
export async function loadCelebrityEmbeddings(): Promise<CelebrityEmbedding[]> {
  if (galleryCache) return galleryCache;
  if (galleryPromise) return galleryPromise;

  galleryPromise = (async () => {
    // 1. Primary Path: AccuFace v4.0 Binary Gallery (embeddings.v4.q8.bin)
    try {
      const cachedV4 = await idbGet("4.0.0");
      if (cachedV4 && cachedV4.length > 0 && cachedV4[0]?.descriptor.length === 256) {
        galleryCache = cachedV4;
        return galleryCache;
      }

      const [bucketsRes, binRes] = await Promise.all([
        fetch("/celebs/gallery.buckets.json?v=4.0.0", { cache: "force-cache" }),
        fetch("/celebs/embeddings.v4.q8.bin?v=4.0.0", { cache: "force-cache" }),
      ]);

      if (bucketsRes.ok && binRes.ok) {
        const buckets = (await bucketsRes.json()) as BucketEntry[];
        const arrayBuf = await binRes.arrayBuffer();
        const header = parseV4BinaryHeader(arrayBuf);

        if (
          header &&
          header.magic === "AFv4" &&
          header.dimension === 256 &&
          header.vectorCount === buckets.length &&
          arrayBuf.byteLength === 32 + buckets.length * 256
        ) {
          const payloadUint8 = new Uint8Array(arrayBuf, 32);
          const scale = header.globalScale;
          const out: CelebrityEmbedding[] = new Array(buckets.length);

          for (let i = 0; i < buckets.length; i++) {
            const b = buckets[i]!;
            const off = i * 256;
            const raw = new Float32Array(256);
            for (let j = 0; j < 256; j++) {
              const u = payloadUint8[off + j]! - 128;
              raw[j] = u * scale;
            }
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
          void idbSet("4.0.0", out);
          return galleryCache;
        }
      }
    } catch (err) {
      console.warn("[embeddings] v4 binary load failed, trying legacy fallback...", err);
    }

    // 2. Legacy Fallback Path: v3.1 128-d binary format
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

/**
 * 8-way loop unrolled dot product for 256-d Float32 vectors.
 * Breaks instruction latency chain and maximizes parallel FMA operations.
 */
export function dotProduct256(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = Math.min(a.length, b.length);
  if (len < 256) {
    let dot = 0;
    for (let i = 0; i < len; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
    }
    return dot;
  }
  let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
  let sum4 = 0, sum5 = 0, sum6 = 0, sum7 = 0;
  for (let i = 0; i < 256; i += 8) {
    sum0 += (a[i] ?? 0) * (b[i] ?? 0);
    sum1 += (a[i + 1] ?? 0) * (b[i + 1] ?? 0);
    sum2 += (a[i + 2] ?? 0) * (b[i + 2] ?? 0);
    sum3 += (a[i + 3] ?? 0) * (b[i + 3] ?? 0);
    sum4 += (a[i + 4] ?? 0) * (b[i + 4] ?? 0);
    sum5 += (a[i + 5] ?? 0) * (b[i + 5] ?? 0);
    sum6 += (a[i + 6] ?? 0) * (b[i + 6] ?? 0);
    sum7 += (a[i + 7] ?? 0) * (b[i + 7] ?? 0);
  }
  return sum0 + sum1 + sum2 + sum3 + sum4 + sum5 + sum6 + sum7;
}

/**
 * Pure L2-normalized Cosine distance d = 1 - a_hat^T b_hat for 256-d vectors.
 * Clamps distance to [0.0, 2.0] and handles zero/invalid vectors gracefully.
 */
export function cosineDistance256(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 1.0;
  const rawDot = dotProduct256(a, b);
  if (!Number.isFinite(rawDot)) return 1.0;
  const dot = Math.max(-1.0, Math.min(1.0, rawDot));
  const dist = 1.0 - dot;
  return Math.max(0.0, Math.min(2.0, dist));
}

/** Cosine distance in [0,2] (0=identical). Uses 8-way unrolled dot product for 256-d vectors. */
export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 1.0;
  if (a.length === 256 && b.length === 256) {
    return cosineDistance256(a, b);
  }
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
  if (na === 0 || nb === 0) return 1.0;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  const clampedCos = Math.max(-1.0, Math.min(1.0, cos));
  const dist = 1.0 - clampedCos;
  return Math.max(0.0, Math.min(2.0, dist));
}

/** Ensemble: 0.72 euclidean + 0.28 cosine (both calibrated to ~[0,1.4]) */
export function ensembleDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const euc = euclideanDistance(a, b);
  const cos = cosineDistance(a, b);
  const cosAsEuc = cos * 0.85;
  return 0.72 * euc + 0.28 * cosAsEuc;
}

/**
 * Convert EdgeFace-M 256-d Cosine distance (d = 1 - a_hat^T b_hat) to a calibrated match percentage
 * using the recalibrated AccuFace v4.0 Hill Equation curve:
 * P(d) = 100.0 / (1 + (d / 0.38)^4.5)
 * rounded to 1 decimal place. distanceToMatchPercent(0) returns 100.0; distanceToMatchPercent(0.38) returns 50.0.
 */
export function distanceToMatchPercent(distance: number): number {
  if (typeof distance !== "number" || Number.isNaN(distance)) return 0.0;
  if (!Number.isFinite(distance)) return distance < 0 ? 100.0 : 0.0;
  const d = Math.max(0, distance);
  const hill = 100.0 / (1 + Math.pow(d / 0.38, 4.5));
  const pct = Math.max(0.0, Math.min(100.0, hill));
  return Math.round(pct * 10) / 10;
}

/** Relative ranking percents from absolute distances (preserves order). */
export function rankPercentsFromDistances(distances: number[]): number[] {
  if (!distances || distances.length === 0) return [];
  const raw = distances.map(distanceToMatchPercent);
  const sortedIdx = raw
    .map((p, i) => ({ p, i, d: Number.isFinite(distances[i]) ? (distances[i] as number) : Infinity }))
    .sort((a, b) => a.d - b.d || b.p - a.p);
  const out = new Array<number>(raw.length);
  let last = Infinity;
  for (const item of sortedIdx) {
    const v = Math.min(item.p, last - 0.1);
    out[item.i] = Math.round(Math.max(0, v) * 10) / 10;
    last = out[item.i]!;
  }
  return out;
}

export function genderAffinity(
  userGender: "male" | "female" | "unknown" | string | undefined,
  userProb: number | undefined,
  celeb: CelebrityEmbedding,
): number {
  if (!userGender || userGender === "unknown" || !celeb || !celeb.gender) return 1;
  if (userGender === celeb.gender) return 1;
  const rawProb = typeof userProb === "number" && Number.isFinite(userProb) ? userProb : 0.9;
  const prob = Math.max(0, Math.min(1, rawProb));
  return Math.max(0.75, Math.min(1, 1 - 0.22 * prob));
}

/** Continuous Gaussian age affinity: ageAffinity(userAge, celebAge) = Math.exp(-Math.pow(Math.abs(userAge - celebAge) / 28, 2)) */
export function ageAffinity(userAge: number | undefined, celebAge: number | undefined): number {
  if (typeof userAge !== "number" || !Number.isFinite(userAge) || typeof celebAge !== "number" || !Number.isFinite(celebAge)) {
    return 1;
  }
  return Math.exp(-Math.pow(Math.abs(userAge - celebAge) / 28, 2));
}

/**
 * Compute overall match confidence rating in [10, 100] based on face detection and quality metrics.
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
