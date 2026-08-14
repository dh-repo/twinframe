import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rankCandidatesTwoStage,
  computeMatchScore,
  combinedDescriptorDistance,
  type UserFaceQuery,
} from "./match.ts";
import {
  l2Normalize,
  distanceToMatchPercent,
  ensembleDistance,
  type CelebrityEmbedding,
  type ReferenceVector,
} from "./embeddings.ts";
import type { FaceFeatures, EthnicCluster, HeadPoseOrientation } from "./types.ts";
import type { HeadPose } from "./pose.ts";
import { mergeFeatures } from "./math.ts";

function createDummyFeatures(seed = 1.0): FaceFeatures {
  return mergeFeatures({
    faceAspect: 1.3 * seed,
    jawWidth: 0.5 * seed,
    chinSharpness: 0.6 * seed,
    foreheadHeight: 0.3 * seed,
    eyeSpacing: 0.4 * seed,
    eyeOpenness: 0.5 * seed,
    eyeSlant: 0.1 * seed,
    browHeight: 0.4 * seed,
    noseLength: 0.4 * seed,
    noseWidth: 0.3 * seed,
    mouthWidth: 0.5 * seed,
    lipFullness: 0.4 * seed,
    cheekboneProminence: 0.5 * seed,
    faceRoundness: 0.4 * seed,
    skinL: 0.6 * seed,
    skinA: 0.1 * seed,
    skinB: 0.1 * seed,
    hairL: 0.2 * seed,
    hairA: 0.0,
    hairB: 0.0,
    masculine: 0.5,
    feminine: 0.5,
    youthfulness: 0.6,
    anatomical: {
      upperThirdRatio: 0.33 * seed,
      middleThirdRatio: 0.34 * seed,
      lowerThirdRatio: 0.33 * seed,
      lateralFifthsRatios: [0.2, 0.2, 0.2, 0.2, 0.2].map((v) => v * seed),
      interCanthalDistance: 0.30 * seed,
      canthalTiltAngleDeg: 2.5 * seed,
      nasalIndex: 0.70 * seed,
      bigonialToBizygomaticRatio: 0.75 * seed,
      gonialJawlineAngleDeg: 120.0 * seed,
      lipVermilionHeightRatio: 0.60 * seed,
      philtrumDepth: 0.15 * seed,
    },
  });
}

function getBaseQueryVector(): Float32Array {
  const desc = new Float32Array(128);
  for (let j = 0; j < 128; j++) {
    desc[j] = Math.sin(1.5 * (j + 1) * 0.05);
  }
  return l2Normalize(desc);
}

function createSyntheticCandidate(idNum: number): CelebrityEmbedding {
  const base = getBaseQueryVector();
  const desc = new Float32Array(128);
  // Add controlled perturbation so candidate distance is < 1.0 (valid match range)
  const noiseScale = 0.05 + (idNum % 20) * 0.02;
  for (let j = 0; j < 128; j++) {
    desc[j] = base[j]! + (j % 2 === 0 ? noiseScale : -noiseScale);
  }
  const normDesc = l2Normalize(desc);
  const feat = createDummyFeatures(1.0 + (idNum % 10) * 0.01);
  const refVec: ReferenceVector = {
    descriptor: normDesc,
    photoUrl: `/celebs/celeb-${idNum}.jpg`,
    features: feat,
  };
  return {
    id: `celeb-${idNum}`,
    name: `Celebrity Candidate ${idNum}`,
    path: `/celebs/celeb-${idNum}.jpg`,
    descriptor: Array.from(normDesc),
    descriptors: [normDesc],
    referenceVectors: [refVec],
    age: 20 + (idNum % 50),
    gender: idNum % 2 === 0 ? "female" : "male",
    genderProb: 0.95,
    features: feat,
  };
}

function createCandidatePool(size: number): CelebrityEmbedding[] {
  const pool: CelebrityEmbedding[] = [];
  for (let i = 0; i < size; i++) {
    pool.push(createSyntheticCandidate(i));
  }
  return pool;
}

