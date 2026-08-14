import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  computeMorphologicalDistance,
  ensureAnatomicalFeatures,
  extractAnatomicalFeatures,
  extractAnatomicalFeatures68,
  CANONICAL_ANATOMICAL_DEFAULTS,
} from "../src/lib/face/geometry.ts";
import {
  rankByDescriptor,
  MORPH_TIE_THRESHOLD_EPS,
  type UserFaceQuery,
} from "../src/lib/face/match.ts";
import { ensembleDistance, l2Normalize } from "../src/lib/face/embeddings.ts";
import { emptyFeatures } from "../src/lib/face/math.ts";
import type { CelebrityEmbedding, ExtendedAnatomicalFeatures, FaceFeatures } from "../src/lib/face/types.ts";

/** Helper to generate a normalized descriptor at a specific target distance from reference */
function vectorAtDistance(ref: Float32Array, targetD: number, seed: number): Float32Array {
  let lo = 1e-4;
  let hi = 1.5;
  let best = ref;
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const raw = new Float32Array(ref.length);
    for (let i = 0; i < ref.length; i++) {
      raw[i] = ref[i]! + Math.sin((i + 1) * seed) * mid;
    }
    const cand = l2Normalize(raw);
    const d = ensembleDistance(ref, cand);
    best = cand;
    if (d < targetD) lo = mid;
    else hi = mid;
  }
  return best;
}

const userAnat: ExtendedAnatomicalFeatures = {
  upperThirdRatio: 0.3333,
  middleThirdRatio: 0.3333,
  lowerThirdRatio: 0.3334,
  lateralFifthsRatios: [0.2, 0.2, 0.2, 0.2, 0.2],
  interCanthalDistance: 0.21,
  canthalTiltAngleDeg: 8.0,
  nasalIndex: 0.70,
  bigonialToBizygomaticRatio: 0.76,
  gonialJawlineAngleDeg: 135.0,
  lipVermilionHeightRatio: 0.625,
  philtrumDepth: 0.50,
};

const badAnat: ExtendedAnatomicalFeatures = {
  ...userAnat,
  canthalTiltAngleDeg: -10.0,
  gonialJawlineAngleDeg: 90.0,
  nasalIndex: 1.20,
};

console.log("=== STARTING ADVERSARIAL STRESS SUITE FOR M5_TieBreaking ===");

// -----------------------------------------------------------------------------
// Test Scenario 1: Boundary condition (|Δd| = 0.0149 vs |Δd| = 0.0151)
// -----------------------------------------------------------------------------
console.log("\n[Scenario 1] Testing exact boundary conditions around MORPH_TIE_THRESHOLD_EPS (0.015)...");

{
  const refDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.19 + 0.1)));
  
  // Test 1a: Delta = 0.0149 (SHOULD trigger tie-breaker)
  const descA_0149 = vectorAtDistance(refDesc, 0.1500, 1.23);
  const descB_0149 = vectorAtDistance(refDesc, 0.1500 + 0.0149, 2.45);
  const dA_0149 = ensembleDistance(refDesc, descA_0149);
  const dB_0149 = ensembleDistance(refDesc, descB_0149);
  const delta_0149 = Math.abs(dB_0149 - dA_0149);
  
  assert.ok(delta_0149 < MORPH_TIE_THRESHOLD_EPS, `Expected delta < 0.015, got ${delta_0149}`);

  const userQuery_0149: UserFaceQuery = {
    descriptor: refDesc,
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: userAnat },
  };

  const gallery_0149: CelebrityEmbedding[] = [
    {
      id: "cand-a-bad-morph",
      name: "Cand A",
      path: "/a.jpg",
      descriptor: Array.from(descA_0149),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: badAnat },
    },
    {
      id: "cand-b-good-morph",
      name: "Cand B",
      path: "/b.jpg",
      descriptor: Array.from(descB_0149),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: userAnat },
    },
  ];

  const matchResult_0149 = rankByDescriptor(userQuery_0149, gallery_0149, 2);
  assert.equal(matchResult_0149[0]!.celebrityId, "cand-b-good-morph", "At delta=0.0149, Cand B must win via tie-breaker");
  console.log(`  ✓ Delta = ${delta_0149.toFixed(6)} (< 0.015): Tie-breaker ACTIVATED as expected (Winner: ${matchResult_0149[0]!.celebrityId})`);

  // Test 1b: Delta = 0.0151 (should NOT trigger tie-breaker)
  const descA_0151 = vectorAtDistance(refDesc, 0.1500, 1.23);
  const descB_0151 = vectorAtDistance(refDesc, 0.1500 + 0.0151, 3.67);
  const dA_0151 = ensembleDistance(refDesc, descA_0151);
  const dB_0151 = ensembleDistance(refDesc, descB_0151);
  const delta_0151 = Math.abs(dB_0151 - dA_0151);

  assert.ok(delta_0151 >= MORPH_TIE_THRESHOLD_EPS, `Expected delta >= 0.015, got ${delta_0151}`);

  const userQuery_0151: UserFaceQuery = {
    descriptor: refDesc,
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: userAnat },
  };

  const gallery_0151: CelebrityEmbedding[] = [
    {
      id: "cand-a-bad-morph",
      name: "Cand A",
      path: "/a.jpg",
      descriptor: Array.from(descA_0151),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: badAnat },
    },
    {
      id: "cand-b-good-morph",
      name: "Cand B",
      path: "/b.jpg",
      descriptor: Array.from(descB_0151),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: userAnat },
    },
  ];

  const matchResult_0151 = rankByDescriptor(userQuery_0151, gallery_0151, 2);
  assert.equal(matchResult_0151[0]!.celebrityId, "cand-a-bad-morph", "At delta=0.0151, Cand A must remain #1 (deep distance wins)");
  console.log(`  ✓ Delta = ${delta_0151.toFixed(6)} (>= 0.015): Tie-breaker NOT activated as expected (Winner: ${matchResult_0151[0]!.celebrityId})`);
}

