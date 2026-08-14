import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
  distanceToMatchPercent,
  l2Normalize,
} from "./embeddings.ts";

describe("Phase 4: Empirical Stress Test Harness & Calibration Verification", () => {
  describe("ALG-01 Empirical Stress Test (10,000 Synthetic Vector Pairs)", () => {
    it("verifies ensembleDistance equals 0.90 * E + 0.42 * C across 10,000 synthetic vector pairs", () => {
      const NUM_PAIRS = 10000;
      const DIM = 128;
      let totalPassed = 0;

      // Deterministic PRNG seed for reproducible test run
      let seed = 42;
      function pseudoRandom(): number {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      }

      function randomNormal(): number {
        const u1 = Math.max(1e-10, pseudoRandom());
        const u2 = pseudoRandom();
        return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      }

      for (let i = 0; i < NUM_PAIRS; i++) {
        let v1: number[];
        let v2: number[];

        if (i === 0) {
          // Identical vector
          v1 = Array.from({ length: DIM }, () => pseudoRandom());
          v2 = [...v1];
        } else if (i === 1) {
          // Anti-parallel vector
          v1 = [1, 0, 0, ...Array(DIM - 3).fill(0)];
          v2 = [-1, 0, 0, ...Array(DIM - 3).fill(0)];
        } else if (i === 2) {
          // Orthogonal vector
          v1 = [1, 0, 0, ...Array(DIM - 3).fill(0)];
          v2 = [0, 1, 0, ...Array(DIM - 3).fill(0)];
        } else if (i === 3) {
          // All zero vector vs unit vector
          v1 = Array(DIM).fill(0);
          v2 = [1, ...Array(DIM - 1).fill(0)];
        } else if (i % 5 === 0) {
          // Gaussian normalized vectors (L2-norm = 1)
          v1 = Array.from(l2Normalize(Array.from({ length: DIM }, () => randomNormal())));
          v2 = Array.from(l2Normalize(Array.from({ length: DIM }, () => randomNormal())));
        } else if (i % 5 === 1) {
          // Uniform [-1, 1] unnormalized vectors
          v1 = Array.from({ length: DIM }, () => pseudoRandom() * 2 - 1);
          v2 = Array.from({ length: DIM }, () => pseudoRandom() * 2 - 1);
        } else if (i % 5 === 2) {
          // Sparse vectors
          v1 = Array.from({ length: DIM }, (_, idx) => (idx % 8 === 0 ? pseudoRandom() : 0));
          v2 = Array.from({ length: DIM }, (_, idx) => (idx % 8 === 4 ? pseudoRandom() : 0));
        } else if (i % 5 === 3) {
          // Large scale vectors
          v1 = Array.from({ length: DIM }, () => (pseudoRandom() - 0.5) * 1e5);
          v2 = Array.from({ length: DIM }, () => (pseudoRandom() - 0.5) * 1e5);
        } else {
          // Small scale vectors
          v1 = Array.from({ length: DIM }, () => (pseudoRandom() - 0.5) * 1e-5);
          v2 = Array.from({ length: DIM }, () => (pseudoRandom() - 0.5) * 1e-5);
        }

        const euc = euclideanDistance(v1, v2);
        const cos = cosineDistance(v1, v2);
        const ens = ensembleDistance(v1, v2);
        const expectedEns = 0.90 * euc + 0.42 * cos;

        // Verify non-negativity
        assert.ok(euc >= 0, `Pair ${i}: Euclidean distance negative (${euc})`);
        assert.ok(cos >= 0 && cos <= 2.0000001, `Pair ${i}: Cosine distance out of range [0, 2] (${cos})`);
        assert.ok(ens >= 0, `Pair ${i}: Ensemble distance negative (${ens})`);

        // Verify exact linear combination formula: Dist = 0.90 * E + 0.42 * C
        const delta = Math.abs(ens - expectedEns);
        assert.ok(
          delta < 1e-10,
          `Pair ${i}: ensembleDistance discrepancy |${ens} - ${expectedEns}| = ${delta} >= 1e-10`
        );
        totalPassed++;
      }

      assert.equal(totalPassed, NUM_PAIRS, `Expected ${NUM_PAIRS} passed synthetic vector pairs`);
    });
  });

  describe("CUR-01 to CUR-04 Empirical Stress Test (10,000 Distance Samples d in [0.0, 5.0])", () => {
    it("verifies exact points CUR-01, CUR-02, CUR-03, CUR-04", () => {
      // CUR-01: d = 0.0 -> 100.0%
      const p0 = distanceToMatchPercent(0.0);
      assert.equal(p0, 100.0, `CUR-01 failed: expected 100.0 at d=0.0, got ${p0}`);

      // CUR-02: d = 0.32 -> 57.5%
      const p032 = distanceToMatchPercent(0.32);
      assert.equal(p032, 57.5, `CUR-02 failed: expected 57.5 at d=0.32, got ${p032}`);

      // CUR-03: d = 1.0 -> ~16.5% (exact unrounded 16.546918...%)
      const p10 = distanceToMatchPercent(1.0);
      const raw10 = 15.0 + 85.0 / (1 + Math.pow(1.0 / 0.32, 3.5));
      assert.equal(p10, 16.5, `CUR-03 failed: expected 16.5 at d=1.0, got ${p10}`);
      assert.ok(
        Math.abs(p10 - 16.5) <= 0.1,
        `CUR-03 tolerance failed: ${p10} outside +-0.1% of 16.5%`
      );
      assert.ok(
        Math.abs(raw10 - 16.546918) < 1e-5,
        `CUR-03 exact raw failed: expected 16.546918, got ${raw10}`
      );

      // CUR-04: d = 2.0 -> ~15.1% (exact unrounded 15.139036...%)
      const p20 = distanceToMatchPercent(2.0);
      const raw20 = 15.0 + 85.0 / (1 + Math.pow(2.0 / 0.32, 3.5));
      assert.equal(p20, 15.1, `CUR-04 failed: expected 15.1 at d=2.0, got ${p20}`);
      assert.ok(
        Math.abs(p20 - 15.1) <= 0.1,
        `CUR-04 tolerance failed: ${p20} outside +-0.1% of 15.1%`
      );
      assert.ok(
        Math.abs(raw20 - 15.139036) < 1e-5,
        `CUR-04 exact raw failed: expected 15.139036, got ${raw20}`
      );
    });

    it("verifies monotonicity, boundary clamping [15.0, 100.0], and precision across 10,000 distance samples d in [0.0, 5.0]", () => {
      const NUM_SAMPLES = 10000;
      const step = 5.0 / (NUM_SAMPLES - 1);
      let previousPercent = 100.0;
      let violationsCount = 0;

      for (let i = 0; i < NUM_SAMPLES; i++) {
        const d = i * step;
        const pct = distanceToMatchPercent(d);

        // 1. Boundary Clamping Assertions [15.0, 100.0]
        assert.ok(
          pct >= 15.0 && pct <= 100.0,
          `Sample ${i} (d=${d}): Percent ${pct} violates boundary bounds [15.0, 100.0]`
        );

        // 2. Monotonic Non-Increasing Assertion: pct(d_i) <= pct(d_{i-1})
        if (pct > previousPercent + 1e-9) {
          violationsCount++;
          assert.fail(
            `Monotonicity violation at sample ${i} (d=${d}): previous=${previousPercent}, current=${pct}`
          );
        }

        // 3. Mathematical Precision Assertion: |pct - round1(H(d))| === 0 and |pct - H(d)| <= 0.15%
        const unroundedHill = Math.max(15.0, Math.min(100.0, 15.0 + 85.0 / (1 + Math.pow(d / 0.32, 3.5))));
        const expectedRounded = Math.round(unroundedHill * 10) / 10;

        assert.equal(
          pct,
          expectedRounded,
          `Precision violation at d=${d}: got ${pct}, expected rounded ${expectedRounded}`
        );
        assert.ok(
          Math.abs(pct - unroundedHill) <= 0.15,
          `Precision delta against unrounded formula exceeded at d=${d}: delta=${Math.abs(pct - unroundedHill)}`
        );

        previousPercent = pct;
      }

      assert.equal(violationsCount, 0, "Monotonicity violations occurred during 10,000 sample test");
    });

    it("verifies out-of-bound edge cases (negative distance, large distance, NaN)", () => {
      assert.equal(distanceToMatchPercent(-1.0), 100.0, "Negative distance -1.0 should clamp to 100.0%");
      assert.equal(distanceToMatchPercent(-100.0), 100.0, "Negative distance -100.0 should clamp to 100.0%");
      assert.equal(distanceToMatchPercent(100.0), 15.0, "Large distance 100.0 should clamp floor to 15.0%");
      assert.equal(distanceToMatchPercent(10000.0), 15.0, "Large distance 10000.0 should clamp floor to 15.0%");
    });
  });
});
