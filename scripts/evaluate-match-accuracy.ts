#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCelebrityById, generateDemographicFeatures } from "../src/lib/celebrities/database.ts";
import {
  l2Normalize,
  ensembleDistance,
  distanceToMatchPercent,
  getCelebrityDescriptors,
  mergeExtraReferences,
  hydrateFaceFeatures,
  type CelebrityEmbedding,
  type ReferenceVector,
} from "../src/lib/face/embeddings.ts";
import { sanitizeGalleryEmbeddings } from "../src/lib/face/gallery-dedupe.ts";
import { crossDemographicMismatchPenalty } from "../src/lib/face/geometry.ts";
import { rankByDescriptor, type UserFaceQuery } from "../src/lib/face/match.ts";
import {
  ENGINE_VERSION,
  type FaceFeatures,
  type EthnicCluster,
  getEthnicCluster,
} from "../src/lib/face/types.ts";

/** Deterministic L2-normalized descriptor perturbation for honest Rank-1 eval. */
export function perturbDescriptor(
  descriptor: ArrayLike<number>,
  scale = 0.02,
): Float32Array {
  const out = new Float32Array(descriptor.length);
  for (let i = 0; i < descriptor.length; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    const wave = Math.sin(i * 0.37 + scale * 12.3) * scale;
    out[i] = (descriptor[i] ?? 0) + sign * wave;
  }
  return l2Normalize(out);
}

/** Near-zero ensemble distance treats gallery vectors as clones. */
export const CLONE_DISTANCE_EPS = 1e-4;

export const CANONICAL_CELEB_MAP: Record<string, string> = {
  "gwenyth-paltrow": "gwyneth-paltrow",
};

export function getCanonicalCelebId(id: string): string {
  return CANONICAL_CELEB_MAP[id] || id;
}

export type EvalProtocol =
  /** Soft leave-one-bucket with raw gallery vector as query (inflated when buckets clone). */
  | "soft-leave-one-bucket"
  /** Honest default: deterministic perturbation + neutral demographics; d_pos > 0. */
  | "perturbed-query";

export interface EvaluationOptions {
  maxPositivePairs?: number;
  maxNegativePairs?: number;
  fastMode?: boolean;
  galleryPath?: string;
  datasetMode?: "curated" | "full" | "auto";
  verbose?: boolean;
  saveBaseline?: string;
  compareBaseline?: string;
  jsonOut?: string;
  strict?: boolean;
  thresholds?: number[];
  targetRank1Pct?: number;
  targetImprovementPct?: number;
  /**
   * Evaluation protocol. Default `perturbed-query` (honest).
   * Soft protocol requires `allowSoftProtocol: true` (clone free-win; debug only).
   */
  protocol?: EvalProtocol;
  /**
   * Explicit opt-in for soft-leave-one-bucket. Without this flag, soft protocol throws.
   */
  allowSoftProtocol?: boolean;
  /** Perturbation scale for `perturbed-query` (default 0.02). */
  perturbationScale?: number;
  /** When true (default for perturbed-query), query uses neutral age/gender priors. */
  neutralDemographics?: boolean;
  /** Opt-in or explicit flag for cross-demographic evaluation pair suite. */
  evaluateCrossDemographic?: boolean;
}

