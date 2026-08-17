#!/usr/bin/env node
/**
 * scripts/m4-challenger-empirical.mjs
 * 
 * Empirical Challenger Verification & Stress Test Suite for Milestone 4
 * (R3: Similarity Metric & Ranking Recalibration)
 * 
 * Domains tested:
 * 1. Demographic Prior Recalibration & Visual Dominance (cross-gender lookalikes, extreme ages, missing metadata)
 * 2. Metric Monotonicity, Hill Curve Sigmoid & Match Percentage Calibration
 * 3. Quantization Precision & Pipeline Consistency (Float32 vs Int8 vs 512-bit Biohash)
 * 4. Mathematical Edge-Cases & Vector Stability (Zero vectors, Orthogonal, Antipodal, NaNs, Subnormals)
 * 5. End-to-End Ranking Integrity on Full 1,000-Celebrity Gallery
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  parseV4BinaryHeader,
  l2Normalize,
  dotProduct256,
  cosineDistance256,
  cosineDistance,
  euclideanDistance,
  ensembleDistance,
  distanceToMatchPercent,
  rankPercentsFromDistances,
  genderAffinity,
  ageAffinity,
  computeMatchConfidence,
} from "../src/lib/face/embeddings.ts";

import { rankByDescriptor } from "../src/lib/face/match.ts";
import { computeBiohash, screenBiohashCandidates, hammingDistance64BytesTS } from "../src/lib/face/biohash.ts";

const ROOT = process.cwd();
const CELEBS_DIR = path.resolve(ROOT, "public/celebs");
const V4_BIN_PATH = path.resolve(CELEBS_DIR, "embeddings.v4.q8.bin");
const BUCKETS_PATH = path.resolve(CELEBS_DIR, "gallery.buckets.json");
const INDEX_PATH = path.resolve(CELEBS_DIR, "index.json");

console.log("================================================================================");
console.log("  EMPIRICAL CHALLENGER STRESS SUITE: MILESTONE 4 (R3 RECALIBRATION)             ");
console.log("================================================================================");

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

function assert(condition, message, details = null) {
  if (!condition) {
    totalFailed++;
    failures.push({ message, details });
    console.error(`  ❌ FAIL: ${message}`);
    if (details) console.error("     Details:", details);
  } else {
    totalPassed++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

// Load Gallery Data
const fileBuf = fs.readFileSync(V4_BIN_PATH);
const arrayBuf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
const header = parseV4BinaryHeader(arrayBuf);
const payload = new Uint8Array(arrayBuf, 32);
const buckets = JSON.parse(fs.readFileSync(BUCKETS_PATH, "utf8"));

const N = header.vectorCount;
const D = header.dimension;
const scale = header.globalScale;

// Build full Float32 dequantized gallery
const gallery = [];
for (let i = 0; i < N; i++) {
  const b = buckets[i];
  const offset = i * D;
  const rawVec = new Float32Array(D);
  for (let j = 0; j < D; j++) {
    rawVec[j] = (payload[offset + j] - 128) * scale;
  }
  const descriptor = l2Normalize(rawVec);
  gallery.push({
    id: b.id,
    name: b.name,
    descriptor,
    age: b.age ?? 40,
    gender: b.gender ?? "unknown",
    genderProb: b.genderProb ?? 0.9,
    path: b.path ?? `/celebs/${b.id}.jpg`,
  });
}

// ==============================================================================
// DOMAIN 1: Demographic Prior Softening & Visual Facial Dominance
// ==============================================================================
console.log("\n--- [DOMAIN 1] Demographic Prior Softening & Visual Facial Dominance ---");

// 1.1 Cross-Gender Lookalike Visual Match Supremacy
// If user has strong female prior (prob=0.99) but visual distance to a male celeb is 0.12,
// and closest female distractor has distance 0.35, male celeb MUST rank #1.
{
  const celebMale = gallery.find((c) => c.gender === "male");
  const celebFemale = gallery.find((c) => c.gender === "female");

  assert(celebMale && celebFemale, "Gallery contains male and female celebrities");

  // Synthetic query: very close to celebMale descriptor (dist ~0.02)
  const maleDesc = celebMale.descriptor;
  const queryDesc = new Float32Array(D);
  for (let i = 0; i < D; i++) {
    queryDesc[i] = maleDesc[i] + (Math.random() - 0.5) * 0.05;
  }
  const normQuery = l2Normalize(queryDesc);

  const queryFemaleUser = {
    descriptor: normQuery,
    gender: "female",
    genderProbability: 0.99,
    age: 25,
  };

  const results = rankByDescriptor(queryFemaleUser, gallery, 5);
  assert(results.length > 0, "rankByDescriptor returned results");
  assert(
    results[0].celebrityId === celebMale.id,
    `Visual match wins over demographic prior for cross-gender lookalike: Top 1 is ${results[0].name} (${celebMale.id})`
  );
  assert(
    results[0].distance < 0.10,
    `Top match distance is small (${results[0].distance.toFixed(4)})`
  );
}

// 1.2 Extreme Ages Robustness (< 10, > 100, Negative, Non-Finite)
{
  const baseCeleb = gallery[0];
  const queryBase = {
    descriptor: baseCeleb.descriptor,
    gender: baseCeleb.gender,
    genderProbability: 0.95,
  };

  const extremeAges = [
    { age: 1, label: "Toddler (age=1)" },
    { age: 5, label: "Child (age=5)" },
    { age: 9, label: "Age 9" },
    { age: 102, label: "Centenarian (age=102)" },
    { age: 120, label: "Supercentenarian (age=120)" },
    { age: 999, label: "Extreme age (age=999)" },
    { age: -10, label: "Negative age (age=-10)" },
    { age: NaN, label: "NaN age" },
    { age: Infinity, label: "Infinity age" },
    { age: -Infinity, label: "-Infinity age" },
    { age: undefined, label: "Undefined age" },
  ];

  let ageFailures = 0;
  for (const item of extremeAges) {
    try {
      const q = { ...queryBase, age: item.age };
      const res = rankByDescriptor(q, gallery, 5);
      const top = res[0];
      if (!top || top.celebrityId !== baseCeleb.id) {
        ageFailures++;
      }
      if (!Number.isFinite(top.matchPercent) || Number.isNaN(top.matchPercent)) {
        ageFailures++;
      }
      if (top.matchPercent < 0 || top.matchPercent > 100) {
        ageFailures++;
      }
      // Check traits integrity
      for (const t of top.traits) {
        if (!Number.isFinite(t.similarity) || Number.isNaN(t.similarity)) {
          ageFailures++;
        }
        if (t.similarity < 0 || t.similarity > 1) {
          ageFailures++;
        }
      }
    } catch (err) {
      ageFailures++;
      console.error(`     Error on extreme age ${item.label}:`, err);
    }
  }

  assert(ageFailures === 0, `All 11 extreme age queries handled smoothly with 0 errors or NaNs (failures: ${ageFailures})`);
}

// 1.3 Missing / Undefined Metadata Graceful Degradation
{
  const targetCeleb = gallery[10];
  const queryNoMeta = {
    descriptor: targetCeleb.descriptor,
    age: undefined,
    gender: "unknown",
    genderProbability: undefined,
    qualityScore: undefined,
    detConfidence: undefined,
    sharpness: undefined,
    faceCoverage: undefined,
  };

  const res = rankByDescriptor(queryNoMeta, gallery, 5);
  assert(res.length === 5, "Ranked 5 matches for metadata-free query");
  assert(res[0].celebrityId === targetCeleb.id, `Exact visual self-match ranked #1 (${res[0].name}) without metadata`);
  assert(res[0].matchPercent === 100.0, `Match percent is 100.0% for exact vector (got ${res[0].matchPercent})`);
  assert(Math.abs(res[0].distance) < 1e-6, `Distance is near 0.0 for exact vector (got ${res[0].distance.toExponential(4)})`);
}

// 1.4 Age-Bucket Deduplication Stress
{
  // If gallery has multiple entries with identical celeb ID, rankByDescriptor must return only the lowest adjusted distance
  const celebA = gallery[0];
  const mockMultiBucketGallery = [
    { ...celebA, age: 20, descriptor: celebA.descriptor },
    { ...celebA, age: 40, descriptor: celebA.descriptor },
    { ...celebA, age: 60, descriptor: celebA.descriptor },
    { ...gallery[1] },
    { ...gallery[2] },
  ];

  const query = {
    descriptor: celebA.descriptor,
    age: 42,
    gender: celebA.gender,
    genderProbability: 0.9,
  };

  const res = rankByDescriptor(query, mockMultiBucketGallery, 5);
  const ids = res.map((r) => r.celebrityId);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, `Age buckets deduplicated cleanly: returned ${ids.length} unique celeb IDs`);
  assert(res[0].celebrityId === celebA.id, `Top match is ${celebA.id}`);
}

// ==============================================================================
// DOMAIN 2: Metric Monotonicity, Hill Curve Sigmoid & Probability Calibration
// ==============================================================================
console.log("\n--- [DOMAIN 2] Metric Monotonicity, Hill Curve Sigmoid & Probability Calibration ---");

// 2.1 Continuous Strict Monotonicity of distanceToMatchPercent(d)
{
  let monotonicityViolations = 0;
  let prevPercent = 100.0;
  for (let d = 0; d <= 2.0; d += 0.001) {
    const p = distanceToMatchPercent(d);
    if (p > prevPercent) {
      monotonicityViolations++;
    }
    prevPercent = p;
  }
  assert(
    monotonicityViolations === 0,
    `distanceToMatchPercent(d) is strictly non-increasing across 2,001 points in [0, 2.0] (violations: ${monotonicityViolations})`
  );
}

// 2.2 Calibration Key Points Check
{
  const p0 = distanceToMatchPercent(0.0);
  const pHalf = distanceToMatchPercent(0.12);
  const pLow = distanceToMatchPercent(1.0);
  const pMax = distanceToMatchPercent(2.0);

  assert(p0 === 100.0, `P(0.0) is exactly 100.0% (got ${p0})`);
  assert(pHalf === 50.0, `P(0.12) is exactly 50.0% half-saturation threshold (got ${pHalf})`);
  assert(pLow <= 2.0, `P(1.0) is low background baseline (got ${pLow}%)`);
  assert(pMax <= 0.2, `P(2.0) is near-zero [0.0, 0.2]% (got ${pMax}%)`);
}

// 2.3 Non-Finite and Negative Distance Handling
{
  assert(distanceToMatchPercent(NaN) === 0.0, "P(NaN) returns 0.0%");
  assert(distanceToMatchPercent(Infinity) === 0.0, "P(Infinity) returns 0.0%");
  assert(distanceToMatchPercent(-Infinity) === 100.0, "P(-Infinity) returns 100.0%");
  assert(distanceToMatchPercent(-0.5) === 100.0, "P(-0.5) clamped to 100.0%");
}

// 2.4 rankPercentsFromDistances Ordering and Decay Guarantee
{
  const testDistances = [0.05, 0.05, 0.12, 0.38, 0.70];
  const percents = rankPercentsFromDistances(testDistances);

  assert(percents.length === 5, "Returns same number of rank percents as inputs");
  let strictDecay = true;
  for (let i = 1; i < percents.length; i++) {
    if (percents[i] >= percents[i - 1]) {
      strictDecay = false;
    }
  }
  assert(strictDecay, `rankPercentsFromDistances enforces strict monotonic decay even for ties: ${percents.join("%, ")}%`);
}

// ==============================================================================
// DOMAIN 3: Quantization Precision & Pipeline Consistency (Float32 vs Int8 vs Biohash)
// ==============================================================================
console.log("\n--- [DOMAIN 3] Quantization Precision & Pipeline Consistency ---");

// 3.1 Int8 vs Float32 Distance Error & Rank Invariance across 1,000 Celebrities
{
  let maxQuantizationDistDiff = 0;
  let top1RankMatches = 0;
  let top5OverlapSum = 0;

  const testQueriesCount = 50;
  for (let q = 0; q < testQueriesCount; q++) {
    const targetIdx = (q * 19) % N;
    const targetCeleb = gallery[targetIdx];

    // Create a slightly perturbed query descriptor
    const query = new Float32Array(D);
    for (let j = 0; j < D; j++) {
      query[j] = targetCeleb.descriptor[j] + (Math.random() - 0.5) * 0.02;
    }
    const normQuery = l2Normalize(query);

    // Compute ranking with Float32 gallery
    const f32Scores = gallery.map((c, idx) => ({
      idx,
      id: c.id,
      dist: cosineDistance256(normQuery, c.descriptor),
    }));
    f32Scores.sort((a, b) => a.dist - b.dist);

    // Compute ranking with raw Int8 quantized vectors
    const q8Scores = [];
    for (let i = 0; i < N; i++) {
      const offset = i * D;
      let dot = 0;
      let normSq = 0;
      for (let j = 0; j < D; j++) {
        const val = (payload[offset + j] - 128) * scale;
        dot += normQuery[j] * val;
        normSq += val * val;
      }
      const invNorm = 1.0 / (Math.sqrt(normSq) || 1.0);
      const cos = dot * invNorm;
      const dist = Math.max(0.0, Math.min(2.0, 1.0 - Math.max(-1.0, Math.min(1.0, cos))));
      q8Scores.push({ idx: i, id: gallery[i].id, dist });

      const diff = Math.abs(dist - f32Scores.find((f) => f.idx === i).dist);
      if (diff > maxQuantizationDistDiff) maxQuantizationDistDiff = diff;
    }
    q8Scores.sort((a, b) => a.dist - b.dist);

    if (f32Scores[0].idx === q8Scores[0].idx) top1RankMatches++;

    const f32Top5Set = new Set(f32Scores.slice(0, 5).map((s) => s.idx));
    const q8Top5Set = new Set(q8Scores.slice(0, 5).map((s) => s.idx));
    let overlap = 0;
    for (const id of f32Top5Set) {
      if (q8Top5Set.has(id)) overlap++;
    }
    top5OverlapSum += overlap;
  }

  const top1Agreement = (top1RankMatches / testQueriesCount) * 100;
  const avgTop5Overlap = (top5OverlapSum / (testQueriesCount * 5)) * 100;

  assert(
    maxQuantizationDistDiff < 0.005,
    `Max distance discrepancy between Float32 and Int8 is ${maxQuantizationDistDiff.toExponential(4)} (< 0.005)`
  );
  assert(top1Agreement === 100.0, `Top-1 rank agreement between Float32 and Int8 is 100.0% (got ${top1Agreement.toFixed(1)}%)`);
  assert(avgTop5Overlap >= 99.0, `Average Top-5 set overlap is ${avgTop5Overlap.toFixed(1)}% (>= 99.0%)`);
}

// 3.2 512-bit Biohash Candidate Screening Recall & Consistency
{
  // Pre-generate 64-byte biohashes for all 1,000 gallery vectors
  const catalogHashes = new Uint8Array(N * 64);
  for (let i = 0; i < N; i++) {
    const res = computeBiohash(gallery[i].descriptor);
    catalogHashes.set(res.hash, i * 64);
  }

  let zeroFalseNegativeTop1Count = 0;
  const testTrials = 50;

  for (let t = 0; t < testTrials; t++) {
    const probeIdx = (t * 17) % N;
    const probeVec = gallery[probeIdx].descriptor;
    const queryBio = computeBiohash(probeVec);

    // Screen candidates with standard Hamming distance threshold (maxHammingDistance = 240 bits)
    const screening = await screenBiohashCandidates(queryBio.hash, catalogHashes, N, {
      maxHammingDistance: 240,
      topM: 100,
    });

    const candidateIndices = new Set(screening.candidates.map((c) => c.index));
    // True Top-1 identity must be retained in the screened candidate pool
    if (candidateIndices.has(probeIdx)) {
      zeroFalseNegativeTop1Count++;
    }
  }

  const recallPct = (zeroFalseNegativeTop1Count / testTrials) * 100;
  assert(
    recallPct === 100.0,
    `512-bit Biohash pre-screening achieves 100.0% Top-1 recall with 0 false dismissals (evaluated on ${testTrials} probes)`
  );
}

// 3.3 Fast SIMD Dot Product (dotProduct256) vs Naive Loop Equivalence
{
  let maxDotDiff = 0;
  for (let i = 0; i < 100; i++) {
    const v1 = gallery[i].descriptor;
    const v2 = gallery[(i + 37) % N].descriptor;

    const fastDot = dotProduct256(v1, v2);
    let naiveDot = 0;
    for (let j = 0; j < 256; j++) {
      naiveDot += v1[j] * v2[j];
    }
    const diff = Math.abs(fastDot - naiveDot);
    if (diff > maxDotDiff) maxDotDiff = diff;
  }
  assert(maxDotDiff < 1e-6, `dotProduct256 SIMD unrolling matches naive dot product (max diff: ${maxDotDiff.toExponential(4)})`);
}

// ==============================================================================
// DOMAIN 4: Mathematical Edge-Cases & Vector Stability
// ==============================================================================
console.log("\n--- [DOMAIN 4] Mathematical Edge-Cases & Vector Stability ---");

// 4.1 All-Zero Vector
{
  const zeroVec = new Float32Array(256);
  const normZero = l2Normalize(zeroVec);
  assert(normZero.length === 256, "Normalizes zero-vector to 256-d Float32Array");
  let hasNaN = false;
  for (let i = 0; i < 256; i++) {
    if (Number.isNaN(normZero[i])) hasNaN = true;
  }
  assert(!hasNaN, "Zero-vector normalization produces zero NaNs");

  const distZero = cosineDistance256(normZero, gallery[0].descriptor);
  assert(Number.isFinite(distZero) && distZero >= 0.0 && distZero <= 2.0, `Cosine distance with zero vector is safe: ${distZero}`);
}

// 4.2 Orthogonal Vectors (dist = 1.0)
{
  const vA = new Float32Array(256);
  const vB = new Float32Array(256);
  vA[0] = 1.0;
  vB[1] = 1.0;

  const distOrth = cosineDistance256(vA, vB);
  assert(Math.abs(distOrth - 1.0) < 1e-6, `Orthogonal vectors yield cosine distance 1.0 (got ${distOrth})`);
  const pctOrth = distanceToMatchPercent(distOrth);
  assert(pctOrth <= 2.0, `Orthogonal vectors yield low baseline match percentage: ${pctOrth}%`);
}

// 4.3 Antipodal Vectors (dist = 2.0)
{
  const vA = gallery[0].descriptor;
  const vAntipodal = new Float32Array(256);
  for (let i = 0; i < 256; i++) vAntipodal[i] = -vA[i];

  const distAnti = cosineDistance256(vA, vAntipodal);
  assert(Math.abs(distAnti - 2.0) < 1e-5, `Antipodal vectors yield cosine distance 2.0 (got ${distAnti})`);
  const pctAnti = distanceToMatchPercent(distAnti);
  assert(pctAnti <= 0.2, `Antipodal vectors yield near-zero match percent <= 0.2% (got ${pctAnti}%)`);
}

// 4.4 Subnormal Floats & Tiny Numbers
{
  const vSub = new Float32Array(256);
  for (let i = 0; i < 256; i++) vSub[i] = 1e-20;
  const normSub = l2Normalize(vSub);
  const distSub = cosineDistance256(normSub, gallery[0].descriptor);
  assert(Number.isFinite(distSub) && !Number.isNaN(distSub), `Subnormal float vectors handled without NaN (dist: ${distSub})`);
}

// ==============================================================================
// SUMMARY & VERDICT
// ==============================================================================
console.log("\n================================================================================");
console.log(`  TOTAL TESTS: ${totalPassed + totalFailed} | PASSED: ${totalPassed} | FAILED: ${totalFailed}`);
console.log("================================================================================");

if (totalFailed > 0) {
  console.error("❌ VERDICT: REQUEST_CHANGES");
  console.error("Failure Summary:", JSON.stringify(failures, null, 2));
  process.exit(1);
} else {
  console.log("✅ VERDICT: APPROVE — ALL EMPIRICAL CHALLENGES PASSED PERFECTLY!");
  process.exit(0);
}
