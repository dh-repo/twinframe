import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  rankByDescriptor,
  rankCandidatesTwoStage,
  computeMorphologicalDistance,
  MORPH_TIE_THRESHOLD_EPS,
  type UserFaceQuery,
} from "../src/lib/face/match.ts";
import {
  extractAnatomicalFeatures,
  extractAnatomicalFeatures68,
  ensureAnatomicalFeatures,
} from "../src/lib/face/geometry.ts";
import { ensembleDistance, l2Normalize, type CelebrityEmbedding } from "../src/lib/face/embeddings.ts";
import { emptyFeatures } from "../src/lib/face/math.ts";
import type { ExtendedAnatomicalFeatures, FaceFeatures } from "../src/lib/face/types.ts";

console.log("=================================================");
console.log("STRESS-TEST SUITE: Milestone M5_TieBreaking (R5)");
console.log("=================================================\n");

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err?.message ?? err}`);
    failed++;
  }
}

// Helper: generate L2-normalized vector at exact target ensemble distance
function vectorAtEnsembleDistance(query: Float32Array, targetD: number, seed: number): Float32Array {
  let lo = 1e-5;
  let hi = 1.8;
  let best = query;
  for (let iter = 0; iter < 32; iter++) {
    const mid = (lo + hi) / 2;
    const raw = new Float32Array(query.length);
    for (let i = 0; i < query.length; i++) {
      raw[i] = (query[i] ?? 0) + Math.sin((i + 1) * seed) * mid;
    }
    const cand = l2Normalize(raw);
    const d = ensembleDistance(query, cand);
    best = cand;
    if (d < targetD) lo = mid;
    else hi = mid;
  }
  return best;
}

const canonicalAnatUser: ExtendedAnatomicalFeatures = {
  upperThirdRatio: 0.3333,
  middleThirdRatio: 0.3333,
  lowerThirdRatio: 0.3334,
  lateralFifthsRatios: [0.2, 0.2, 0.2, 0.2, 0.2],
  interCanthalDistance: 0.21,
  canthalTiltAngleDeg: 4.0,
  nasalIndex: 0.75,
  bigonialToBizygomaticRatio: 0.76,
  gonialJawlineAngleDeg: 124.0,
  lipVermilionHeightRatio: 0.625,
  philtrumDepth: 0.50,
};

const mismatchedAnat: ExtendedAnatomicalFeatures = {
  ...canonicalAnatUser,
  canthalTiltAngleDeg: -10.0, // large difference
  gonialJawlineAngleDeg: 95.0,  // large difference
  nasalIndex: 1.10,            // large difference
};

// ---------------------------------------------------------
// SCENARIO 1: Boundary condition (0.0149 vs 0.0151)
// ---------------------------------------------------------
console.log("--- Test Scenario 1: Boundary Condition ---");

runTest("Boundary 0.0149 (below threshold) -> Tie-breaker MUST activate", () => {
  const queryDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.19 + 0.1)));
  // Candidate A: closer deep distance (d_A = 0.1500), but poor morphological match
  const descA = vectorAtEnsembleDistance(queryDesc, 0.1500, 1.11);
  // Candidate B: slightly farther deep distance (d_B = 0.1649 -> delta = 0.0149), but perfect morphological match
  const descB = vectorAtEnsembleDistance(queryDesc, 0.1649, 2.22);

  const dA = ensembleDistance(queryDesc, descA);
  const dB = ensembleDistance(queryDesc, descB);
  const delta = dB - dA;

  assert.ok(Math.abs(delta - 0.0149) < 1e-4, `Expected delta ~0.0149, got ${delta}`);
  assert.ok(delta < MORPH_TIE_THRESHOLD_EPS, `Delta (${delta}) must be < 0.015`);

  const query: UserFaceQuery = {
    descriptor: queryDesc,
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: canonicalAnatUser },
  };

  const gallery: CelebrityEmbedding[] = [
    {
      id: "cand-a-poor-morph",
      name: "Candidate A",
      path: "/a.jpg",
      descriptor: Array.from(descA),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: mismatchedAnat },
    },
    {
      id: "cand-b-perfect-morph",
      name: "Candidate B",
      path: "/b.jpg",
      descriptor: Array.from(descB),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: canonicalAnatUser },
    },
  ];

  const matches = rankByDescriptor(query, gallery, 2);
  assert.equal(matches.length, 2);
  assert.equal(
    matches[0]!.celebrityId,
    "cand-b-perfect-morph",
    `When delta = ${delta.toFixed(4)} (< 0.015), tie-breaker MUST rank Candidate B first.`,
  );
});

runTest("Boundary 0.0151 (above threshold) -> Tie-breaker MUST NOT activate", () => {
  const queryDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.19 + 0.1)));
  // Candidate A: closer deep distance (d_A = 0.1500), but poor morphological match
  const descA = vectorAtEnsembleDistance(queryDesc, 0.1500, 1.11);
  // Candidate B: farther deep distance (d_B = 0.1651 -> delta = 0.0151), perfect morphological match
  const descB = vectorAtEnsembleDistance(queryDesc, 0.1651, 3.33);

  const dA = ensembleDistance(queryDesc, descA);
  const dB = ensembleDistance(queryDesc, descB);
  const delta = dB - dA;

  assert.ok(Math.abs(delta - 0.0151) < 1e-4, `Expected delta ~0.0151, got ${delta}`);
  assert.ok(delta >= MORPH_TIE_THRESHOLD_EPS, `Delta (${delta}) must be >= 0.015`);

  const query: UserFaceQuery = {
    descriptor: queryDesc,
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: canonicalAnatUser },
  };

  const gallery: CelebrityEmbedding[] = [
    {
      id: "cand-a-poor-morph",
      name: "Candidate A",
      path: "/a.jpg",
      descriptor: Array.from(descA),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: mismatchedAnat },
    },
    {
      id: "cand-b-perfect-morph",
      name: "Candidate B",
      path: "/b.jpg",
      descriptor: Array.from(descB),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: canonicalAnatUser },
    },
  ];

  const matches = rankByDescriptor(query, gallery, 2);
  assert.equal(matches.length, 2);
  assert.equal(
    matches[0]!.celebrityId,
    "cand-a-poor-morph",
    `When delta = ${delta.toFixed(4)} (>= 0.015), deep vector distance MUST dominate and rank Candidate A first.`,
  );
});

runTest("Boundary 0.0150 (exact threshold >= 0.015) -> Tie-breaker MUST NOT activate", () => {
  const queryDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.19 + 0.1)));
  const descA = vectorAtEnsembleDistance(queryDesc, 0.1500, 1.11);
  const descB = vectorAtEnsembleDistance(queryDesc, 0.16501, 4.44);

  const dA = ensembleDistance(queryDesc, descA);
  const dB = ensembleDistance(queryDesc, descB);
  const delta = dB - dA;

  assert.ok(delta >= MORPH_TIE_THRESHOLD_EPS, `Delta (${delta.toFixed(8)}) must be >= 0.015`);

  const query: UserFaceQuery = {
    descriptor: queryDesc,
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: canonicalAnatUser },
  };

  const gallery: CelebrityEmbedding[] = [
    {
      id: "cand-a-poor-morph",
      name: "Candidate A",
      path: "/a.jpg",
      descriptor: Array.from(descA),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: mismatchedAnat },
    },
    {
      id: "cand-b-perfect-morph",
      name: "Candidate B",
      path: "/b.jpg",
      descriptor: Array.from(descB),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: canonicalAnatUser },
    },
  ];

  const matches = rankByDescriptor(query, gallery, 2);
  assert.equal(matches[0]!.celebrityId, "cand-a-poor-morph");
});

// ---------------------------------------------------------
// SCENARIO 2: Edge Cases & Robustness
// ---------------------------------------------------------
console.log("\n--- Test Scenario 2: Edge Cases & Robustness ---");

runTest("Missing anatomical features / null / undefined inputs to computeMorphologicalDistance", () => {
  assert.equal(computeMorphologicalDistance(null, null), 0.50);
  assert.equal(computeMorphologicalDistance(undefined, undefined), 0.50);
  assert.equal(computeMorphologicalDistance(canonicalAnatUser, null), 0.50);
  assert.equal(computeMorphologicalDistance(null, canonicalAnatUser), 0.50);

  const emptyFeat1: FaceFeatures = { ...emptyFeatures() };
  delete (emptyFeat1 as any).anatomical;
  const emptyFeat2: FaceFeatures = { ...emptyFeatures() };
  delete (emptyFeat2 as any).anatomical;

  // Both missing anatomical property -> ensureAnatomicalFeatures auto-derives proportions without crashing
  const dDerived = computeMorphologicalDistance(emptyFeat1, emptyFeat2);
  assert.ok(Number.isFinite(dDerived), "Derived morphological distance must be finite");
  assert.ok(dDerived >= 0.0 && dDerived <= 1.0, `Expected in [0, 1], got ${dDerived}`);
});

runTest("Degenerate landmark points (coincident points, extreme values, NaN)", () => {
  // Coincident 468 landmarks (all 0,0,0)
  const coincidentLms = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
  const anatCoincident = extractAnatomicalFeatures(coincidentLms);
  assert.ok(Number.isFinite(anatCoincident.upperThirdRatio));
  assert.ok(Number.isFinite(anatCoincident.canthalTiltAngleDeg));
  assert.ok(Number.isFinite(anatCoincident.nasalIndex));

  // Extreme value landmarks (1e308, -1e308)
  const extremeLms = Array.from({ length: 468 }, (_, i) => ({
    x: i % 2 === 0 ? 1e308 : -1e308,
    y: i % 3 === 0 ? 1e308 : -1e308,
    z: 0,
  }));
  const anatExtreme = extractAnatomicalFeatures(extremeLms);
  assert.ok(Number.isFinite(anatExtreme.upperThirdRatio));

  // NaN landmarks
  const nanLms = Array.from({ length: 468 }, () => ({ x: NaN, y: NaN, z: NaN }));
  const anatNaN = extractAnatomicalFeatures(nanLms);
  assert.ok(Number.isFinite(anatNaN.upperThirdRatio));
  assert.ok(Number.isFinite(anatNaN.gonialJawlineAngleDeg));

  // Empty landmarks array
  const emptyLms = extractAnatomicalFeatures([]);
  assert.equal(emptyLms.upperThirdRatio, 0.3333);
  assert.equal(emptyLms.canthalTiltAngleDeg, 4.0);

  // 68-point degenerate tests
  const nanLms68 = Array.from({ length: 68 }, () => ({ x: NaN, y: NaN, z: NaN }));
  const anat68NaN = extractAnatomicalFeatures68(nanLms68);
  assert.ok(Number.isFinite(anat68NaN.upperThirdRatio));
});

runTest("NaN propagation prevention in features & ranking", () => {
  const nanAnat: ExtendedAnatomicalFeatures = {
    upperThirdRatio: NaN,
    middleThirdRatio: NaN,
    lowerThirdRatio: NaN,
    lateralFifthsRatios: [NaN, NaN, NaN, NaN, NaN],
    interCanthalDistance: NaN,
    canthalTiltAngleDeg: NaN,
    nasalIndex: NaN,
    bigonialToBizygomaticRatio: NaN,
    gonialJawlineAngleDeg: NaN,
    lipVermilionHeightRatio: NaN,
    philtrumDepth: NaN,
  };

  const dMorphNaN = computeMorphologicalDistance(nanAnat, canonicalAnatUser);
  assert.equal(dMorphNaN, 0.50, "NaN anatomical feature must fall back cleanly to 0.50");

  const queryWithNaN: UserFaceQuery = {
    descriptor: l2Normalize(new Float32Array(128).fill(0.1)),
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: nanAnat },
  };

  const galleryWithNaN: CelebrityEmbedding[] = [
    {
      id: "celeb-nan",
      name: "Celeb NaN",
      path: "/nan.jpg",
      descriptor: Array.from(l2Normalize(new Float32Array(128).fill(0.1))),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: { ...emptyFeatures(), anatomical: nanAnat },
    },
  ];

  const matches = rankByDescriptor(queryWithNaN, galleryWithNaN, 1);
  assert.equal(matches.length, 1);
  assert.ok(Number.isFinite(matches[0]!.matchPercent));
  assert.ok(Number.isFinite(matches[0]!.confidenceScore));
  assert.ok(Number.isFinite(matches[0]!.distance));
});

// ---------------------------------------------------------
// SCENARIO 3: Performance SLA Benchmark (< 1.0 ms / call)
// ---------------------------------------------------------
console.log("\n--- Test Scenario 3: Performance SLA Benchmark ---");

runTest("1000 match executions over 50 candidates < 1.0 ms average overhead per call", () => {
  // Create realistic test dataset with 50 candidates
  const mockCandidates: CelebrityEmbedding[] = Array.from({ length: 50 }, (_, i) => {
    const rawVec = new Float32Array(128);
    for (let j = 0; j < 128; j++) {
      rawVec[j] = Math.sin((i + 1) * 0.1 + j * 0.05);
    }
    const desc = Array.from(l2Normalize(rawVec));
    return {
      id: `celeb-${i}`,
      name: `Celeb ${i}`,
      path: `/celeb-${i}.jpg`,
      descriptor: desc,
      age: 20 + (i % 40),
      gender: i % 2 === 0 ? "male" : "female",
      genderProb: 0.90 + (i % 10) * 0.01,
      features: {
        ...emptyFeatures(),
        anatomical: {
          ...canonicalAnatUser,
          canthalTiltAngleDeg: 4.0 + (i % 7) * 2.0,
          gonialJawlineAngleDeg: 124.0 - (i % 5) * 3.0,
          nasalIndex: 0.70 + (i % 4) * 0.05,
        },
      },
    };
  });

  const queryVec = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.08)));
  const query: UserFaceQuery = {
    descriptor: queryVec,
    descriptors: [
      queryVec,
      l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.08 + 0.02))),
    ],
    age: 30,
    gender: "male",
    genderProbability: 0.95,
    features: { ...emptyFeatures(), anatomical: canonicalAnatUser },
  };

  // Warmup 50 runs to trigger V8 JIT compilation
  for (let i = 0; i < 50; i++) {
    rankByDescriptor(query, mockCandidates, 5);
  }

  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    rankByDescriptor(query, mockCandidates, 5);
  }
  const totalMs = performance.now() - start;
  const avgMsPerCall = totalMs / iterations;

  console.log(`       Benchmarked ${iterations} iterations over 50 candidate vectors:`);
  console.log(`       Total time: ${totalMs.toFixed(2)} ms`);
  console.log(`       Average overhead per call: ${avgMsPerCall.toFixed(4)} ms/call`);

  assert.ok(
    avgMsPerCall < 1.0,
    `Performance SLA VIOLATION: Average overhead ${avgMsPerCall.toFixed(4)} ms/call exceeds < 1.0 ms threshold!`,
  );
});

console.log("\n=================================================");
console.log(`SUMMARY: ${passed} passed, ${failed} failed.`);
console.log("=================================================");

if (failed > 0) {
  process.exit(1);
}