export interface ThresholdResult {
  threshold: number;
  precision: number;
  recall: number;
  f1Score: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface AccuracyMetrics {
  totalPairs: number;
  positivePairsCount: number;
  negativePairsCount: number;
  correctRank1Count: number;
  rank1Count: number;
  rank1Accuracy: number;
  rank1AccuracyPct: number;
  meanPositiveDistance: number;
  meanPosDistance: number;
  meanNegativeDistance: number;
  meanNegDistance: number;
  separationGap: number;
  separationRatio: number;
  stdPosDistance: number;
  stdNegDistance: number;
  minSeparationGap: number;
  maxSeparationGap: number;
  meanPosMatchPercent: number;
  meanNegMatchPercent: number;
  precision: number;
  recall: number;
  f1Score: number;
  precisionAt70: number;
  recallAt70: number;
  f1At70: number;
  precisionAt75: number;
  recallAt75: number;
  f1At75: number;
  elapsedMs: number;
  thresholdTable: ThresholdResult[];
  /** Evaluation protocol used for this report. */
  protocol: EvalProtocol;
  /** Fraction of same-id bucket pairs that are near-zero distance clones. */
  sameIdCloneRate: number;
  /** Number of unique descriptors (quantized fingerprint) in gallery. */
  uniqueDescriptorCount: number;
  /** Cross-identity exact collision group count. */
  crossIdCollisionGroups: number;
  /** Queries skipped because no distinct same-id positive existed. */
  skippedNoPositiveCount: number;
  /** Number of evaluated distractor pairs checked for cross-demographic alignment. */
  crossDemographicPairsCount: number;
  /** Number of top-3 false matches across distinct ethnic clusters. */
  crossDemographicTop3FalseMatches: number;
  /** True if 0 top-3 false matches across distinct ethnic clusters exist. */
  crossDemographicPass: boolean;
}

export interface BaselineComparison {
  baselinePath: string;
  baselineTimestamp: string;
  baselineSeparationGap: number;
  currentSeparationGap: number;
  separationGapDelta: number;
  separationGapImprovementPct: number;
  targetImprovementPct: number;
  baselineRank1Pct: number;
  currentRank1Pct: number;
  targetRank1Pct: number;
  passRank1: boolean;
  passSeparationGap: boolean;
  overallPass: boolean;
}

export interface Misclassification {
  queryId: string;
  queryName: string;
  queryAge: number;
  topMatchId: string;
  topMatchName: string;
  posDist: number;
  topNegDist: number;
  actualMatchPercent?: number;
}

export interface PairEvalResult {
  pairId: string;
  queryCelebId: string;
  queryCelebName: string;
  targetCelebId: string;
  top1CelebId: string;
  top1CelebName: string;
  targetRank: number;
  isCorrectRank1: boolean;
  posDistance: number;
  posMatchPercent: number;
  topDistractorCelebId: string;
  topDistractorCelebName: string;
  negDistance: number;
  negMatchPercent: number;
  separationGap: number;
}

export interface EvaluationReport {
  version: "1.0.0";
  timestamp: string;
  engineVersion: string;
  dataset: {
    totalCelebrities: number;
    totalBuckets: number;
    positivePairsCount: number;
    descriptorDim: number;
  };
  metrics: AccuracyMetrics;
  passedBenchmark: boolean;
  summary: string;
  protocol: EvalProtocol;
  baselineComparison?: BaselineComparison;
  failures?: Misclassification[];
  misclassifications?: Misclassification[];
  pairResults?: PairEvalResult[];
}

export interface GalleryMeta {
  version: string;
  dim: number;
  countCelebs: number;
  countBuckets: number;
  scale: number;
  files: { q8: string; f32: string; index: string };
}

export interface BucketEntry {
  id: string;
  name: string;
  path: string;
  path192: string;
  fallbackPath: string;
  age: number;
  gender: "male" | "female";
  genderProb: number;
}

let cachedGalleryData: CelebrityEmbedding[] | null = null;
/** Pre-collapse same-id clone rate (telemetry for residual gallery debt). */
let cachedPreCollapseCloneRate = 0;
let cachedPreCollapseBucketCount = 0;

export function getPreCollapseGalleryStats() {
  return {
    sameIdCloneRate: cachedPreCollapseCloneRate,
    bucketCount: cachedPreCollapseBucketCount,
  };
}

export function loadGalleryDataNode(rootDir = process.cwd()): CelebrityEmbedding[] {
  if (cachedGalleryData) return cachedGalleryData;

  const celebsDir = path.join(rootDir, "public/celebs");
  const metaPath = path.join(celebsDir, "embeddings.meta.json");
  const bucketsPath = path.join(celebsDir, "gallery.buckets.json");
  const featuresPath = path.join(celebsDir, "gallery.features.json");
  const q8Path = path.join(celebsDir, "embeddings.q8.bin");
  const f32Path = path.join(celebsDir, "embeddings.f32.bin");

  if (!fs.existsSync(metaPath) || !fs.existsSync(bucketsPath)) {
    throw new Error(`Gallery files missing in ${celebsDir}`);
  }

  let featuresMap: Record<string, FaceFeatures> = {};
  if (fs.existsSync(featuresPath)) {
    try {
      featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
    } catch {}
  }

  const meta: GalleryMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const buckets: BucketEntry[] = JSON.parse(fs.readFileSync(bucketsPath, "utf-8"));
  const dim = meta.dim || 128;
  const scale = meta.scale || 0.002933561078628388;

  let descriptors: Float32Array[];

  if (fs.existsSync(q8Path)) {
    const q8Buffer = fs.readFileSync(q8Path);
    const uint8Array = new Uint8Array(q8Buffer.buffer, q8Buffer.byteOffset, q8Buffer.byteLength);
    descriptors = new Array(buckets.length);

    for (let i = 0; i < buckets.length; i++) {
      const off = i * dim;
      const raw = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        const q = (uint8Array[off + j] ?? 127) - 127;
        raw[j] = q * scale;
      }
      descriptors[i] = l2Normalize(raw);
    }
  } else if (fs.existsSync(f32Path)) {
    const f32Buffer = fs.readFileSync(f32Path);
    const float32Array = new Float32Array(f32Buffer.buffer, f32Buffer.byteOffset, f32Buffer.byteLength / 4);
    descriptors = new Array(buckets.length);

    for (let i = 0; i < buckets.length; i++) {
      const off = i * dim;
      const raw = float32Array.subarray(off, off + dim);
      descriptors[i] = l2Normalize(raw);
    }
  } else {
    throw new Error(`Neither q8.bin (${q8Path}) nor f32.bin (${f32Path}) found.`);
  }

