import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";

const ROOT = process.cwd();
const CELEBS_DIR = path.resolve(ROOT, "public/celebs");
const INDEX_PATH = path.resolve(CELEBS_DIR, "index.json");
const SCRIPT_PATH = path.resolve(ROOT, "scripts/evaluate-accuracy.mjs");
const REPORT_JSON = path.resolve(ROOT, "reports/baseline-accuracy.json");

describe("Twinframe Accuracy Benchmark Evaluation Suite (M1 / R1)", () => {
  test("evaluate-accuracy.mjs exists and is executable", () => {
    assert.ok(fs.existsSync(SCRIPT_PATH), "evaluate-accuracy.mjs must exist");
    const stat = fs.statSync(SCRIPT_PATH);
    assert.ok(stat.size > 1000, "Script should have substantial implementation");
  });

  test("discovers all 268 ground truth celebrity portraits", () => {
    assert.ok(fs.existsSync(INDEX_PATH), "index.json must exist");
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    const indexIds = new Set(index.map((c) => c.id));

    const jpgFiles = fs
      .readdirSync(CELEBS_DIR)
      .filter((f) => f.endsWith(".jpg"));

    assert.ok(jpgFiles.length >= 268, "Must contain at least 268 celebrity portraits");

    let matchingCount = 0;
    for (const f of jpgFiles) {
      const id = f.replace(/\.jpg$/, "");
      if (indexIds.has(id)) matchingCount++;
    }
    assert.ok(
      matchingCount >= 268,
      "At least 268 probe portraits must match enrolled celebrity IDs in index.json"
    );
  });

  test("baseline-accuracy.json report has valid multi-tier benchmark metrics", () => {
    assert.ok(
      fs.existsSync(REPORT_JSON),
      "Baseline report JSON must exist at reports/baseline-accuracy.json"
    );
    const data = JSON.parse(fs.readFileSync(REPORT_JSON, "utf8"));

    // Verify metadata
    assert.ok(data.metadata, "Must contain metadata");
    assert.equal(data.metadata.gallerySize, 1000, "Gallery size must be 1000");
    assert.equal(
      data.metadata.groundTruthCatalogSize,
      268,
      "Catalog size must be 268"
    );

    // Verify Tier 1
    assert.ok(data.tier1, "Must contain Tier 1 metrics");
    assert.ok(data.tier1.totalProbes >= 50, "Tier 1 must have >= 50 probes");
    assert.ok(
      data.tier1.detectionRatePct >= 95.0,
      "Tier 1 detection rate must be >= 95%"
    );
    assert.ok(
      data.tier1.top1AccuracyPct >= 85.0,
      "Tier 1 Top-1 accuracy must be >= 85%"
    );
    assert.ok(
      data.tier1.top5AccuracyPct >= 95.0,
      "Tier 1 Top-5 accuracy must be >= 95%"
    );
    assert.ok(data.tier1.mrr >= 0.85, "Tier 1 MRR must be >= 0.85");

    // Verify Tier 2
    assert.ok(data.tier2, "Must contain Tier 2 metrics");
    assert.ok(data.tier2.totalProbes >= 30, "Tier 2 must have >= 30 probes");
    assert.ok(
      data.tier2.top1AccuracyPct >= 75.0,
      "Tier 2 Top-1 accuracy must be >= 75%"
    );
    assert.ok(
      data.tier2.top5AccuracyPct >= 90.0,
      "Tier 2 Top-5 accuracy must be >= 90%"
    );

    // Verify Tier 3 Margins
    assert.ok(data.tier3Margins, "Must contain Tier 3 margin metrics");
    assert.ok(
      data.tier3Margins.totalProbesAnalyzed >= 50,
      "Tier 3 must analyze >= 50 probes"
    );
    assert.ok(
      typeof data.tier3Margins.positiveMarginPct === "number",
      "Must compute positive margin percentage"
    );
    assert.ok(
      data.tier3Margins.marginStats.mean > 0,
      "Mean cosine margin must be positive"
    );

    // Verify Latency Breakdown
    assert.ok(data.latency, "Must contain latency breakdown");
    assert.ok(data.latency.tDet.mean > 0, "t_det must be measured");
    assert.ok(data.latency.tAlign.mean > 0, "t_align must be measured");
    assert.ok(data.latency.tEmb.mean > 0, "t_emb must be measured");
    assert.ok(data.latency.tMatch.mean > 0, "t_match must be measured");
    assert.ok(data.latency.tTotal.mean > 0, "t_total must be measured");
  });

  test("computeStats returns all percentile fields on empty and populated arrays without undefined or NaN", () => {
    function percentile(sortedArr, p) {
      if (!sortedArr || sortedArr.length === 0) return 0;
      const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor((p / 100) * sortedArr.length)));
      return sortedArr[idx] ?? 0;
    }
    function computeStats(values) {
      if (!values || values.length === 0) {
        return { mean: 0, std: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p99: 0 };
      }
      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      const mean = sum / sorted.length;
      const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / sorted.length;
      const std = Math.sqrt(variance);

      return {
        mean: isNaN(mean) ? 0 : mean,
        std: isNaN(std) ? 0 : std,
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        p10: percentile(sorted, 10),
        p25: percentile(sorted, 25),
        p50: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        p90: percentile(sorted, 90),
        p99: percentile(sorted, 99),
      };
    }

    const empty = computeStats([]);
    assert.equal(empty.mean, 0);
    assert.equal(empty.std, 0);
    assert.equal(empty.min, 0);
    assert.equal(empty.max, 0);
    assert.equal(empty.p10, 0);
    assert.equal(empty.p25, 0);
    assert.equal(empty.p50, 0);
    assert.equal(empty.p75, 0);
    assert.equal(empty.p90, 0);
    assert.equal(empty.p99, 0);

    // Verify .toFixed() works safely on all fields
    assert.equal(empty.p25.toFixed(4), "0.0000");
    assert.equal(empty.p75.toFixed(4), "0.0000");

    const single = computeStats([42]);
    assert.equal(single.mean, 42);
    assert.equal(single.min, 42);
    assert.equal(single.max, 42);
    assert.equal(single.p50, 42);
  });
});
