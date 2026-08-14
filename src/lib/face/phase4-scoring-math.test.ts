import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
  distanceToMatchPercent,
  calibratedAgeGapPenalty,
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

  describe("Requirement R2: Calibrated Age-Gap Penalty Exact Mathematical Calibration", () => {
    it("[R2-01] verifies exact numerical calibration grid from Survey Report 4.3", () => {
      // 1. Strong match (d=0.35) -> 0.0
      assert.equal(calibratedAgeGapPenalty(0.35, 45, 20), 0.0);
      // 2. Weak match with close age (Δage=3) -> 0.0
      assert.equal(calibratedAgeGapPenalty(0.44, 45, 42), 0.0);
      // 3. Borderline (d=0.41, Δage=25, uAge=45): 0.22 * sqrt(0.1) * (5/20)^0.8 * 1.0 ≈ 0.022950
      const p41 = calibratedAgeGapPenalty(0.41, 45, 20);
      assert.ok(Math.abs(p41 - 0.022950) < 1e-4, `Expected ~0.022950, got ${p41}`);
      // 4. Weak match (d=0.42, Δage=25, uAge=45): 0.22 * sqrt(0.2) * (5/20)^0.8 * 1.0 ≈ 0.032456
      const p42 = calibratedAgeGapPenalty(0.42, 45, 20);
      assert.ok(Math.abs(p42 - 0.032456) < 1e-4, `Expected ~0.032456, got ${p42}`);
      // 5. Weak match (d=0.42, Δage=28, uAge=48): 0.22 * sqrt(0.2) * (8/20)^0.8 * 1.0 ≈ 0.047270
      const p48_20 = calibratedAgeGapPenalty(0.42, 48, 20);
      assert.ok(Math.abs(p48_20 - 0.047270) < 1e-4, `Expected ~0.047270, got ${p48_20}`);
      // 6. Weak match (d=0.43, Δage=30, uAge=50): 0.22 * sqrt(0.3) * (10/20)^0.8 * 1.0 ≈ 0.069208
      const p50_20 = calibratedAgeGapPenalty(0.43, 50, 20);
      assert.ok(Math.abs(p50_20 - 0.069208) < 1e-4, `Expected ~0.069208, got ${p50_20}`);
      // 7. Weak match (d=0.44, Δage=35, uAge=55): 0.22 * sqrt(0.4) * (15/20)^0.8 * 1.0 ≈ 0.110535
      const p55_20 = calibratedAgeGapPenalty(0.44, 55, 20);
      assert.ok(Math.abs(p55_20 - 0.110535) < 1e-4, `Expected ~0.110535, got ${p55_20}`);
      // 8. Large gap (d=0.46, Δage=45, uAge=65): 0.22 * sqrt(0.6) * 1.0 * 1.0 ≈ 0.170411
      const p65_20 = calibratedAgeGapPenalty(0.46, 65, 20);
      assert.ok(Math.abs(p65_20 - 0.170411) < 1e-4, `Expected ~0.170411, got ${p65_20}`);
      // 9. Young user with older candidate (uAge=20, cAge=50, d=0.45): 0.22 * sqrt(0.5) * (10/20)^0.8 * 0.5 ≈ 0.044674
      const p20_50 = calibratedAgeGapPenalty(0.45, 20, 50);
      assert.ok(Math.abs(p20_50 - 0.044674) < 1e-4, `Expected ~0.044674, got ${p20_50}`);
    });

    it("[R2-02] preserves twin invariance (d <= 0.40) and age-peer invariance (|Δage| <= 20)", () => {
      for (let d = 0.0; d <= 0.40; d += 0.05) {
        assert.equal(calibratedAgeGapPenalty(d, 60, 20), 0.0);
        assert.equal(calibratedAgeGapPenalty(d, 20, 60), 0.0);
      }
      for (let delta = 0; delta <= 20; delta += 2) {
        assert.equal(calibratedAgeGapPenalty(0.45, 45, 45 - delta), 0.0);
        assert.equal(calibratedAgeGapPenalty(0.45, 45, 45 + delta), 0.0);
      }
    });

    it("[R2-03] exhibits continuous boundary transition with no jump discontinuity", () => {
      const epsD = 1e-4;
      const pAt40 = calibratedAgeGapPenalty(0.40, 50, 20);
      const pJustAbove40 = calibratedAgeGapPenalty(0.40 + epsD, 50, 20);
      assert.equal(pAt40, 0.0);
      assert.ok(pJustAbove40 > 0.0 && pJustAbove40 < 1e-2);

      const epsAge = 0.01;
      const pAt20 = calibratedAgeGapPenalty(0.45, 45, 25);
      const pJustAbove20 = calibratedAgeGapPenalty(0.45, 45, 25 - epsAge);
      assert.equal(pAt20, 0.0);
      assert.ok(pJustAbove20 > 0.0 && pJustAbove20 < 1e-2);
    });

    it("[R2-04] guarantees bounded ceiling P_age <= 0.22", () => {
      assert.equal(calibratedAgeGapPenalty(1.0, 80, 18), 0.22);
      assert.equal(calibratedAgeGapPenalty(2.0, 90, 18), 0.22);
      assert.ok(calibratedAgeGapPenalty(0.48, 55, 20) <= 0.22);
    });

    it("[R2-05] safely handles invalid/missing inputs (NaN, null, undefined, negative values)", () => {
      assert.equal(calibratedAgeGapPenalty(NaN, 50, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, NaN, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, 50, NaN), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, null, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, 50, null), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, undefined, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, 50, undefined), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, -5, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, 50, -5), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, 0, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, 50, 0), 0.0);
    });
  });
});
