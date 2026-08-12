import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { evaluateMatchAccuracy, type EvaluationReport } from "../../../scripts/evaluate-match-accuracy.ts";

describe("Face Match Accuracy Automated Evaluation (M1)", () => {
  let report: EvaluationReport;
  let duration: number;

  before(async () => {
    const start = performance.now();
    report = await evaluateMatchAccuracy({
      fastMode: true,
      verbose: false,
      protocol: "perturbed-query",
      targetRank1Pct: 90.0,
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

  it("verifies honest perturbed-query Rank-1 meets or exceeds 90.0% floor", () => {
    assert.equal(report.protocol, "perturbed-query");
    assert.ok(
      report.metrics.meanPositiveDistance > 0.01,
      `d_pos must be > 0.01 under honest protocol (got ${report.metrics.meanPositiveDistance})`,
    );
    assert.ok(
      report.metrics.rank1Accuracy >= 90.0,
      `Rank-1 accuracy (${report.metrics.rank1Accuracy.toFixed(2)}%) below honest 90.0% floor`
    );
    assert.ok(
      report.metrics.rank1AccuracyPct >= 90.0,
      `Rank-1 accuracy pct (${report.metrics.rank1AccuracyPct.toFixed(2)}%) below honest 90.0% floor`
    );
  });

  it("verifies distance separation gap is positive (d_neg > d_pos)", () => {
    assert.ok(
      report.metrics.separationGap > 0,
      `Separation gap Delta (${report.metrics.separationGap.toFixed(4)}) must be strictly positive`
    );
    assert.ok(
      report.metrics.meanNegativeDistance > report.metrics.meanPositiveDistance,
      `d_neg (${report.metrics.meanNegativeDistance.toFixed(4)}) must exceed d_pos (${report.metrics.meanPositiveDistance.toFixed(4)})`
    );
    assert.ok(
      report.metrics.meanNegDistance > report.metrics.meanPosDistance,
      `meanNegDistance (${report.metrics.meanNegDistance.toFixed(4)}) must exceed meanPosDistance (${report.metrics.meanPosDistance.toFixed(4)})`
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
