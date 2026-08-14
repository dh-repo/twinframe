import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMatchAccuracy,
  loadGalleryDataNode,
  type EvaluationReport,
} from "../../../scripts/evaluate-match-accuracy.ts";
import {
  computeMatchScore,
  distanceToMatchPercent,
  l2Normalize,
} from "./embeddings.ts";
import {
  alignToCanonical3D,
  CANONICAL_FACE_3D,
  estimateHeadPose68,
} from "./pose.ts";
import {
  extractAnatomicalFeatures,
  extractGeometryFeatures68,
} from "./geometry.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";
import type {
  ExtendedAnatomicalFeatures,
  Point3D,
  Vector3D,
  Matrix3x3,
} from "./types.ts";

function buildRotationMatrix(yawDeg: number, pitchDeg: number, rollDeg: number): Matrix3x3 {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const roll = (rollDeg * Math.PI) / 180;

  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);

  return [
    [cy * cr + sy * sp * sr, sr * cp, -sy * cr + cy * sp * sr],
    [-cy * sr + sy * sp * cr, cr * cp, sy * sr + cy * sp * cr],
    [sy * cp, -sp, cy * cp],
  ];
}

function applyTransform(p: Point3D, R: Matrix3x3, T: Vector3D, s: number): Point3D {
  return {
    x: s * (R[0][0] * p.x + R[0][1] * p.y + R[0][2] * p.z) + T[0],
    y: s * (R[1][0] * p.x + R[1][1] * p.y + R[1][2] * p.z) + T[1],
    z: s * (R[2][0] * p.x + R[2][1] * p.y + R[2][2] * p.z) + T[2],
  };
}

