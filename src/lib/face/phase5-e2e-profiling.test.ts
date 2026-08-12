import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as tf from "@tensorflow/tfjs";
import "./synthetic-fixtures.ts";
import { evaluateMatchAccuracy } from "../../../scripts/evaluate-match-accuracy.ts";
import { applyLocalContrastBoost, detectFacesOnly } from "./faceapi-engine.ts";
import { generateSunsetCanvas } from "./synthetic-fixtures.ts";

describe("Phase 5: E2E Golden Path & TF.js Memory Profiling Suite", () => {
  it("E2E-01: honest perturbed-query Rank-1 >= 90% with d_pos > 0 (no clone free-wins)", async () => {
    const report = await evaluateMatchAccuracy({
      fastMode: true,
      verbose: false,
      protocol: "perturbed-query",
      targetRank1Pct: 90.0,
    });

    assert.equal(report.protocol, "perturbed-query", "Must use honest perturbed-query protocol");
    assert.equal(
      report.metrics.protocol,
      "perturbed-query",
      "Metrics must record perturbed-query protocol",
    );
    assert.ok(
      report.metrics.meanPositiveDistance > 0.01,
      `d_pos (${report.metrics.meanPositiveDistance}) must be > 0.01 under honest protocol (clone free-wins forbidden)`,
    );
    assert.ok(
      report.metrics.rank1AccuracyPct >= 90.0,
      `Rank-1 match accuracy (${report.metrics.rank1AccuracyPct.toFixed(2)}%) below honest 90.0% floor`,
    );
    assert.ok(
      report.metrics.separationGap > 0,
      `Separation gap must be positive (got ${report.metrics.separationGap})`,
    );
    assert.ok(
      report.passedBenchmark,
      `passedBenchmark should be true under honest protocol (summary: ${report.summary})`,
    );
    assert.ok(
      report.metrics.sameIdCloneRate > 0.5,
      "Gallery integrity: pre-collapse same-id clone rate documents residual encoding debt",
    );
    assert.ok(
      report.dataset.totalBuckets <= 1100,
      `Post-collapse gallery should be ~1 bucket/id (got ${report.dataset.totalBuckets})`,
    );
  });

  it("E2E-02: zero TF.js tensor leaks across full detect+describe+rank pipeline (100 iters)", async () => {
    await tf.ready();
    const { detectAndDescribe } = await import("./faceapi-engine.ts");
    const { rankByDescriptor } = await import("./match.ts");
    const { loadCelebrityEmbeddings } = await import("./embeddings.ts");
    const { generateSyntheticFaceCanvas } = await import("./synthetic-fixtures.ts");

    const canvas = generateSyntheticFaceCanvas(480, 480, 240, 240, 120);
    const gallery = await loadCelebrityEmbeddings();

    // Positive control: allocate then dispose to prove tf.memory() is live
    const probeBefore = tf.memory().numTensors;
    const probe = tf.tensor1d([1, 2, 3, 4]);
    assert.ok(
      tf.memory().numTensors > probeBefore,
      "Positive control: allocating a tensor must increase numTensors",
    );
    probe.dispose();
    assert.equal(
      tf.memory().numTensors,
      probeBefore,
      "Positive control: disposing probe must restore tensor count",
    );

    // Warmup: full describe path (may return null without FaceNet nets — still runs detect)
    for (let i = 0; i < 2; i++) {
      const det = await detectAndDescribe(canvas as any, { enableContrastBoost: true });
      if (det) {
        rankByDescriptor(
          {
            descriptor: det.descriptor,
            age: det.age,
            gender: det.gender,
            genderProbability: det.genderProbability,
            features: undefined,
            headPose: undefined,
          },
          gallery,
          5,
        );
      }
    }

    const baselineTensors = tf.memory().numTensors;

    // 100 full pipeline iterations (detect+describe+rank) — heavier than CLAHE-only
    for (let i = 0; i < 100; i++) {
      const det = await detectAndDescribe(canvas as any, { enableContrastBoost: true });
      if (det) {
        rankByDescriptor(
          {
            descriptor: det.descriptor,
            age: det.age,
            gender: det.gender,
            genderProbability: det.genderProbability,
            detConfidence: det.confidence,
            sharpness: det.sharpness,
          },
          gallery,
          5,
        );
      }
    }

    const finalTensors = tf.memory().numTensors;
    assert.equal(
      finalTensors,
      baselineTensors,
      `TF.js tensor leak after full pipeline! Leaked ${finalTensors - baselineTensors} tensors`,
    );
  });

  it("E2E-02b: CLAHE + detectFacesOnly 1,000-iter shell still returns to baseline", async () => {
    await tf.ready();
    const canvas = generateSunsetCanvas(320, 240);
    for (let i = 0; i < 3; i++) {
      const boosted = applyLocalContrastBoost(canvas as any, 2.5, 6, 384);
      await detectFacesOnly(boosted as any, { enableContrastBoost: false });
    }
    const baselineTensors = tf.memory().numTensors;
    for (let i = 0; i < 1000; i++) {
      const boosted = applyLocalContrastBoost(canvas as any, 2.5, 6, 384);
      await detectFacesOnly(boosted as any, { enableContrastBoost: false });
    }
    assert.equal(
      tf.memory().numTensors,
      baselineTensors,
      `CLAHE+detect shell leaked ${tf.memory().numTensors - baselineTensors} tensors`,
    );
  });

  it("E2E-03: asserts CLAHE + detect 100-batch execution SLA stays under 5,000ms", async () => {
    const canvas = generateSunsetCanvas(640, 480);

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const boosted = applyLocalContrastBoost(canvas as any, 2.5, 6, 384);
      await detectFacesOnly(boosted as any, { enableContrastBoost: true, maxSide: 640 });
    }
    const elapsed = performance.now() - start;

    assert.ok(
      elapsed < 5000,
      `100-batch execution took ${elapsed.toFixed(2)}ms, exceeding 5,000ms SLA limit`,
    );
  });
});