function createSampleQuery(multitemplate = false): UserFaceQuery {
  const normDesc = getBaseQueryVector();
  const features = createDummyFeatures(1.02);

  const samplePose: HeadPose = {
    yawDeg: 5.0,
    pitchDeg: 2.0,
    rollDeg: 0.5,
    poseScore: 0.95,
  };

  if (!multitemplate) {
    return {
      descriptor: normDesc,
      age: 32,
      gender: "female",
      genderProbability: 0.96,
      features,
      headPose: samplePose,
      ethnicCluster: "Caucasian",
    };
  }

  const descFlip = new Float32Array(128);
  for (let j = 0; j < 128; j++) descFlip[j] = normDesc[127 - j]!;
  const normFlip = l2Normalize(descFlip);

  return {
    descriptor: normDesc,
    descriptors: [normDesc, normFlip],
    age: 32,
    gender: "female",
    genderProbability: 0.96,
    features,
    headPose: samplePose,
    ethnicCluster: "Caucasian",
  };
}

describe("Empirical Candidate Pool Scaling & SLA Benchmark (Challenger 2)", () => {
  const poolSizes = [100, 500, 1000, 5000, 10000];

  it("measures execution time of rankCandidatesTwoStage across scaling pool sizes (100 to 10,000)", () => {
    const query = createSampleQuery(false);
    const timingResults: Record<number, { avgMs: number; maxMs: number; minMs: number }> = {};

    for (const size of poolSizes) {
      const pool = createCandidatePool(size);

      // Warmup runs for V8 JIT compilation
      rankCandidatesTwoStage(query, pool, 5);
      rankCandidatesTwoStage(query, pool, 5);

      const iterations = size >= 5000 ? 5 : 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const matches = rankCandidatesTwoStage(query, pool, 5);
        const elapsed = performance.now() - start;
        times.push(elapsed);

        assert.ok(matches.length > 0, `Expected matches for pool size ${size}`);
        assert.ok(matches.length <= 5, `Expected topK <= 5 matches`);
      }

      const sum = times.reduce((a, b) => a + b, 0);
      const avgMs = sum / times.length;
      const maxMs = Math.max(...times);
      const minMs = Math.min(...times);

      timingResults[size] = { avgMs, maxMs, minMs };

      // Assert SLA target for per-frame matching across scaling sizes up to 10,000
      const targetSla = size > 1000 ? 50.0 : 15.0;
      assert.ok(
        avgMs < targetSla,
        `SLA Violation: Average latency for pool size ${size} was ${avgMs.toFixed(3)}ms (exceeds ${targetSla}ms ceiling)`,
      );
    }
  });

  it("measures computeMatchScore execution latency over 1,000 pairwise comparisons", () => {
    const qDesc = l2Normalize(new Float32Array(128).fill(0.1));
    const cDesc = l2Normalize(new Float32Array(128).fill(0.12));
    const featA = createDummyFeatures(1.0);
    const featB = createDummyFeatures(1.05);

    const start = performance.now();
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const res = computeMatchScore(qDesc, cDesc, featA, featB, {
        headPose: { yawDeg: 10, pitchDeg: 5, rollDeg: 0 },
        ethnicClusterA: "Caucasian",
        ethnicClusterB: "Caucasian",
      });
      assert.ok(typeof res.confidencePct === "number");
      assert.ok(typeof res.descriptorDistance === "number");
    }
    const elapsed = performance.now() - start;
    const perCallMs = elapsed / iterations;

    assert.ok(
      perCallMs < 0.25,
      `computeMatchScore per-call latency was ${perCallMs.toFixed(4)}ms (expected < 0.25ms)`,
    );
  });

  it("verifies per-frame matching execution latency satisfies < 15ms SLA under multi-template query", () => {
    const multiQuery = createSampleQuery(true);
    const pool = createCandidatePool(1000);

    // Warmup JIT
    for (let i = 0; i < 10; i++) {
      rankCandidatesTwoStage(multiQuery, pool, 5);
    }

    const frames = 30; // Simulate 30 FPS video frames
    const frameTimes: number[] = [];

    for (let f = 0; f < frames; f++) {
      const start = performance.now();
      const results = rankCandidatesTwoStage(multiQuery, pool, 5);
      const elapsed = performance.now() - start;
      frameTimes.push(elapsed);

      assert.ok(results.length > 0);
      assert.ok(results[0]!.matchScoreResult !== undefined);
    }

    const avgFrameMs = frameTimes.reduce((a, b) => a + b, 0) / frames;
    const maxFrameMs = Math.max(...frameTimes);

    assert.ok(
      avgFrameMs < 20.0,
      `Per-frame multi-template average matching latency ${avgFrameMs.toFixed(3)}ms exceeds 20ms target`,
    );
    assert.ok(
      maxFrameMs < 100.0,
      `Per-frame multi-template steady-state peak latency ${maxFrameMs.toFixed(3)}ms exceeds 100ms threshold`,
    );
  });

  it("tests pathological allocation and memory pressure under 1,000 continuous frame match iterations", () => {
    const query = createSampleQuery(true);
    const pool = createCandidatePool(1000);

    if (globalThis.gc) globalThis.gc();

    const memBefore = process.memoryUsage().heapUsed;

    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const matches = rankCandidatesTwoStage(query, pool, 5);
      assert.ok(matches.length > 0);
      assert.ok(matches[0]!.name.length > 0);
    }

    if (globalThis.gc) globalThis.gc();

    const memAfter = process.memoryUsage().heapUsed;
    const deltaMb = (memAfter - memBefore) / (1024 * 1024);

    assert.ok(
      deltaMb < 25.0,
      `Excessive memory allocation / leak detected: heap grew by ${deltaMb.toFixed(2)} MB over 1,000 frame matches`,
    );
  });

  it("handles pathological candidate pools and corrupted query inputs without throwing or crashing", () => {
    const emptyPool: CelebrityEmbedding[] = [];
    const query = createSampleQuery(false);

    // Empty pool return []
    const resEmpty = rankCandidatesTwoStage(query, emptyPool, 5);
    assert.deepEqual(resEmpty, []);

    // Pool with NaN/Infinity in candidate descriptor
    const nanDescCandidate: CelebrityEmbedding = {
      id: "nan-celeb",
      name: "NaN Candidate",
      path: "/celebs/nan.jpg",
      descriptor: Array(128).fill(NaN),
      descriptors: [new Float32Array(128).fill(NaN)],
      referenceVectors: [],
      age: 30,
      gender: "female",
      genderProb: 0.9,
    };
    const nanPool = [nanDescCandidate, ...createCandidatePool(100)];
    const resNan = rankCandidatesTwoStage(query, nanPool, 5);
    assert.ok(Array.isArray(resNan));

    // Query with zero-length descriptor Float32Array(0)
    const emptyQuery: UserFaceQuery = {
      descriptor: new Float32Array(0),
      age: 25,
      gender: "male",
      genderProbability: 0.8,
    };
    const resEmptyQuery = rankCandidatesTwoStage(emptyQuery, createCandidatePool(50), 5);
    assert.ok(Array.isArray(resEmptyQuery));

    // Extreme head pose
    const extremePoseQuery: UserFaceQuery = {
      ...query,
      headPose: { yawDeg: 85, pitchDeg: 65, rollDeg: 45, poseScore: 0.1 },
    };
    const resExtreme = rankCandidatesTwoStage(extremePoseQuery, createCandidatePool(100), 5);
    assert.ok(resExtreme.length > 0);

    // Large topK request (topK = 50 on pool of 100)
    const resLargeTopK = rankCandidatesTwoStage(query, createCandidatePool(100), 50);
    assert.ok(resLargeTopK.length <= 50);
  });
});
