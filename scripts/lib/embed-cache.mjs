/**
 * sha256 → AdaFace embed cache. Enrollment re-runs skip redundant IR-101
 * forwards when the photo bytes have not changed.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const EMBED_CACHE_MODEL = "adaface-ir101-512d";

export function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function embedCachePath(root = process.cwd()) {
  return path.join(root, ".cache", "adaface-embed-cache.json");
}

export function embedCacheKey(fileSha, modelId = EMBED_CACHE_MODEL) {
  return `${modelId}:${fileSha}`;
}

export function loadEmbedCache(cachePath) {
  if (!fs.existsSync(cachePath)) {
    return { version: 1, model: EMBED_CACHE_MODEL, entries: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.entries !== "object") {
      throw new Error("invalid cache shape");
    }
    return parsed;
  } catch {
    return { version: 1, model: EMBED_CACHE_MODEL, entries: {} };
  }
}

export function saveEmbedCache(cache, cachePath) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache));
}

/**
 * Split jobs into cache hits (same bytes already embedded) and misses.
 * Missing filePaths are always misses so the worker can report the error.
 *
 * @param {Array<{ filePath?: string | null }>} jobs
 * @param {{ entries?: Record<string, unknown> }} cache
 * @param {string} [modelId]
 */
export function partitionCachedJobs(jobs, cache, modelId = EMBED_CACHE_MODEL) {
  const hits = [];
  const misses = [];
  const missIndex = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const filePath = job?.filePath;
    if (typeof filePath !== "string" || !fs.existsSync(filePath)) {
      misses.push(job);
      missIndex.push(i);
      continue;
    }
    const key = embedCacheKey(fileSha256(filePath), modelId);
    const entry = cache.entries?.[key];
    if (entry && Array.isArray(entry.d512) && entry.d512.length > 0) {
      hits.push({ index: i, key, value: entry });
    } else {
      misses.push(job);
      missIndex.push(i);
    }
  }
  return { hits, misses, missIndex };
}