describe("Face Match Accuracy & Cross-Demographic Automated Evaluation (M4)", () => {
  let report: EvaluationReport;
  let duration: number;

  before(async () => {
    const start = performance.now();
    report = await evaluateMatchAccuracy({
      fastMode: true,
      verbose: false,
      protocol: "perturbed-query",
      targetRank1Pct: 98.0,
      evaluateCrossDemographic: true,
    });
    duration = performance.now() - start;
  });

  it("executes benchmark evaluation cleanly within 5000ms SLA", () => {
    assert.ok(
      duration < 5000,
      `Evaluation duration ${duration.toFixed(2)}ms exceeded 5000ms SLA ceiling`
    );
    assert.ok(
      report.metrics.elapsedMs < 5000,
      `Report metrics elapsedMs ${report.metrics.elapsedMs}ms exceeded 5000ms SLA`
    );
  });

  it("verifies Top-1 celebrity match accuracy on ground-truth benchmark pairs exceeds 98.0%", () => {
    assert.equal(report.protocol, "perturbed-query");
    assert.ok(
      report.metrics.meanPositiveDistance > 0.01,
      `d_pos must be > 0.01 under honest protocol (got ${report.metrics.meanPositiveDistance})`,
    );
    assert.ok(
      report.metrics.rank1Accuracy >= 98.0,
      `Rank-1 accuracy (${report.metrics.rank1Accuracy.toFixed(2)}%) below required 98.0% threshold`
    );
    assert.ok(
      report.metrics.rank1AccuracyPct >= 98.0,
      `Rank-1 accuracy pct (${report.metrics.rank1AccuracyPct.toFixed(2)}%) below required 98.0% threshold`
    );
  });

  it("verifies 0 top-3 false matches across distinct ethnic clusters (crossDemographicTop3FalseMatches === 0)", () => {
    assert.equal(
      report.metrics.crossDemographicTop3FalseMatches,
      0,
      `Found ${report.metrics.crossDemographicTop3FalseMatches} cross-demographic false matches in top-3 rankings`
    );
    assert.equal(
      report.metrics.crossDemographicPass,
      true,
      "crossDemographicPass gate must be true"
    );
  });

  it("verifies true positive match separation gap meets or exceeds target threshold (Delta >= 0.2309)", () => {
    assert.ok(
      report.metrics.separationGap >= 0.2309,
      `Separation gap Delta (${report.metrics.separationGap.toFixed(4)}) below required 0.2309 threshold`
    );
    assert.ok(
      report.metrics.meanNegativeDistance > report.metrics.meanPositiveDistance,
      `d_neg (${report.metrics.meanNegativeDistance.toFixed(4)}) must exceed d_pos (${report.metrics.meanPositiveDistance.toFixed(4)})`
    );
  });

  describe("Geometric Ratio Pose Invariance Harness (M4-R5)", () => {
    it("asserts < 3.5% ratio variance across synthetic 3D yaw (±30°), pitch (±20°), and roll (±10°) perturbations across all 9 clinical facial ratios", () => {
      const refFeatures = extractAnatomicalFeatures(CANONICAL_FACE_3D);
      const testPoses = [
        { yaw: 15, pitch: 0, roll: 0, s: 1.0, T: [0, 0, 0] as Vector3D },
        { yaw: -15, pitch: 0, roll: 0, s: 1.0, T: [0, 0, 0] as Vector3D },
        { yaw: 30, pitch: 0, roll: 0, s: 1.0, T: [0, 0, 0] as Vector3D },
        { yaw: -30, pitch: 0, roll: 0, s: 1.0, T: [0, 0, 0] as Vector3D },
        { yaw: 0, pitch: 15, roll: 0, s: 1.0, T: [0, 0, 0] as Vector3D },
        { yaw: 0, pitch: -15, roll: 0, s: 1.0, T: [0, 0, 0] as Vector3D },
        { yaw: 0, pitch: 20, roll: 0, s: 1.0, T: [0, 0, 0] as Vector3D },
        { yaw: 0, pitch: -20, roll: 0, s: 1.0, T: [0, 0, 0] as Vector3D },
        { yaw: 25, pitch: 15, roll: -5, s: 1.1, T: [10, -5, 15] as Vector3D },
        { yaw: -25, pitch: -15, roll: 5, s: 0.9, T: [-10, 8, -15] as Vector3D },
        { yaw: 30, pitch: -20, roll: 10, s: 1.15, T: [20, 15, 30] as Vector3D },
        { yaw: -30, pitch: 20, roll: -10, s: 0.85, T: [-15, -10, -20] as Vector3D },
      ];

      const ratioKeys: (keyof ExtendedAnatomicalFeatures)[] = [
        "upperThirdRatio",
        "middleThirdRatio",
        "lowerThirdRatio",
        "interCanthalDistance",
        "canthalTiltAngleDeg",
        "nasalIndex",
        "bigonialToBizygomaticRatio",
        "gonialJawlineAngleDeg",
        "lipVermilionHeightRatio",
      ];

      for (const pose of testPoses) {
        const R = buildRotationMatrix(pose.yaw, pose.pitch, pose.roll);
        const perturbedLms: Point3D[] = CANONICAL_FACE_3D.map((p) =>
          applyTransform(p, R, pose.T, pose.s)
        );
        const alignResult = alignToCanonical3D(perturbedLms);
        assert.ok(alignResult.unwarpedLandmarks.length > 0, "alignToCanonical3D unwarped landmarks must be populated");
        const perturbedFeatures = extractAnatomicalFeatures(alignResult.unwarpedLandmarks);

        for (const key of ratioKeys) {
          const refVal = refFeatures[key] as number;
          const rotVal = perturbedFeatures[key] as number;
          if (
            typeof refVal === "number" &&
            typeof rotVal === "number" &&
            Math.abs(refVal) > 1e-6
          ) {
            const relVar = (Math.abs(rotVal - refVal) / Math.abs(refVal)) * 100;
            assert.ok(
              relVar < 3.5,
              `Ratio ${key} variance under yaw=${pose.yaw}° pitch=${pose.pitch}° roll=${pose.roll}° was ${relVar.toFixed(3)}% (exceeds 3.5% SLA)`
            );
          }
        }
      }
    });
  });

  describe("Lookalike Discrimination & Gating Assertions (M4-R4/R5)", () => {
    it("verifies poor match pairs (d > 0.40) yield < 25% similarity or return No Close Match []", () => {
      const poorUser: UserFaceQuery = {
        descriptor: l2Normalize(new Float32Array(128).map((_, i) => Math.sin(i * 0.1))),
        age: 35,
        gender: "unknown",
        genderProbability: 0.5,
      };

      const matches = rankByDescriptor(
        poorUser,
        [
          {
            id: "test-celeb",
            name: "Test Celeb",
            path: "/celebs/test.jpg",
            descriptor: Array.from(l2Normalize(new Float32Array(128).map((_, i) => Math.cos(i * 0.1)))),
            age: 35,
            gender: "male",
            genderProb: 0.9,
          },
        ],
        5,
      );

      assert.equal(
        matches.length,
        0,
        "rankByDescriptor must return empty array [] (No Close Match) when candidate d > 0.40"
      );
    });

    it("verifies lookalike discrimination gating explicitly sets passedLookalikeGate: false and confidencePct < 20.0 for descriptor distance > 0.70", () => {
      const vecA = l2Normalize(new Float32Array(128).map((_, i) => Math.sin(i * 0.1)));
      const vecB = l2Normalize(new Float32Array(128).map((_, i) => Math.cos(i * 0.1)));
      const score = computeMatchScore(vecA, vecB);

      assert.ok(
        score.descriptorDistance > 0.70,
        `Descriptor distance (${score.descriptorDistance.toFixed(4)}) must be > 0.70`
      );
      assert.equal(
        score.passedLookalikeGate,
        false,
        "passedLookalikeGate must be false when distance > 0.70"
      );
      assert.ok(
        score.confidencePct < 20.0,
        `confidencePct (${score.confidencePct.toFixed(2)}%) must be < 20.0% for distance > 0.70`
      );
    });

    it("verifies lookalike gating cleanly filters candidate profiles with cross-demographic penalty (passedLookalikeGate === false or confidencePct < 20.0)", () => {
      const vecA = l2Normalize(new Float32Array(128).fill(0.1));
      const vecB = l2Normalize(new Float32Array(128).fill(0.12));
      const featA = extractGeometryFeatures68(CANONICAL_FACE_3D);
      const featB = extractGeometryFeatures68(CANONICAL_FACE_3D);
      const score = computeMatchScore(vecA, vecB, featA, featB, {
        ethnicClusterA: "East Asian",
        ethnicClusterB: "Caucasian",
      });

      assert.equal(
        score.passedLookalikeGate,
        false,
        "passedLookalikeGate must be false when cross-demographic penalty is present"
      );
      assert.ok(
        score.confidencePct < 20.0 || score.passedLookalikeGate === false,
        "Cross-demographic mismatch pair must yield passedLookalikeGate === false or confidencePct < 20.0"
      );
    });

    it("verifies rankByDescriptor enforces lookalike gating for non-matching candidates", () => {
      const poorUser: UserFaceQuery = {
        descriptor: l2Normalize(new Float32Array(128).map((_, i) => Math.sin((i + 1) * 0.5))),
        age: 35,
        gender: "unknown",
        genderProbability: 0.5,
      };
      const gallery = loadGalleryDataNode();
      const matches = rankByDescriptor(poorUser, gallery, 5, { includeLongTail: true });
      for (const match of matches) {
        if (match.distance && match.distance > 0.40) {
          assert.ok(
            match.matchPercent < 20.0 || match.passedLookalikeGate === false,
            `Match ${match.name} with distance ${match.distance} failed gating: matchPercent=${match.matchPercent}, passedLookalikeGate=${match.passedLookalikeGate}`
          );
        }
      }
    });
  });

  describe("Pure TS Client Execution Latency Benchmark SLA (M4-R3)", () => {
    it("verifies per-frame feature extraction + two-stage ranking mean latency is strictly < 15.0ms per frame", () => {
      const gallery = loadGalleryDataNode();
      assert.ok(
        gallery.length >= 500,
        `Gallery catalog must contain at least 500 celebrities (got ${gallery.length})`
      );

      const landmarks: Point3D[] = CANONICAL_FACE_3D;
      const queryDescriptor = gallery[0]!.descriptors?.[0] ?? l2Normalize(gallery[0]!.descriptor);

      // Warmup iterations to eliminate V8 JIT cold-start bias
      for (let i = 0; i < 10; i++) {
        const align = alignToCanonical3D(landmarks);
        const feat = extractGeometryFeatures68(landmarks);
        const pose = estimateHeadPose68(landmarks);
        rankByDescriptor(
          {
            descriptor: queryDescriptor,
            age: gallery[0]!.age,
            gender: gallery[0]!.gender,
            genderProbability: 0.9,
            features: feat,
            headPose: pose,
          },
          gallery,
          5
        );
      }

      const N = 100;
      const latencies: number[] = [];
      const startTime = performance.now();

      for (let i = 0; i < N; i++) {
        const frameStart = performance.now();

        const align = alignToCanonical3D(landmarks);
        const feat = extractGeometryFeatures68(landmarks);
        const pose = estimateHeadPose68(landmarks);
        const matches = rankByDescriptor(
          {
            descriptor: queryDescriptor,
            age: gallery[0]!.age,
            gender: gallery[0]!.gender,
            genderProbability: 0.9,
            features: feat,
            headPose: pose,
          },
          gallery,
          5
        );

        const frameElapsed = performance.now() - frameStart;
        latencies.push(frameElapsed);
        assert.equal(matches.length, 5, "Must return top-5 matches per frame");
      }

      const totalElapsed = performance.now() - startTime;
      const meanLatencyMs = totalElapsed / N;

      latencies.sort((a, b) => a - b);
      const p95LatencyMs = latencies[Math.floor(N * 0.95)]!;

      assert.ok(
        meanLatencyMs < 15.0,
        `Mean execution latency per frame (${meanLatencyMs.toFixed(2)}ms) exceeded 15.0ms SLA ceiling`
      );
      assert.ok(
        p95LatencyMs < 60.0,
        `P95 execution latency per frame (${p95LatencyMs.toFixed(2)}ms) exceeded 60.0ms ceiling`
      );
    });
  });

  it("returns complete telemetry data structure with valid metric bounds", () => {
    assert.ok(report.timestamp, "Timestamp must be populated");
    assert.equal(typeof report.passedBenchmark, "boolean");
    assert.equal(report.passedBenchmark, true);
    assert.ok(report.metrics.totalPairs > 0, "totalPairs must be > 0");
    assert.ok(report.metrics.positivePairsCount > 0, "positivePairsCount > 0");
    assert.ok(report.metrics.negativePairsCount > 0, "negativePairsCount > 0");
    assert.ok(
      report.metrics.f1Score >= 0 && report.metrics.f1Score <= 1.0,
      `F1 score ${report.metrics.f1Score} out of bounds [0, 1]`
    );
    assert.ok(report.summary.includes("Rank-1"), "Summary should contain Rank-1 info");
    assert.ok(report.dataset.totalCelebrities > 0, "totalCelebrities > 0");
    assert.ok(report.dataset.totalBuckets > 0, "totalBuckets > 0");
    assert.ok(report.metrics.uniqueDescriptorCount > 0, "uniqueDescriptorCount > 0");
  });
});

