/**
 * Ground-truth probe discovery for the Tier-1/Tier-3 accuracy harness.
 *
 * Only 271 of the 1000 catalog ids ship a full-size portrait at
 * public/celebs/<id>.jpg, so a root-JPG-only probe set covers a quarter of the
 * catalog. The rest do have on-disk renditions — the 192px and 96px WebP
 * thumbnails — and `--probe-sources` can fall back to them.
 *
 * Two facts about this probe set that no report built on it may omit:
 *
 *   1. Every one of these files is an enrolled image. collectEnrollJobs() in
 *      scripts/lib/enroll-jobs.mjs takes each identity's primary template from
 *      `<id>.jpg` when it exists and from a PNG decode of `thumbs/192/<id>.webp`
 *      otherwise — exactly the two sources here. So Tier 1 measures whether the
 *      engine recognizes its own enrollment photo: a self-recognition and
 *      enrollment-integrity check, not accuracy on an unseen photo. Held-out
 *      accuracy lives in scripts/evaluate-held-out.ts. `enrollmentRelation`
 *      records which of the two each probe is.
 *   2. The gallery caps the coverage, not the probe count. The legacy FaceNet-128
 *      gallery this harness scores against (public/celebs/embeddings.json) only
 *      ever enrolled the ids with a root JPG: 265 of its 1000 descriptors are real
 *      face embeddings (pairwise cosine ~0.79, tightly clustered around a shared
 *      mean direction, as FaceNet descriptors are), and the other 735 are random
 *      unit vectors — pairwise cosine ~0.00, no shared direction. A probe for one
 *      of those 735 ids cannot rank its own identity above chance no matter how
 *      good its photo is: its own "gallery vector" is noise.
 *      classifyGalleryDescriptors() detects that cohort so the harness reports it
 *      as missing enrollment instead of as an accuracy regression.
 */
import fs from "node:fs";
import path from "node:path";

export const PROBE_SOURCES = ["root-jpg", "thumb-192", "thumb-96"];
export const ALL_PROBE_SOURCES = PROBE_SOURCES;
export const ROOT_ONLY_PROBE_SOURCES = ["root-jpg"];
/**
 * Root JPGs only, by default. Measured 2026-08-18 over a 12-id spread sample of
 * thumbnail probes: the 2 ids that also ship a root JPG scored Rank-1 at cosine
 * 0.99 from their own gallery vector (same image, as expected), while all 10 ids
 * without one sat ~1.0 from their own vector and ranked their identity 382nd-727th
 * — their FaceNet gallery entry is a random vector, not a face. Folding those into
 * the default Tier-1 number would report missing enrollment as an accuracy
 * regression, so opt in with --probe-sources all to measure it deliberately.
 */
export const DEFAULT_PROBE_SOURCES = ROOT_ONLY_PROBE_SOURCES;

/**
 * Alignment gap that separates real face descriptors from random filler vectors.
 * Measured: the FaceNet gallery splits at 0.31 vs 0.82 (gap 0.51), while the real
 * EdgeFace v4 gallery's largest interior gap is 0.006. Two orders of magnitude
 * apart, so 0.25 is a safe cut.
 */
export const SYNTHETIC_COHORT_MIN_GAP = 0.25;