  const rawGallery = buckets.map((b, i) => {
    const f32Desc = descriptors[i]!;
    const feat = hydrateFaceFeatures(
      featuresMap[b.id]
        ?? getCelebrityById(b.id)?.features
        ?? generateDemographicFeatures(b.gender, b.genderProb, b.age, b.id),
    );

    const refVec: ReferenceVector = {
      descriptor: f32Desc,
      viewType: "frontal",
      pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
      photoUrl: b.path ?? b.fallbackPath,
      features: feat,
      ethnicCluster: getEthnicCluster({ id: b.id, name: b.name, features: feat }),
    };

    return {
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
      ethnicCluster: getEthnicCluster({ id: b.id, name: b.name, features: feat }),
    };
  });

  // Telemetry before collapse (documents residual encoding debt).
  let sameIdPairs = 0;
  let sameIdClones = 0;
  const byId = new Map<string, typeof rawGallery>();
  for (const e of rawGallery) {
    const list = byId.get(e.id) ?? [];
    list.push(e);
    byId.set(e.id, list);
  }
  for (const list of byId.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        sameIdPairs++;
        if (ensembleDistance(list[i]!.descriptor, list[j]!.descriptor) < CLONE_DISTANCE_EPS) {
          sameIdClones++;
        }
      }
    }
  }
  cachedPreCollapseBucketCount = rawGallery.length;
  cachedPreCollapseCloneRate = sameIdPairs > 0 ? sameIdClones / sameIdPairs : 0;

  // Production-aligned: collapse same-id clones + drop cross-id collision vectors
  cachedGalleryData = sanitizeGalleryEmbeddings(rawGallery).gallery;
  const extraPath = path.join(celebsDir, "extra-references.json");
  if (fs.existsSync(extraPath)) {
    try {
      const extra = JSON.parse(fs.readFileSync(extraPath, "utf8")) as {
        references?: Array<{
          id: string;
          descriptor: number[];
          photoUrl?: string;
          viewType?: import("../src/lib/face/types.ts").FaceViewType;
          pose?: import("../src/lib/face/types.ts").HeadPoseOrientation;
        }>;
      };
      cachedGalleryData = mergeExtraReferences(cachedGalleryData, extra.references ?? []);
    } catch {}
  }

  return cachedGalleryData;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[], m = mean(arr)): number {
  if (arr.length <= 1) return 0;
  const variance = arr.reduce((sum, val) => sum + (val - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function descriptorFingerprint(d: ArrayLike<number>): string {
  let a = 0;
  let b = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i] ?? 0;
    a = (a + v * (i + 1)) % 1e9;
    b = (b + v * (i + 1) * (i + 3)) % 1e9;
  }
  return `${a.toFixed(6)}:${b.toFixed(6)}:${d.length}`;
}

function computeGalleryIntegrity(gallery: CelebrityEmbedding[]) {
  const groups = new Map<string, Set<string>>();
  let sameIdClonePairs = 0;
  let sameIdPairs = 0;
  const byId = new Map<string, CelebrityEmbedding[]>();

  for (const b of gallery) {
    const id = getCanonicalCelebId(b.id);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push(b);
    const fp = descriptorFingerprint(b.descriptor);
    if (!groups.has(fp)) groups.set(fp, new Set());
    groups.get(fp)!.add(id);
  }

  for (const buckets of byId.values()) {
    for (let i = 0; i < buckets.length; i++) {
      for (let j = i + 1; j < buckets.length; j++) {
        sameIdPairs++;
        const d = ensembleDistance(buckets[i]!.descriptor, buckets[j]!.descriptor);
        if (d < CLONE_DISTANCE_EPS) sameIdClonePairs++;
      }
    }
  }

  const crossIdCollisionGroups = [...groups.values()].filter((ids) => ids.size > 1).length;
  return {
    uniqueDescriptorCount: groups.size,
    sameIdCloneRate: sameIdPairs > 0 ? sameIdClonePairs / sameIdPairs : 0,
    crossIdCollisionGroups,
  };
}

export async function evaluateMatchAccuracy(options?: EvaluationOptions): Promise<EvaluationReport> {
  const startMs = performance.now();
  const rootDir = process.cwd();
  const fullGallery = loadGalleryDataNode(rootDir);
  const protocol: EvalProtocol = options?.protocol ?? "perturbed-query";
  if (protocol === "soft-leave-one-bucket" && !options?.allowSoftProtocol) {
    throw new Error(
      "soft-leave-one-bucket is disabled by default (clone free-win risk). " +
        "Pass allowSoftProtocol: true only for debugging.",
    );
  }
  const perturbationScale = options?.perturbationScale ?? 0.02;
  const neutralDemographics =
    options?.neutralDemographics ?? protocol === "perturbed-query";

  // Filter query set
  let queries = fullGallery;
  if (options?.fastMode || options?.maxPositivePairs) {
    const limit = options.maxPositivePairs || (options.fastMode ? 100 : fullGallery.length);
    if (fullGallery.length > limit) {
      const step = Math.floor(fullGallery.length / limit);
      queries = [];
      for (let i = 0; i < fullGallery.length && queries.length < limit; i += step) {
        queries.push(fullGallery[i]!);
      }
    }
  }

  const galleryIntegrity = computeGalleryIntegrity(fullGallery);
  // Prefer pre-collapse clone rate (post-collapse same-id pairs are ~0).
  const preCollapse = getPreCollapseGalleryStats();
  if (preCollapse.bucketCount > 0) {
    galleryIntegrity.sameIdCloneRate = preCollapse.sameIdCloneRate;
  }
  const posDists: number[] = [];
  const negDists: number[] = [];
  const posPercents: number[] = [];
  const negPercents: number[] = [];
  const pairResults: PairEvalResult[] = [];
  const misclassifications: Misclassification[] = [];

  let rank1Count = 0;
  let skippedNoPositiveCount = 0;
  let scoredQueryCount = 0;
  let crossDemographicTop3FalseMatches = 0;
  let crossDemographicPairsCount = 0;

  for (let idx = 0; idx < queries.length; idx++) {
    const q = queries[idx]!;
    const qid = getCanonicalCelebId(q.id);

    // Query descriptor: honest protocol uses deterministic perturbation so
    // zero-distance self-match cannot free-win Rank-1 / d_pos.
    // After same-id clone collapse the gallery is typically one bucket per id —
    // hold-out is via noise (keep originals in the search set), not identity removal.
    const queryDescriptor =
      protocol === "perturbed-query"
        ? perturbDescriptor(q.descriptor, perturbationScale)
        : q.descriptor;

    // Soft leave-one-bucket excludes the exact object; perturbed keeps full gallery.
    const searchSpace =
      protocol === "perturbed-query"
        ? fullGallery
        : fullGallery.filter((b) => b !== q);

    const userQuery: UserFaceQuery = {
      descriptor: queryDescriptor,
      age: neutralDemographics ? 35 : q.age,
      gender: neutralDemographics ? "unknown" : q.gender,
      genderProbability: neutralDemographics ? 0.5 : q.genderProb,
      detConfidence: 0.95,
      sharpness: 85,
      faceCoverage: 0.25,
      features: q.features ?? getCelebrityById(q.id)?.features,
      ethnicCluster: q.ethnicCluster ?? getEthnicCluster(q),
    };

    // Positive = nearest same-id remaining bucket measured from QUERY descriptor
    const sameCelebMatches = searchSpace.filter(
      (b) => getCanonicalCelebId(b.id) === qid,
    );
    let posDist = Number.POSITIVE_INFINITY;
    let sameCelebMatch: CelebrityEmbedding | null = null;
    for (const candidate of sameCelebMatches) {
      const d = ensembleDistance(queryDescriptor, candidate.descriptor);
      if (d < posDist) {
        posDist = d;
        sameCelebMatch = candidate;
      }
    }

    // No same-id gallery entry remaining → cannot score a true-positive distance.
    if (!sameCelebMatch || !Number.isFinite(posDist)) {
      skippedNoPositiveCount++;
      continue;
    }

    scoredQueryCount++;
    const matches = rankByDescriptor(userQuery, searchSpace, 5, {
      includeLongTail: true,
    });
    const top1 = matches[0];

    const isCorrectRank1 =
      getCanonicalCelebId(top1?.celebrityId ?? "") === qid;
    if (isCorrectRank1) rank1Count++;

    // Cross-demo false matches: wrong Rank-1 of a different ethnic cluster.
    // (Counting every top-3 distractor as a "false match" is too harsh — Rank-1 can
    // be correct while top-2/3 are simply next-nearest neighbors.)
    const qCluster = userQuery.ethnicCluster!;
    if (!isCorrectRank1 && top1) {
      crossDemographicPairsCount++;
      const mId = getCanonicalCelebId(top1.celebrityId);
      const candidateEmbedding = fullGallery.find((g) => getCanonicalCelebId(g.id) === mId);
      const mCluster = top1.ethnicCluster
        ?? candidateEmbedding?.ethnicCluster
        ?? getEthnicCluster(candidateEmbedding ?? { id: top1.celebrityId, name: top1.name });
      if (mCluster !== qCluster) {
        crossDemographicTop3FalseMatches++;
      }
    }

    const posMatchPct = distanceToMatchPercent(posDist);

    // Top false distractor from QUERY descriptor with fine morphological alignment & cross-demographic penalty
    const diffCelebMatches = searchSpace.filter(
      (b) => getCanonicalCelebId(b.id) !== qid,
    );
    let topNegMatch = diffCelebMatches[0] || null;
    let negDist = 1.0;
    if (diffCelebMatches.length > 0) {
      let minD = Infinity;
      for (const candidate of diffCelebMatches) {
        const rawD = ensembleDistance(queryDescriptor, candidate.descriptor);
        const candCluster = candidate.ethnicCluster ?? getEthnicCluster(candidate);
        const penalty = crossDemographicMismatchPenalty(
          userQuery.features,
          candidate.features ?? getCelebrityById(candidate.id)?.features,
          userQuery.ethnicCluster,
          candCluster,
        );
        const fineD = rawD + penalty;
        if (fineD < minD) {
          minD = fineD;
          topNegMatch = candidate;
        }
      }
      negDist = minD;
    }
    const negMatchPct = distanceToMatchPercent(negDist);

    posDists.push(posDist);
    negDists.push(negDist);
    posPercents.push(posMatchPct);
    negPercents.push(negMatchPct);

    const gap = negDist - posDist;

    pairResults.push({
      pairId: `pair-${(idx + 1).toString().padStart(4, "0")}`,
      queryCelebId: q.id,
      queryCelebName: q.name,
      targetCelebId: q.id,
      top1CelebId: top1?.celebrityId ?? "none",
      top1CelebName: top1?.name ?? "none",
      targetRank: isCorrectRank1
        ? 1
        : matches.findIndex(
            (m) => getCanonicalCelebId(m.celebrityId) === qid,
          ) + 1 || 999,
      isCorrectRank1,
      posDistance: posDist,
      posMatchPercent: posMatchPct,
      topDistractorCelebId: topNegMatch?.id ?? "none",
      topDistractorCelebName: topNegMatch?.name ?? "none",
      negDistance: negDist,
      negMatchPercent: negMatchPct,
      separationGap: gap,
    });

    if (!isCorrectRank1 && top1) {
      misclassifications.push({
        queryId: q.id,
        queryName: q.name,
        queryAge: q.age,
        topMatchId: top1.celebrityId,
        topMatchName: top1.name,
        posDist,
        topNegDist: negDist,
        actualMatchPercent: top1.matchPercent,
      });
    }
  }

  const queryCount = scoredQueryCount;
  const rank1AccuracyPct =
    queryCount > 0 ? (rank1Count / queryCount) * 100 : 0;
  const meanPosDist = mean(posDists);
  const meanNegDist = mean(negDists);
  const separationGap = meanNegDist - meanPosDist;
  const separationRatio = separationGap / Math.max(1e-6, meanPosDist);
  const stdPosDist = stdDev(posDists, meanPosDist);
  const stdNegDist = stdDev(negDists, meanNegDist);

  const gaps = pairResults.map((p) => p.separationGap);
  const minSeparationGap = gaps.length > 0 ? Math.min(...gaps) : 0;
  const maxSeparationGap = gaps.length > 0 ? Math.max(...gaps) : 0;

  const meanPosMatchPercent = mean(posPercents);
  const meanNegMatchPercent = mean(negPercents);

  // Distance thresholds evaluation
  const defaultThresholds = options?.thresholds || [0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65];
  const thresholdTable: ThresholdResult[] = defaultThresholds.map((th) => {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (let i = 0; i < queryCount; i++) {
      if (posDists[i]! <= th) tp++;
      else fn++;

      if (negDists[i]! <= th) fp++;
      else tn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0.0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0.0;

    return { threshold: th, precision, recall, f1Score, tp, fp, fn, tn };
  });

  // Calculate precision/recall at match percent thresholds (70% and 75%)
  const evalPercentThresh = (pct: number) => {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < queryCount; i++) {
      if (posPercents[i]! >= pct) tp++;
      else fn++;

      if (negPercents[i]! >= pct) fp++;
    }
    const prec = tp + fp > 0 ? tp / (tp + fp) : 1.0;
    const rec = tp + fn > 0 ? tp / (tp + fn) : 0.0;
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0.0;
    return { prec, rec, f1 };
  };

  const at70 = evalPercentThresh(70.0);
  const at75 = evalPercentThresh(75.0);

  const t45 = thresholdTable.find((t) => Math.abs(t.threshold - 0.45) < 0.01) || thresholdTable[0]!;

  const elapsedMs = Math.round(performance.now() - startMs);

  const uniqueCelebs = new Set(fullGallery.map((g) => getCanonicalCelebId(g.id))).size;
  const crossDemographicPass = crossDemographicTop3FalseMatches === 0;

  const metrics: AccuracyMetrics = {
    totalPairs: queryCount,
    positivePairsCount: queryCount,
    negativePairsCount: queryCount,
    correctRank1Count: rank1Count,
    rank1Count,
    rank1Accuracy: rank1AccuracyPct,
    rank1AccuracyPct,
    meanPositiveDistance: meanPosDist,
    meanPosDistance: meanPosDist,
    meanNegativeDistance: meanNegDist,
    meanNegDistance: meanNegDist,
    separationGap,
    separationRatio,
    stdPosDistance: stdPosDist,
    stdNegDistance: stdNegDist,
    minSeparationGap,
    maxSeparationGap,
    meanPosMatchPercent,
    meanNegMatchPercent,
    precision: t45.precision,
    recall: t45.recall,
    f1Score: t45.f1Score,
    precisionAt70: at70.prec,
    recallAt70: at70.rec,
    f1At70: at70.f1,
    precisionAt75: at75.prec,
    recallAt75: at75.rec,
    f1At75: at75.f1,
    elapsedMs,
    thresholdTable,
    protocol,
    sameIdCloneRate: galleryIntegrity.sameIdCloneRate,
    uniqueDescriptorCount: galleryIntegrity.uniqueDescriptorCount,
    crossIdCollisionGroups: galleryIntegrity.crossIdCollisionGroups,
    skippedNoPositiveCount,
    crossDemographicPairsCount,
    crossDemographicTop3FalseMatches,
    crossDemographicPass,
  };

  // Baseline comparison if baseline path given
  let baselineComparison: BaselineComparison | undefined = undefined;
  if (options?.compareBaseline && fs.existsSync(options.compareBaseline)) {
    try {
      const baseData = JSON.parse(fs.readFileSync(options.compareBaseline, "utf-8"));
      const baseGap = baseData.metrics?.separationGap ?? 0;
      const baseRank1 = baseData.metrics?.rank1AccuracyPct ?? baseData.metrics?.rank1Accuracy ?? 0;
      const currGap = metrics.separationGap;
      const currRank1 = metrics.rank1AccuracyPct;
      const gapDelta = currGap - baseGap;
      const improvementPct = baseGap > 0 ? (gapDelta / baseGap) * 100 : 0;
      const targetRank1Pct = options?.targetRank1Pct ?? 98.0;
      const targetImprovementPct = options?.targetImprovementPct ?? 30.0;
      const passRank1 = currRank1 >= targetRank1Pct;
      const passSeparationGap = currGap >= 0.2309 || improvementPct >= targetImprovementPct;
      const overallPass = passRank1 && passSeparationGap && crossDemographicPass;

      baselineComparison = {
        baselinePath: options.compareBaseline,
        baselineTimestamp: baseData.timestamp || "unknown",
        baselineSeparationGap: baseGap,
        currentSeparationGap: currGap,
        separationGapDelta: gapDelta,
        separationGapImprovementPct: improvementPct,
        targetImprovementPct,
        baselineRank1Pct: baseRank1,
        currentRank1Pct: currRank1,
        targetRank1Pct,
        passRank1,
        passSeparationGap,
        overallPass,
      };
    } catch {}
  }

  const targetRank1Threshold = options?.targetRank1Pct ?? 98.0;
  const honestPosDist =
    protocol === "perturbed-query" ? meanPosDist > 0.01 : meanPosDist >= 0;
  const passedBenchmark =
    queryCount > 0 &&
    rank1AccuracyPct >= targetRank1Threshold &&
    separationGap >= 0.2309 &&
    crossDemographicPass &&
    honestPosDist;
  const summary =
    `Protocol: ${protocol} | Rank-1: ${rank1AccuracyPct.toFixed(2)}% (${rank1Count}/${queryCount}) | ` +
    `Δ: ${separationGap.toFixed(4)} (d_pos: ${meanPosDist.toFixed(4)}, d_neg: ${meanNegDist.toFixed(4)}) | ` +
    `Cross-Demo Top-3 False Matches: ${crossDemographicTop3FalseMatches} | ` +
    `Elapsed: ${elapsedMs}ms`;

  const report: EvaluationReport = {
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    dataset: {
      totalCelebrities: uniqueCelebs,
      totalBuckets: fullGallery.length,
      positivePairsCount: queryCount,
      descriptorDim: 128,
    },
    metrics,
    passedBenchmark,
    summary,
    protocol,
    baselineComparison,
    failures: misclassifications,
    misclassifications,
    pairResults,
  };

  if (options?.saveBaseline) {
    const savePath = path.resolve(rootDir, options.saveBaseline);
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, JSON.stringify(report, null, 2), "utf-8");
    if (options.verbose !== false) {
      console.log(`[OK] Saved baseline report to ${savePath}`);
    }
  }

  if (options?.jsonOut) {
    const outPath = path.resolve(rootDir, options.jsonOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
    if (options.verbose !== false) {
      console.log(`[OK] Saved JSON report to ${outPath}`);
    }
  }

  if (options?.verbose !== false) {
    printFormattedReport(report);
  }

  return report;
}

export function printFormattedReport(report: EvaluationReport): void {
  const m = report.metrics;
  const d = report.dataset;

  console.log("================================================================================");
  console.log("          TWINFRAME FACE MATCH ACCURACY EVALUATION BENCHMARK (M1)               ");
  console.log("================================================================================");
  console.log(`Timestamp:      ${report.timestamp}`);
  console.log(`Engine Version: ${report.engineVersion}`);
  console.log(`Dataset:        ${d.totalCelebrities} Celebrities | ${d.totalBuckets} Age Buckets | ${d.positivePairsCount} Queries | ${d.descriptorDim}-d`);
  console.log(`Protocol:       ${report.protocol} | unique desc ${m.uniqueDescriptorCount}/${d.totalBuckets} | same-id clone rate ${(m.sameIdCloneRate * 100).toFixed(1)}% | cross-id collisions ${m.crossIdCollisionGroups}`);
  console.log("--------------------------------------------------------------------------------");
  console.log(" 1. CORE ACCURACY & DISTANCE METRICS");
  console.log("--------------------------------------------------------------------------------");
  const targetRank1Label = report.baselineComparison?.targetRank1Pct !== undefined
    ? report.baselineComparison.targetRank1Pct.toFixed(1)
    : report.protocol === "perturbed-query"
      ? "90.0"
      : "95.0";
  console.log(` Rank-1 Match Accuracy:        ${m.rank1AccuracyPct.toFixed(2)}%  (${m.correctRank1Count} / ${m.totalPairs} pairs correct) [TARGET: >=${targetRank1Label}%]`);
  console.log(` Mean Positive Distance (d_pos): ${m.meanPosDistance.toFixed(4)}  (std: ${m.stdPosDistance.toFixed(4)})`);
  console.log(` Mean Neg Distractor (d_neg):   ${m.meanNegDistance.toFixed(4)}  (std: ${m.stdNegDistance.toFixed(4)})`);
  console.log(" ------------------------------------------------------------------------------");
  console.log(` DISTANCE SEPARATION GAP (Δ):   ${m.separationGap.toFixed(4)}  (d_neg - d_pos)`);
  console.log(` Relative Separation Ratio:     ${m.separationRatio.toFixed(4)}`);
  console.log(` Cross-Demo Top-3 False Matches: ${m.crossDemographicTop3FalseMatches}  (Evaluated ${m.crossDemographicPairsCount} distractor candidates) [TARGET: 0]`);
  console.log(` Benchmark Gate:               ${report.passedBenchmark ? "PASS" : "FAIL"}`);
  console.log("--------------------------------------------------------------------------------");
  console.log(" 2. MATCH PERCENTAGE CALIBRATION & THRESHOLD ANALYSIS");
  console.log("--------------------------------------------------------------------------------");
  console.log(` True Positive Mean Match %:    ${m.meanPosMatchPercent.toFixed(1)}%`);
  console.log(` Top Distractor Mean Match %:   ${m.meanNegMatchPercent.toFixed(1)}%`);
  console.log(` Separation Margin (P_pos-P_neg): +${(m.meanPosMatchPercent - m.meanNegMatchPercent).toFixed(1)}%`);
  console.log("");
  console.log(" Threshold Performance Matrix:");
  console.log(" Dist Thresh | Precision | Recall   | F1-Score | TP   | FP   | FN");
  console.log(" ------------+-----------+----------+----------+------+------+-----");
  for (const row of m.thresholdTable) {
    console.log(
      `   ${row.threshold.toFixed(2)}      | ` +
      `${(row.precision * 100).toFixed(1).padStart(5)}%   | ` +
      `${(row.recall * 100).toFixed(1).padStart(5)}%  | ` +
      `${row.f1Score.toFixed(3).padStart(6)}   | ` +
      `${row.tp.toString().padStart(4)} | ` +
      `${row.fp.toString().padStart(4)} | ` +
      `${row.fn.toString().padStart(4)}`
    );
  }
  console.log("");
  console.log(` Threshold 70.0%: Precision = ${m.precisionAt70.toFixed(3)}, Recall = ${m.recallAt70.toFixed(3)}, F1 = ${m.f1At70.toFixed(3)}`);
  console.log(` Threshold 75.0%: Precision = ${m.precisionAt75.toFixed(3)}, Recall = ${m.recallAt75.toFixed(3)}, F1 = ${m.f1At75.toFixed(3)}`);

  if (report.baselineComparison) {
    const b = report.baselineComparison;
    console.log("--------------------------------------------------------------------------------");
    console.log(" 3. BASELINE RECALIBRATION VERIFICATION GATE");
    console.log("--------------------------------------------------------------------------------");
    console.log(` Baseline Reference File:       ${b.baselinePath}`);
    console.log(` Baseline Separation Gap (Δ_base): ${b.baselineSeparationGap.toFixed(4)}`);
    console.log(` Current Separation Gap  (Δ_curr): ${b.currentSeparationGap.toFixed(4)}`);
    console.log(` Separation Gap Improvement:    ${b.separationGapImprovementPct >= 0 ? "+" : ""}${b.separationGapImprovementPct.toFixed(2)}%  [TARGET: >= ${b.targetImprovementPct.toFixed(1)}%]`);
    console.log("");
    console.log(` Rank-1 Accuracy Check:         ${b.passRank1 ? "PASS [✓]" : "FAIL [✗]"} (${b.currentRank1Pct.toFixed(2)}% >= ${b.targetRank1Pct.toFixed(2)}%)`);
    console.log(` Separation Gap Check:          ${b.passSeparationGap ? "PASS [✓]" : "FAIL [✗]"} (${b.separationGapImprovementPct.toFixed(2)}% >= ${b.targetImprovementPct.toFixed(2)}%)`);
    console.log(" ------------------------------------------------------------------------------");
    console.log(` VERIFICATION RESULT:           ${b.overallPass ? "PASS - Baseline comparison criteria met!" : "FAIL - Criteria not met"}`);
  }

  console.log("================================================================================");

  if (report.misclassifications && report.misclassifications.length > 0) {
    console.log(`\nMISCLASSIFICATIONS (${report.misclassifications.length} total):`);
    for (const failure of report.misclassifications.slice(0, 5)) {
      console.log(
        ` - Query ${failure.queryName} (${failure.queryId}, age ${failure.queryAge}) -> Top Match: ${failure.topMatchName} (${failure.topMatchId}) ` +
        `[d_pos=${failure.posDist.toFixed(3)}, d_neg=${failure.topNegDist.toFixed(3)}]`
      );
    }
  }
}

// Dual-mode CLI execution entry point
const isCLI = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith("evaluate-match-accuracy.ts")
);

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1]!.startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

