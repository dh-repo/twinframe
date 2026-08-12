import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
  distanceToMatchPercent,
} from "./embeddings.ts";

describe("Phase 4: Scoring Math & Hill Curve Exact Calibration Suite", () => {
  describe("ALG-01: Hybrid Ensemble Distance Calibration", () => {
    it("[ALG-01] calculates Dist = 0.90E + 0.42C for identical vectors (d=0)", () => {
      const v1 = [0.1, 0.2, 0.3, 0.4];
      const euc = euclideanDistance(v1, v1);
      const cos = cosineDistance(v1, v1);
      const ens = ensembleDistance(v1, v1);

      assert.ok(Math.abs(euc) < 1e-9, `Expected ~0, got ${euc}`);
      assert.ok(Math.abs(cos) < 1e-9, `Expected ~0, got ${cos}`);
      assert.ok(Math.abs(ens) < 1e-9, `Expected ~0, got ${ens}`);
    });

    it("[ALG-01] calculates Dist = 0.90E + 0.42C for orthogonal vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      const euc = euclideanDistance(v1, v2); // sqrt(2) ≈ 1.41421356
      const cos = cosineDistance(v1, v2); // 1.0
      const expected = 0.90 * euc + 0.42 * cos; // ≈ 1.6927922

      const actual = ensembleDistance(v1, v2);
      assert.ok(Math.abs(actual - expected) < 1e-6, `Expected ${expected}, got ${actual}`);
    });

    it("[ALG-01] calculates Dist = 0.90E + 0.42C for anti-parallel vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [-1, 0, 0];
      const euc = euclideanDistance(v1, v2); // 2.0
      const cos = cosineDistance(v1, v2); // 2.0
      const expected = 0.90 * 2.0 + 0.42 * 2.0; // 2.64

      const actual = ensembleDistance(v1, v2);
      assert.ok(Math.abs(actual - expected) < 1e-6, `Expected ${expected}, got ${actual}`);
    });
  });

  describe("Hill Curve Exact Calibration (CUR-01 to CUR-04)", () => {
    it("[CUR-01] distance d = 0.0 produces 100.0%", () => {
      const res = distanceToMatchPercent(0.0);
      assert.equal(res, 100.0, `Expected 100.0 at d=0.0, got ${res}`);
    });

    it("[CUR-02] distance d = 0.32 produces half-saturation exact value 57.5%", () => {
      // Unrounded: 15.0 + 85.0 / (1 + (0.32/0.32)^3.5) = 15.0 + 42.5 = 57.5
      const res = distanceToMatchPercent(0.32);
      assert.equal(res, 57.5, `Expected 57.5 at d=0.32, got ${res}`);
    });

    it("[CUR-03] distance d = 1.0 evaluates formula value ~16.5% (unrounded 16.5469% vs rounded 16.5%)", () => {
      // Formula unrounded: 15.0 + 85.0 / (1 + (1.0/0.32)^3.5) = 16.546918...%
      const raw = 15.0 + 85.0 / (1 + Math.pow(1.0 / 0.32, 3.5));
      assert.ok(Math.abs(raw - 16.546918) < 1e-5, `Expected ~16.546918, got ${raw}`);

      const res = distanceToMatchPercent(1.0);
      // Formatted/rounded result to 1 decimal place is 16.5%
      assert.equal(res, 16.5, `Expected 16.5 at d=1.0, got ${res}`);
      // Also verify within +-0.1% of 16.5%
      assert.ok(Math.abs(res - 16.5) <= 0.1, `Value ${res} outside +-0.1% tolerance of 16.5%`);
    });

    it("[CUR-04] distance d = 2.0 evaluates formula value ~15.1% (unrounded 15.1390% vs rounded 15.1%)", () => {
      // Formula unrounded: 15.0 + 85.0 / (1 + (2.0/0.32)^3.5) = 15.139036...%
      const raw = 15.0 + 85.0 / (1 + Math.pow(2.0 / 0.32, 3.5));
      assert.ok(Math.abs(raw - 15.139036) < 1e-5, `Expected ~15.139036, got ${raw}`);

      const res = distanceToMatchPercent(2.0);
      // Formatted/rounded result to 1 decimal place is 15.1%
      assert.equal(res, 15.1, `Expected 15.1 at d=2.0, got ${res}`);
      // Verify within +-0.1% tolerance
      assert.ok(Math.abs(res - 15.1) <= 0.1, `Value ${res} outside +-0.1% tolerance of 15.1%`);
    });

    it("verifies range bounds [15.0, 100.0] and non-increasing monotonicity", () => {
      let prev = distanceToMatchPercent(0);
      for (let d = 0; d <= 5.0; d += 0.01) {
        const curr = distanceToMatchPercent(d);
        assert.ok(curr >= 15.0 && curr <= 100.0, `Out of bounds at d=${d}: ${curr}`);
        assert.ok(curr <= prev, `Monotonicity violation at d=${d}: prev=${prev}, curr=${curr}`);
        prev = curr;
      }
    });
  });
});
