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
}

export interface EmbeddingsGallery {
  version: string;
  model: string;
  count: number;
  celebrities: CelebrityEmbedding[];
}

let galleryPromise: Promise<CelebrityEmbedding[]> | null = null;
let galleryCache: CelebrityEmbedding[] | null = null;

/** Load precomputed FaceNet-style 128-d celebrity descriptors. */
export async function loadCelebrityEmbeddings(): Promise<CelebrityEmbedding[]> {
  if (galleryCache) return galleryCache;
  if (galleryPromise) return galleryPromise;

  galleryPromise = (async () => {
    // version query busts stale CDN/browser cache after gallery expansions
    const res = await fetch("/celebs/embeddings.json?v=2.1.0");
    if (!res.ok) throw new Error("Could not load celebrity face gallery.");
    const data = (await res.json()) as EmbeddingsGallery;
    galleryCache = data.celebrities;
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
 * Convert FaceNet L2 distance to an honest match percentage.
 */
export function distanceToMatchPercent(distance: number): number {
  const d = Math.max(0, Math.min(1.3, distance));
  const t = (0.55 - d) / 0.14;
  const sig = 1 / (1 + Math.exp(-t));
  const pct = 18 + sig * 76;
  return Math.round(Math.max(18, Math.min(96, pct)) * 10) / 10;
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
  if (userGender === "unknown" || userProb < 0.6) return 1;
  if (userGender === celeb.gender) return 1;
  return 0.72 + (1 - userProb) * 0.2;
}

export function ageAffinity(userAge: number, celebAge: number): number {
  const diff = Math.abs(userAge - celebAge);
  if (diff <= 8) return 1;
  if (diff <= 15) return 0.95;
  if (diff <= 25) return 0.88;
  return 0.8;
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
