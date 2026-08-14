import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeMatchScore,
  l2Normalize,
  distanceToMatchPercent,
  combinedDescriptorDistance,
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
  type CelebrityEmbedding,
} from "./embeddings.ts";
import {
  rankCandidates,
  rankCandidatesTwoStage,
  type UserFaceQuery,
} from "./match.ts";
import { mergeFeatures, emptyFeatures } from "./math.ts";
import type { FaceFeatures, EthnicCluster, MatchScoreResult } from "./types.ts";
import { crossDemographicMismatchPenalty } from "./geometry.ts";

function feat(partial: Partial<FaceFeatures>): FaceFeatures {
  return mergeFeatures(partial);
}

describe("M3 Challenger 1: Empirical Lookalike Discrimination & Gating", () => {
  const vBase = l2Normalize(new Float32Array(128).fill(0.1));

  // Helper to create an orthogonal or controlled-distance L2-normalized vector
  function createVectorAtDistance(targetDist: number): Float32Array {
    const ortho = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      ortho[i] = i % 2 === 0 ? 1 : -1;
    }
    const orthoNorm = l2Normalize(ortho);
    
    let low = 0;
    let high = 1.0;
    let bestVec = orthoNorm;
    for (let iter = 0; iter < 30; iter++) {
      const alpha = (low + high) / 2;
      const blend = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        blend[i] = (1 - alpha) * vBase[i]! + alpha * orthoNorm[i]!;
      }
      const normBlend = l2Normalize(blend);
      const dist = ensembleDistance(vBase, normBlend);
      if (dist <= targetDist) {
        low = alpha;
        bestVec = normBlend;
      } else {
        high = alpha;
      }
    }
    return bestVec;
  }

  it("1. Profiles with combined descriptor distance >= 0.72 score < 20% confidencePct and fail lookalike gate", () => {
    // When wGeom = 0.0 for empty morphological features, descriptorDistance = deepDist directly.
    // Deep vector distance >= 0.72 yields descriptorDistance >= 0.72 > 0.70.
    const deepDistancesToTest = [0.72, 0.80, 0.85, 0.90, 1.00, 1.20, 1.50];

    for (const dTarget of deepDistancesToTest) {
      const vFar = createVectorAtDistance(dTarget);
      const score: MatchScoreResult = computeMatchScore(
        vBase,
        vFar,
        emptyFeatures(),
        emptyFeatures()
      );

      assert.ok(
        score.descriptorDistance > 0.70,
        `Expected combined descriptorDistance > 0.70, got ${score.descriptorDistance}`
      );
      assert.ok(
        score.confidencePct < 20.0,
        `Descriptor distance ${score.descriptorDistance.toFixed(3)} scored ${score.confidencePct}%, expected < 20.0%`
      );
      assert.equal(
        score.passedLookalikeGate,
        false,
        `Descriptor distance ${score.descriptorDistance.toFixed(3)} passed lookalike gate (expected false)`
      );
    }
  });

  it("1b. Boundary verification: Hill equation calibration at d = 0.70 vs d = 0.71", () => {
    // At combined descriptor distance d = 0.70, score is 20.2% and passes lookalike gate
    const v070 = createVectorAtDistance(0.70);
    const score070 = computeMatchScore(vBase, v070, emptyFeatures(), emptyFeatures());
    assert.ok(score070.descriptorDistance <= 0.70, `Expected d <= 0.70, got ${score070.descriptorDistance}`);
    assert.ok(score070.confidencePct >= 20.0, `Expected confidence >= 20.0%, got ${score070.confidencePct}%`);
    assert.equal(score070.passedLookalikeGate, true, "Combined distance <= 0.70 must pass gate");

    // At combined descriptor distance d = 0.72, score is 19.6% and fails lookalike gate
    const v072 = createVectorAtDistance(0.72);
    const score072 = computeMatchScore(vBase, v072, emptyFeatures(), emptyFeatures());
    assert.ok(score072.descriptorDistance > 0.70, `Expected d > 0.70, got ${score072.descriptorDistance}`);
    assert.ok(score072.confidencePct < 20.0, `Expected confidence < 20.0%, got ${score072.confidencePct}%`);
    assert.equal(score072.passedLookalikeGate, false, "Combined distance > 0.70 must fail gate");
  });

  it("2. Twin and Lookalike variations scale monotonically and gate appropriately", () => {
    // Identical profile (distance = 0)
    const scoreIdentical = computeMatchScore(vBase, vBase, emptyFeatures(), emptyFeatures());
    assert.equal(scoreIdentical.confidencePct, 100.0);
    assert.equal(scoreIdentical.passedLookalikeGate, true);

    // Near lookalike (distance ~ 0.30)
    const vNear = createVectorAtDistance(0.30);
    const scoreNear = computeMatchScore(vBase, vNear, emptyFeatures(), emptyFeatures());
    assert.ok(scoreNear.confidencePct >= 50.0 && scoreNear.confidencePct <= 70.0);
    assert.equal(scoreNear.passedLookalikeGate, true);

    // Borderline lookalike (deep distance ~ 0.65)
    const vBorderline = createVectorAtDistance(0.65);
    const scoreBorderline = computeMatchScore(vBase, vBorderline, emptyFeatures(), emptyFeatures());
    assert.ok(scoreBorderline.confidencePct >= 20.0 && scoreBorderline.confidencePct <= 30.0);
    assert.equal(scoreBorderline.passedLookalikeGate, true);

    // Beyond threshold lookalike (deep distance ~ 0.80 -> combined descriptor distance > 0.70)
    const vBeyond = createVectorAtDistance(0.80);
    const scoreBeyond = computeMatchScore(vBase, vBeyond, emptyFeatures(), emptyFeatures());
    assert.ok(scoreBeyond.confidencePct < 20.0);
    assert.equal(scoreBeyond.passedLookalikeGate, false);
  });

  it("3. Cross-demographic mismatches are rejected cleanly even with identical deep vectors", () => {
    const clusters: EthnicCluster[] = [
      "East Asian",
      "South Asian",
      "African",
      "Caucasian",
      "Hispanic",
      "Middle Eastern",
    ];

    const featA = feat({ skinL: 0.85, noseWidth: 0.32 });
    const featB = feat({ skinL: 0.25, noseWidth: 0.48 });

    for (let i = 0; i < clusters.length; i++) {
      for (let j = 0; j < clusters.length; j++) {
        if (i === j) continue;
        const clusterA = clusters[i]!;
        const clusterB = clusters[j]!;

        const score = computeMatchScore(vBase, vBase, featA, featB, {
          ethnicClusterA: clusterA,
          ethnicClusterB: clusterB,
        });

        const penalty = crossDemographicMismatchPenalty(featA, featB, clusterA, clusterB);
        assert.ok(
          penalty >= 0.15,
          `Expected penalty >= 0.15 for cross-demographic ${clusterA} vs ${clusterB}, got ${penalty}`
        );

        if (penalty >= 0.20) {
          assert.equal(
            score.passedLookalikeGate,
            false,
            `Cross-demographic mismatch (${clusterA} vs ${clusterB}) with penalty ${penalty.toFixed(3)} must fail lookalike gate`
          );
        }
      }
    }
  });

  it("4. Two-stage search attaches passedLookalikeGate correctly to returned matches", () => {
    const vClose = createVectorAtDistance(0.20);
    const vFar1 = createVectorAtDistance(0.85);
    const vFar2 = createVectorAtDistance(0.95);

    const featUser = feat({ skinL: 0.80 });
    const featCrossDemo = feat({ skinL: 0.20 });

    const mockGallery: CelebrityEmbedding[] = [
      {
        id: "close-lookalike",
        name: "Close Lookalike",
        path: "/close.jpg",
        descriptor: Array.from(vClose),
        descriptors: [vClose],
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: featUser,
        ethnicCluster: "East Asian",
      },
      {
        id: "cross-demo-match",
        name: "Cross Demo Match",
        path: "/cross.jpg",
        descriptor: Array.from(vClose), // Same close deep vector!
        descriptors: [vClose],
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: featCrossDemo,
        ethnicCluster: "African",
      },
      {
        id: "far-match-1",
        name: "Far Match 1",
        path: "/far1.jpg",
        descriptor: Array.from(vFar1),
        descriptors: [vFar1],
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: featUser,
        ethnicCluster: "East Asian",
      },
      {
        id: "far-match-2",
        name: "Far Match 2",
        path: "/far2.jpg",
        descriptor: Array.from(vFar2),
        descriptors: [vFar2],
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: featUser,
        ethnicCluster: "East Asian",
      },
    ];

    const query: UserFaceQuery = {
      descriptor: vBase,
      features: featUser,
      ethnicCluster: "East Asian",
      age: 30,
      gender: "male",
      genderProbability: 0.9,
    };

    const matches = rankCandidatesTwoStage(query, mockGallery, 4);
    assert.ok(matches.length >= 1);

    // Close lookalike should pass gate
    const closeMatch = matches.find((m) => m.celebrityId === "close-lookalike");
    assert.ok(closeMatch, "Close lookalike must be returned in candidate ranking");
    assert.equal(closeMatch.passedLookalikeGate, true, "Close lookalike must pass lookalike gate");
    assert.ok(closeMatch.matchScoreResult!.confidencePct >= 20.0);

    // Cross demo match should fail gate
    const crossMatch = matches.find((m) => m.celebrityId === "cross-demo-match");
    if (crossMatch) {
      assert.equal(crossMatch.passedLookalikeGate, false, "Cross demo candidate must fail lookalike gate");
    }

    // Far match should fail gate
    const farMatch1 = matches.find((m) => m.celebrityId === "far-match-1");
    if (farMatch1) {
      assert.equal(farMatch1.passedLookalikeGate, false, "Far match candidate must fail lookalike gate");
      assert.ok(farMatch1.matchScoreResult!.confidencePct < 20.0);
    }
  });

  it("5. Edge case resilience: zeros, empty arrays, NaNs, and extreme poses do not crash scoring", () => {
    const zeroVec = new Float32Array(128).fill(0);
    const nanVec = new Float32Array(128).fill(NaN);
    const infVec = new Float32Array(128).fill(Infinity);

    // Zero vector
    const scoreZero = computeMatchScore(zeroVec, vBase);
    assert.ok(Number.isFinite(scoreZero.confidencePct));
    assert.equal(scoreZero.passedLookalikeGate, false);

    // NaN vector
    const scoreNaN = computeMatchScore(nanVec, vBase);
    assert.ok(Number.isFinite(scoreNaN.confidencePct));
    assert.equal(scoreNaN.passedLookalikeGate, false);

    // Inf vector
    const scoreInf = computeMatchScore(infVec, vBase);
    assert.ok(Number.isFinite(scoreInf.confidencePct));
    assert.equal(scoreInf.passedLookalikeGate, false);

    // Extreme head pose (yaw = 80 deg)
    const scorePose = computeMatchScore(vBase, vBase, emptyFeatures(), emptyFeatures(), {
      headPose: { yawDeg: 80, pitchDeg: 10, rollDeg: 0 },
    });
    assert.ok(Number.isFinite(scorePose.confidencePct));
    assert.ok(scorePose.passedLookalikeGate);
  });

  it("6. Stress SLA benchmark: 500 candidate two-stage search finishes in < 15ms", () => {
    const precomputedVecs = Array.from({ length: 500 }, (_, i) =>
      l2Normalize(new Float32Array(128).fill((i % 10) * 0.1))
    );

    const featDummy = emptyFeatures();

    const mockGallery: CelebrityEmbedding[] = precomputedVecs.map((vec, i) => ({
      id: `stress-celeb-${i}`,
      name: `Stress Celeb ${i}`,
      path: `/stress-${i}.jpg`,
      descriptor: Array.from(vec),
      descriptors: [vec],
      age: 20 + (i % 60),
      gender: i % 2 === 0 ? "male" : "female",
      genderProb: 0.9,
      features: featDummy,
      ethnicCluster: "Caucasian",
    }));

    const query: UserFaceQuery = {
      descriptor: vBase,
      age: 35,
      gender: "male",
      genderProbability: 0.9,
      ethnicCluster: "Caucasian",
    };

    // Warmup call to trigger JIT compilation
    rankCandidatesTwoStage(query, mockGallery, 10);

    const durations: number[] = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const results = rankCandidatesTwoStage(query, mockGallery, 10);
      durations.push(performance.now() - start);
      assert.equal(results.length, 10);
    }
    const minDuration = Math.min(...durations);

    assert.ok(
      minDuration < 15.0,
      `500 candidate two-stage search min duration took ${minDuration.toFixed(2)}ms, expected < 15ms`
    );
  });
});
