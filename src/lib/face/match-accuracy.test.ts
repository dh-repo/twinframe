import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { evaluateMatchAccuracy, type EvaluationReport } from "../../../scripts/evaluate-match-accuracy.ts";
import { distanceToMatchPercent } from "./embeddings.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";

describe("Face Match Accuracy & Cross-Demographic Automated Evaluation (M4)", () => {
  let report: EvaluationReport;
  let duration: number;

  before(async () => {
    const start = performance.now();
    report = await evaluateMatchAccuracy({
      fastMode: true,
      verbose: false,
      protocol: "perturbed-query",
      targetRank1Pct: 95.0,
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

  it("verifies Top-1 celebrity match accuracy on ground-truth benchmark pairs exceeds 95.0%", () => {
    assert.equal(report.protocol, "perturbed-query");
    assert.ok(
      report.metrics.meanPositiveDistance > 0.01,
      `d_pos must be > 0.01 under honest protocol (got ${report.metrics.meanPositiveDistance})`,
    );
    assert.ok(
      report.metrics.rank1Accuracy >= 95.0,
      `Rank-1 accuracy (${report.metrics.rank1Accuracy.toFixed(2)}%) below required 95.0% threshold`
    );
    assert.ok(
      report.metrics.rank1AccuracyPct >= 95.0,
      `Rank-1 accuracy pct (${report.metrics.rank1AccuracyPct.toFixed(2)}%) below required 95.0% threshold`
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

  it("verifies poor match pairs (d > 0.40) yield < 25% similarity or return No Close Match", () => {
    const poorUser: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.88),
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
          descriptor: Array.from(new Float32Array(128).fill(0.1)),
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