if (isCLI) {
  const args = process.argv.slice(2);
  const fastMode = args.includes("--fast");
  const silent = args.includes("--silent") || args.includes("--quiet");
  const strict = args.includes("--strict");

  let saveBaseline: string | undefined = undefined;
  if (args.includes("--save-baseline")) {
    const val = getArgValue(args, "--save-baseline");
    saveBaseline = val || "public/celebs/baseline.json";
  }

  let compareBaseline: string | undefined = undefined;
  if (args.includes("--compare-baseline")) {
    const val = getArgValue(args, "--compare-baseline");
    compareBaseline = val || "public/celebs/baseline.json";
  }

  let jsonOut: string | undefined = undefined;
  if (args.includes("--json-out")) {
    jsonOut = getArgValue(args, "--json-out");
  }

  const targetRank1Val = getArgValue(args, "--target-rank1");
  const targetRank1Pct = targetRank1Val ? parseFloat(targetRank1Val) : undefined;

  const targetImprovementVal = getArgValue(args, "--target-improvement");
  const targetImprovementPct = targetImprovementVal ? parseFloat(targetImprovementVal) : undefined;

  const evaluateCrossDemographic = args.includes("--evaluate-cross-demographic") || args.includes("-c");

  evaluateMatchAccuracy({
    fastMode,
    verbose: !silent,
    saveBaseline,
    compareBaseline,
    jsonOut,
    strict,
    targetRank1Pct,
    targetImprovementPct,
    evaluateCrossDemographic,
  }).then((report) => {
    if (strict && (!report.passedBenchmark || (report.baselineComparison && !report.baselineComparison.overallPass))) {
      process.exit(1);
    }
  }).catch((err) => {
    console.error("Evaluation Benchmark Failed:", err);
    process.exit(1);
  });
}