// -----------------------------------------------------------------------------
// Test Scenario 2: Edge Cases & Robustness
// -----------------------------------------------------------------------------
console.log("\n[Scenario 2] Testing Edge Cases & Robustness (null/undefined, missing, degenerate, NaN)...");

{
  console.log("Checking computeMorphologicalDistance outputs:");
  console.log("  (null, null) ->", computeMorphologicalDistance(null, null));
  console.log("  (undefined, undefined) ->", computeMorphologicalDistance(undefined, undefined));
  console.log("  (null, userAnat) ->", computeMorphologicalDistance(null, userAnat));
  console.log("  (userAnat, null) ->", computeMorphologicalDistance(userAnat, null));
  console.log("  ({}, userAnat) ->", computeMorphologicalDistance({}, userAnat));
  console.log("  (userAnat, {}) ->", computeMorphologicalDistance(userAnat, {}));
  console.log("  ({}, {}) ->", computeMorphologicalDistance({}, {}));

  // 2a. Missing anatomical features / null / undefined inputs assertions
  assert.equal(computeMorphologicalDistance(null, null), 0.50, "Null inputs must return 0.50");
  assert.equal(computeMorphologicalDistance(undefined, undefined), 0.50, "Undefined inputs must return 0.50");
  assert.equal(computeMorphologicalDistance(userAnat, null), 0.50, "One-sided null must return 0.50");
  assert.equal(computeMorphologicalDistance(null, userAnat), 0.50, "One-sided null must return 0.50");

  // 2b. ensureAnatomicalFeatures fallback
  const derivedFromNull = ensureAnatomicalFeatures(null);
  assert.deepEqual(derivedFromNull, CANONICAL_ANATOMICAL_DEFAULTS, "ensureAnatomicalFeatures(null) must return CANONICAL_ANATOMICAL_DEFAULTS");
  const derivedFromEmpty = ensureAnatomicalFeatures({} as FaceFeatures);
  assert.ok(Number.isFinite(derivedFromEmpty.upperThirdRatio), "Derived features must be valid finite numbers");
  console.log("  ✓ ensureAnatomicalFeatures handles null, undefined, and empty objects gracefully");

  // 2c. Degenerate landmarks (empty array, coincident points, extreme values)
  const anatEmptyLms = extractAnatomicalFeatures([]);
  assert.deepEqual(anatEmptyLms, CANONICAL_ANATOMICAL_DEFAULTS, "Empty landmarks array must return default canonical features");
  
  const anatEmptyLms68 = extractAnatomicalFeatures68([]);
  assert.deepEqual(anatEmptyLms68, CANONICAL_ANATOMICAL_DEFAULTS, "Empty 68-landmarks array must return default canonical features");

  const coincidentLms = Array.from({ length: 68 }, () => ({ x: 0, y: 0, z: 0 }));
  const anatCoincident = extractAnatomicalFeatures68(coincidentLms);
  assert.ok(Number.isFinite(anatCoincident.upperThirdRatio), "Coincident landmarks must produce finite ratios without division-by-zero crash");
  assert.ok(Number.isFinite(anatCoincident.gonialJawlineAngleDeg), "Coincident landmarks must produce finite angles");

  const extremeLms = Array.from({ length: 68 }, (_, i) => ({
    x: i % 2 === 0 ? 1e10 : -1e10,
    y: i % 3 === 0 ? 1e10 : -1e10,
    z: 1e8,
  }));
  const anatExtreme = extractAnatomicalFeatures68(extremeLms);
  assert.ok(Number.isFinite(anatExtreme.canthalTiltAngleDeg), "Extreme coordinate values must produce finite clamped outputs");
  console.log("  ✓ Degenerate landmarks (coincident, empty, extreme) produce finite clamped results");

  // 2d. NaN / Infinity propagation checks
  const nanAnat: ExtendedAnatomicalFeatures = {
    upperThirdRatio: NaN,
    middleThirdRatio: Infinity,
    lowerThirdRatio: -Infinity,
    lateralFifthsRatios: [NaN, NaN, NaN, NaN, NaN],
    interCanthalDistance: NaN,
    canthalTiltAngleDeg: NaN,
    nasalIndex: NaN,
    bigonialToBizygomaticRatio: NaN,
    gonialJawlineAngleDeg: NaN,
    lipVermilionHeightRatio: NaN,
    philtrumDepth: NaN,
  };

  const dMorphNaN = computeMorphologicalDistance(nanAnat, userAnat);
  assert.equal(dMorphNaN, 0.50, "NaN/Infinity anatomical features must fallback to 0.50");
  assert.ok(Number.isFinite(dMorphNaN), "dMorph must never be NaN");

  const refDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => i + 1));
  const nanQuery: UserFaceQuery = {
    descriptor: refDesc,
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: nanAnat },
  };

  const nanGallery: CelebrityEmbedding[] = [
    {
      id: "celeb-nan",
      name: "Celeb NaN",
      path: "/nan.jpg",
      descriptor: Array.from(refDesc),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: nanAnat },
    },
  ];

  const rankNaNResult = rankByDescriptor(nanQuery, nanGallery, 1);
  assert.equal(rankNaNResult.length, 1, "Rank execution with NaN features must complete successfully");
  assert.ok(Number.isFinite(rankNaNResult[0]!.distance), "Distance must be finite even with NaN features");
  console.log("  ✓ NaN / Infinity inputs do not crash or propagate NaN into final scores");
}