/** `--probe-sources root|thumbs|all|root-jpg,thumb-192` → concrete source list. */
export function parseProbeSourcesArg(value) {
  if (!value) return [...DEFAULT_PROBE_SOURCES];
  if (value === "all") return [...ALL_PROBE_SOURCES];
  if (value === "root") return [...ROOT_ONLY_PROBE_SOURCES];
  if (value === "thumbs") return ["thumb-192", "thumb-96"];
  const requested = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = requested.filter((s) => !PROBE_SOURCES.includes(s));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown probe source(s): ${unknown.join(", ")}. Use root, thumbs, all, or ${PROBE_SOURCES.join("/")}.`,
    );
  }
  return PROBE_SOURCES.filter((s) => requested.includes(s));
}

/**
 * How a probe file relates to what was enrolled for that identity. Both answers
 * mean "the engine has seen this photo"; they differ only in resolution.
 */
export function enrollmentRelation(source, hasRootJpg) {
  switch (source) {
    case "root-jpg":
      return "enrolled photo";
    case "thumb-192":
    case "thumb-96":
      return hasRootJpg ? "downscale of the enrolled photo" : "enrolled photo (downscaled)";
    default: {
      const exhaustive = source;
      throw new Error(`Unknown probe source: ${exhaustive}`);
    }
  }
}

/** Candidate probe files for one id, best first, whether or not they exist. */
export function probeSourceCandidates(id, celebsDir) {
  return [
    {
      source: "root-jpg",
      filePath: path.join(celebsDir, `${id}.jpg`),
      relPath: `/celebs/${id}.jpg`,
      needsTranscode: false,
    },
    {
      source: "thumb-192",
      filePath: path.join(celebsDir, "thumbs/192", `${id}.webp`),
      relPath: `/celebs/thumbs/192/${id}.webp`,
      needsTranscode: true,
    },
    {
      source: "thumb-96",
      filePath: path.join(celebsDir, "thumbs/96", `${id}.webp`),
      relPath: `/celebs/thumbs/96/${id}.webp`,
      needsTranscode: true,
    },
  ].filter((candidate) => PROBE_SOURCES.includes(candidate.source));
}

/**
 * One probe per catalog id, using the best available on-disk rendition.
 *
 * @param {Array<{ id: string, name: string, path?: string, path192?: string, fallbackPath?: string, gender?: string, baseAge?: number, ageBuckets?: number[] }>} index
 * @param {{ celebsDir: string, sources?: string[], exists?: (p: string) => boolean }} options
 */
export function collectProbeCatalog(index, options) {
  const sources = options.sources ?? DEFAULT_PROBE_SOURCES;
  const exists = options.exists ?? fs.existsSync;
  const catalog = [];

  for (const entry of index) {
    if (!entry?.id) continue;
    const hasRootJpg = exists(path.join(options.celebsDir, `${entry.id}.jpg`));
    for (const candidate of probeSourceCandidates(entry.id, options.celebsDir)) {
      if (!sources.includes(candidate.source)) continue;
      if (!exists(candidate.filePath)) continue;
      catalog.push({
        id: entry.id,
        name: entry.name ?? entry.id,
        filename: path.basename(candidate.filePath),
        filePath: candidate.filePath,
        source: candidate.source,
        needsTranscode: candidate.needsTranscode,
        enrollmentRelation: enrollmentRelation(candidate.source, hasRootJpg),
        groundTruthId: entry.id,
        baseAge: entry.baseAge ?? entry.ageBuckets?.[1] ?? 40,
        gender: entry.gender ?? "unknown",
      });
      break;
    }
  }

  catalog.sort((a, b) => a.id.localeCompare(b.id));
  return catalog;
}

/**
 * Split a gallery into descriptors that are real face embeddings and descriptors
 * that are random filler.
 *
 * Real embeddings from one model sit in a narrow cone: every descriptor aligns
 * strongly with the population mean direction (FaceNet: cosine 0.82-0.95). Random
 * unit vectors are near-orthogonal to any fixed direction (cosine within ~±0.3 at
 * 128 dimensions), so a gallery that mixes the two shows a wide empty gap in its
 * alignment histogram. A gallery of only real vectors shows no such gap — the
 * EdgeFace v4 gallery spreads smoothly from -0.28 to 0.46 — so the split is only
 * applied when the gap is unambiguous, and every descriptor counts as enrolled
 * otherwise.
 *
 * @param {Array<ArrayLike<number>>} descriptors
 * @returns {{ enrolled: boolean[], syntheticCount: number, splitAt: number | null, alignment: number[] }}
 */
export function classifyGalleryDescriptors(descriptors) {
  const n = descriptors.length;
  if (n === 0) return { enrolled: [], syntheticCount: 0, splitAt: null, alignment: [] };

  const dim = descriptors[0].length;
  const mean = new Float64Array(dim);
  const units = descriptors.map((descriptor) => {
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += descriptor[i] * descriptor[i];
    norm = Math.sqrt(norm) || 1;
    const unit = new Float64Array(dim);
    for (let i = 0; i < dim; i++) {
      unit[i] = descriptor[i] / norm;
      mean[i] += unit[i] / n;
    }
    return unit;
  });

  let meanNorm = 0;
  for (let i = 0; i < dim; i++) meanNorm += mean[i] * mean[i];
  meanNorm = Math.sqrt(meanNorm);
  if (meanNorm < 1e-9) {
    return { enrolled: units.map(() => true), syntheticCount: 0, splitAt: null, alignment: units.map(() => 0) };
  }
  for (let i = 0; i < dim; i++) mean[i] /= meanNorm;

  const alignment = units.map((unit) => {
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += unit[i] * mean[i];
    return dot;
  });

  // Widest empty band in the alignment histogram, ignoring the outer 2% so a
  // single stray descriptor cannot masquerade as a cohort boundary.
  const sorted = [...alignment].sort((a, b) => a - b);
  const lo = Math.floor(n * 0.02);
  const hi = Math.max(lo, Math.ceil(n * 0.98) - 1);
  let widestGap = 0;
  let splitAt = null;
  for (let i = lo; i < hi; i++) {
    const gap = sorted[i + 1] - sorted[i];
    if (gap > widestGap) {
      widestGap = gap;
      splitAt = (sorted[i] + sorted[i + 1]) / 2;
    }
  }
  if (widestGap < SYNTHETIC_COHORT_MIN_GAP) {
    return { enrolled: alignment.map(() => true), syntheticCount: 0, splitAt: null, alignment };
  }

  const enrolled = alignment.map((value) => value >= splitAt);
  return {
    enrolled,
    syntheticCount: enrolled.filter((isEnrolled) => !isEnrolled).length,
    splitAt,
    alignment,
  };
}

/** Accuracy split by whether the probe's own identity has a real gallery vector. */
export function summarizeByEnrollment(records) {
  const cohorts = {};
  for (const record of records) {
    const key = record.groundTruthEnrolled === false ? "unenrolled" : "enrolled";
    const bucket = (cohorts[key] ??= { cohort: key, totalProbes: 0, detectedProbes: 0, top1Count: 0, top5Count: 0 });
    bucket.totalProbes += 1;
    if (record.detected) bucket.detectedProbes += 1;
    if (record.isTop1) bucket.top1Count += 1;
    if (record.isTop5) bucket.top5Count += 1;
  }
  for (const bucket of Object.values(cohorts)) {
    const n = Math.max(1, bucket.totalProbes);
    bucket.detectionRatePct = (bucket.detectedProbes / n) * 100;
    bucket.top1AccuracyPct = (bucket.top1Count / n) * 100;
    bucket.top5AccuracyPct = (bucket.top5Count / n) * 100;
  }
  return cohorts;
}

/**
 * Deterministic subset of `catalog` for limited runs.
 *
 * A CPU-only pass costs ~24s per probe, so most runs are limited ones — and
 * `slice(0, n)` over an id-sorted catalog means every quick number describes the
 * celebrities whose names start with A. "spread" walks the catalog with an even
 * stride instead, so a 20-probe run still touches the whole alphabet.
 *
 * @param {Array<unknown>} catalog
 * @param {number | null} limit
 * @param {"spread" | "first"} mode
 */
export function sampleProbes(catalog, limit, mode = "spread") {
  if (!limit || limit <= 0 || limit >= catalog.length) return [...catalog];
  switch (mode) {
    case "first":
      return catalog.slice(0, limit);
    case "spread": {
      const picked = [];
      for (let i = 0; i < limit; i++) {
        picked.push(catalog[Math.floor((i * catalog.length) / limit)]);
      }
      return picked;
    }
    default: {
      const exhaustive = mode;
      throw new Error(`Unknown sample mode: ${exhaustive}`);
    }
  }
}

export function countBySource(catalog) {
  const counts = {};
  for (const source of PROBE_SOURCES) counts[source] = 0;
  for (const probe of catalog) counts[probe.source] += 1;
  return counts;
}

/**
 * Accuracy per probe source. Records must carry `source` and
 * `enrollmentRelation` so a reader can see that both cohorts are enrolled images.
 */
export function summarizeBySource(records) {
  const bySource = {};
  for (const record of records) {
    const source = record.source ?? "unknown";
    const bucket = (bySource[source] ??= {
      source,
      enrollmentRelation: record.enrollmentRelation ?? "unknown",
      totalProbes: 0,
      detectedProbes: 0,
      top1Count: 0,
      top5Count: 0,
    });
    bucket.totalProbes += 1;
    if (record.detected) bucket.detectedProbes += 1;
    if (record.isTop1) bucket.top1Count += 1;
    if (record.isTop5) bucket.top5Count += 1;
  }
  for (const bucket of Object.values(bySource)) {
    const n = Math.max(1, bucket.totalProbes);
    bucket.detectionRatePct = (bucket.detectedProbes / n) * 100;
    bucket.top1AccuracyPct = (bucket.top1Count / n) * 100;
    bucket.top5AccuracyPct = (bucket.top5Count / n) * 100;
  }
  return bySource;
}
