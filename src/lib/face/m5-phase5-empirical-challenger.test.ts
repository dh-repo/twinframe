import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as tf from "@tensorflow/tfjs";
import "./synthetic-fixtures.ts";
import {
  evaluateMatchAccuracy,
  CANONICAL_CELEB_MAP,
} from "../../../scripts/evaluate-match-accuracy.ts";
import { applyLocalContrastBoost, detectFacesOnly } from "./faceapi-engine.ts";
import { generateSunsetCanvas } from "./synthetic-fixtures.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";

describe("Phase 5: Empirical Challenger Stress & Verification Suite (M5 R3)", () => {
  describe("Challenge E2E-01: Genuine Rank-1 Match Accuracy & Integrity Audit", () => {
    it("audits CANONICAL_CELEB_MAP for zero fake equivalence mappings", () => {
      const keys = Object.keys(CANONICAL_CELEB_MAP);
      // Assert CANONICAL_CELEB_MAP only contains genuine spelling corrections
      assert.ok(keys.length <= 5, "CANONICAL_CELEB_MAP must not contain excessive equivalence mappings");
      
      for (const [key, val] of Object.entries(CANONICAL_CELEB_MAP)) {
        const normKey = key.replace(/[-_]/g, "").toLowerCase();
        const normVal = val.replace(/[-_]/g, "").toLowerCase();
        // Check string similarity to ensure it's a spelling correction, not cross-person mapping
        const isSpellingCorrection = normKey.includes("gwenyth") && normVal.includes("gwyneth");
        assert.ok(
          isSpellingCorrection,
          `Illegal cross-person mapping found in CANONICAL_CELEB_MAP: "${key}" -> "${val}"`
        );
      }
    });

    it("verifies rankByDescriptor does not utilize target ID cheats or leak query metadata", () => {
      const queryWithoutId: UserFaceQuery = {
        descriptor: new Float32Array(128).fill(0.1),
        age: 35,
        gender: "female",
        genderProbability: 0.95,
        detConfidence: 0.92,
        sharpness: 85,
        faceCoverage: 0.25,
      };

      const dummyGallery = [
        {
          id: "celeb-a",
          name: "Celeb A",
          path: "/a.jpg",
          descriptor: Array.from(new Float32Array(128).fill(0.1)),
          age: 35,
          gender: "female" as const,
          genderProb: 0.95,
        },
        {
          id: "celeb-b",
          name: "Celeb B",
          path: "/b.jpg",
          descriptor: Array.from(new Float32Array(128).fill(0.9)),
          age: 50,
          gender: "male" as const,
          genderProb: 0.90,
        },
      ];

      const matches = rankByDescriptor(queryWithoutId, dummyGallery, 2);
      assert.ok(matches.length > 0, "rankByDescriptor should return matches for valid query");
      assert.equal(matches[0]?.celebrityId, "celeb-a", "Pure descriptor math should correctly rank celeb-a first");
    });

    it("empirically confirms honest perturbed-query Rank-1 >= 90% with d_pos > 0", async () => {
      const report = await evaluateMatchAccuracy({
        fastMode: true,
        verbose: false,
        protocol: "perturbed-query",
        targetRank1Pct: 90.0,
      });
      assert.equal(report.protocol, "perturbed-query");
      assert.ok(
        report.metrics.meanPositiveDistance > 0.01,
        `d_pos must exceed 0.01 (got ${report.metrics.meanPositiveDistance})`,
      );
      assert.ok(
        report.metrics.rank1AccuracyPct >= 90.0,
        `Expected Rank-1 >= 90% under honest protocol, got ${report.metrics.rank1AccuracyPct}`,
      );
      assert.ok(report.passedBenchmark, "passedBenchmark must pass honest gate");
      assert.ok(
        report.metrics.sameIdCloneRate < 0.05,
        `Post re-encode: same-id multi-bucket clones should be gone (got ${(report.metrics.sameIdCloneRate * 100).toFixed(1)}%)`,
      );
    });
  });

  describe("Challenge E2E-02: Empirical TF.js Tensor Allocation & Memory Leak Verification", () => {
    it("empirically measures zero net tensor growth across 1,000 iterations of real pipeline execution", async () => {
      await tf.ready();
      const canvas = generateSunsetCanvas(320, 240);

      // Warmup phase (3 iterations) to allocate static graph weights
      for (let i = 0; i < 3; i++) {
        const boosted = applyLocalContrastBoost(canvas as any, 2.5, 6, 384);
        await detectFacesOnly(boosted as any, { enableContrastBoost: false });
      }

      const baselineTensors = tf.memory().numTensors;
      const baselineBytes = tf.memory().numBytes;

      for (let i = 0; i < 1000; i++) {
        const boosted = applyLocalContrastBoost(canvas as any, 2.5, 6, 384);
        await detectFacesOnly(boosted as any, { enableContrastBoost: false });
      }

      const finalTensors = tf.memory().numTensors;
      const finalBytes = tf.memory().numBytes;
      const leakedTensors = finalTensors - baselineTensors;
      const leakedBytes = finalBytes - baselineBytes;

      assert.equal(
        leakedTensors,
        0,
        `TF.js tensor memory leak detected! Leaked ${leakedTensors} tensors after 1,000 iterations (baseline=${baselineTensors}, final=${finalTensors})`
      );
      assert.equal(
        leakedBytes,
        0,
        `TF.js byte memory leak detected! Leaked ${leakedBytes} bytes after 1,000 iterations`
      );
    });
  });

  describe("Challenge E2E-03: CLAHE + TinyFace 100-Batch Load & SLA Verification", () => {
    it("empirically measures CLAHE + TinyFace 100-batch execution time under load (SLA < 5,000ms)", async () => {
      const canvas = generateSunsetCanvas(640, 480);

      const startMs = performance.now();
      for (let i = 0; i < 100; i++) {
        const boosted = applyLocalContrastBoost(canvas as any, 2.5, 6, 384);
        await detectFacesOnly(boosted as any, { enableContrastBoost: true, maxSide: 640 });
      }
      const elapsedMs = performance.now() - startMs;
      const avgLatencyPerBatchMs = elapsedMs / 100;

      assert.ok(
        elapsedMs < 5000,
        `100-batch execution took ${elapsedMs.toFixed(2)}ms, exceeding the 5,000ms SLA ceiling`
      );
      assert.ok(
        avgLatencyPerBatchMs < 50,
        `Average per-batch latency ${avgLatencyPerBatchMs.toFixed(2)}ms exceeded 50ms expected threshold`
      );
    });
  });
});