// -----------------------------------------------------------------------------
// Test Scenario 3: Performance SLA Benchmark (1000 executions over 50 candidates)
// -----------------------------------------------------------------------------
console.log("\n[Scenario 3] Benchmarking Performance SLA (1000 match executions over 50 candidates)...");

{
  const refDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.05)));

  const mock50Gallery: CelebrityEmbedding[] = Array.from({ length: 50 }, (_, i) => ({
    id: `celeb-${i}`,
    name: `Celeb ${i}`,
    path: `/celeb-${i}.jpg`,
    descriptor: Array.from(l2Normalize(Float32Array.from({ length: 128 }, (_, j) => Math.sin(j * 0.05) + (i % 5) * 0.01))),
    age: 20 + (i % 40),
    gender: i % 2 === 0 ? "male" : "female",
    genderProb: 0.95,
    features: {
      ...emptyFeatures(),
      anatomical: {
        ...userAnat,
        canthalTiltAngleDeg: 4.0 + (i % 7),
        gonialJawlineAngleDeg: 124.0 + (i % 11),
        nasalIndex: 0.70 + (i % 3) * 0.05,
      },
    },
  }));

  const userQuery: UserFaceQuery = {
    descriptor: refDesc,
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: userAnat },
  };

  // Warmup JIT
  for (let i = 0; i < 50; i++) {
    rankByDescriptor(userQuery, mock50Gallery, 5);
  }

  const iterations = 1000;
  const startTime = performance.now();
  for (let i = 0; i < iterations; i++) {
    rankByDescriptor(userQuery, mock50Gallery, 5);
  }
  const endTime = performance.now();
  const totalMs = endTime - startTime;
  const avgMsPerCall = totalMs / iterations;

  console.log(`  ✓ 1000 executions total time: ${totalMs.toFixed(2)} ms`);
  console.log(`  ✓ Average latency overhead per match call: ${avgMsPerCall.toFixed(4)} ms/call (SLA threshold: < 1.0 ms)`);

  assert.ok(avgMsPerCall < 1.0, `Performance SLA violation: ${avgMsPerCall.toFixed(4)} ms/call exceeds 1.0 ms ceiling`);
}

console.log("\n=== ALL ADVERSARIAL STRESS SCENARIOS PASSED SUCCESSFULLY ===");
