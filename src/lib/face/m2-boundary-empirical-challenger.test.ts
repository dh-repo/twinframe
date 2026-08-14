import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  morphologicalDistance,
  crossDemographicMismatchPenalty,
  morphologicalAffinity,
} from "./geometry.ts";
import { emptyFeatures } from "./math.ts";
import { FEATURE_KEYS, type FaceFeatures } from "./types.ts";

function makeRandomFeatures(seed: number): FaceFeatures {
  const f: Record<string, number> = {};
  let s = seed;
  for (const k of FEATURE_KEYS) {
    s = (s * 9301 + 49297) % 233280;
    f[k] = s / 233280;
  }
  return f as unknown as FaceFeatures;
}

describe("M2 Challenger Empirical Boundary & Monotonicity Suite", () => {
  it("Task 1: Exact boundary condition assertions (0.0, 0.34, 0.35, 0.36, 0.85, 1.0)", () => {
    // Exact mathematical expectations:
    // D <= 0.35 => penalty = 0.0
    // D > 0.35 => min(0.25, 0.50 * (D - 0.35))

    const p0 = crossDemographicMismatchPenalty(0.0);
    assert.equal(p0, 0.0, `D=0.0 expected 0.0, got ${p0}`);

    const p34 = crossDemographicMismatchPenalty(0.34);
    assert.equal(p34, 0.0, `D=0.34 expected 0.0, got ${p34}`);

    const p35 = crossDemographicMismatchPenalty(0.35);
    assert.equal(p35, 0.0, `D=0.35 expected 0.0, got ${p35}`);

    const p36 = crossDemographicMismatchPenalty(0.36);
    const expectedP36 = 0.50 * (0.36 - 0.35); // 0.005
    assert.ok(
      Math.abs(p36 - expectedP36) < 1e-12,
      `D=0.36 expected ${expectedP36}, got ${p36}`
    );

    const p85 = crossDemographicMismatchPenalty(0.85);
    assert.equal(p85, 0.25, `D=0.85 expected ceiling 0.25, got ${p85}`);

    const p100 = crossDemographicMismatchPenalty(1.0);
    assert.equal(p100, 0.25, `D=1.0 expected ceiling 0.25, got ${p100}`);
  });

  it("Task 2A: Non-negative output across standard, negative, boundary, and extreme inputs", () => {
    const testDistances = [
      -100, -1.0, -0.35, -0.0001, 0.0,
      0.0000001, 0.1, 0.349999999, 0.35, 0.350000001,
      0.5, 0.8499999, 0.85, 0.8500001, 1.0,
      1.5, 10.0, 1000.0,
    ];

    for (const d of testDistances) {
      const penalty = crossDemographicMismatchPenalty(d);
      assert.ok(
        Number.isFinite(penalty),
        `Penalty for D=${d} is not finite: ${penalty}`
      );
      assert.ok(
        penalty >= 0.0,
        `Penalty for D=${d} must be non-negative, got ${penalty}`
      );
      assert.ok(
        penalty <= 0.25,
        `Penalty for D=${d} must not exceed 0.25 ceiling, got ${penalty}`
      );
    }
  });

  it("Task 2B: Strict monotonicity check across 10,000 fine-grid evaluations", () => {
    const N = 10000;
    let prevP = crossDemographicMismatchPenalty(0.0);

    for (let i = 1; i <= N; i++) {
      const d = i / N; // 0.0001 to 1.0
      const p = crossDemographicMismatchPenalty(d);

      // Monotonicity: p(d_i) >= p(d_{i-1})
      assert.ok(
        p >= prevP,
        `Monotonicity violation at d=${d}: p=${p} < prevP=${prevP}`
      );

      // Strictly increasing on (0.35, 0.85)
      if (d > 0.35 && d <= 0.85) {
        const prevD = (i - 1) / N;
        if (prevD > 0.35) {
          assert.ok(
            p > prevP,
            `Strict monotonicity failure on ramp (0.35, 0.85] at d=${d}: p=${p} <= prevP=${prevP}`
          );
        }
      }

      // Flat zero on [0.0, 0.35]
      if (d <= 0.35) {
        assert.equal(p, 0.0, `Expected 0.0 for d=${d} <= 0.35, got ${p}`);
      }

      // Flat ceiling 0.25 on [0.85, 1.0]
      if (d >= 0.85) {
        assert.equal(p, 0.25, `Expected 0.25 ceiling for d=${d} >= 0.85, got ${p}`);
      }

      prevP = p;
    }
  });

  it("Task 2C: Empirical stress test across 1,000 random feature vector pairs", () => {
    for (let i = 0; i < 1000; i++) {
      const uFeat = makeRandomFeatures(i * 2 + 1);
      const cFeat = makeRandomFeatures(i * 2 + 2);

      const dMorph = morphologicalDistance(uFeat, cFeat);
      assert.ok(
        dMorph >= 0.0 && dMorph <= 1.0,
        `dMorph out of [0, 1] range: ${dMorph} for pair ${i}`
      );

      const pScalar = crossDemographicMismatchPenalty(dMorph);
      const pVector = crossDemographicMismatchPenalty(uFeat, cFeat);

      assert.equal(
        pScalar,
        pVector,
        `Scalar vs Vector overload mismatch for pair ${i}: scalar=${pScalar}, vector=${pVector}`
      );
      assert.ok(
        pVector >= 0.0 && pVector <= 0.25,
        `Penalty out of bounds [0.0, 0.25]: ${pVector}`
      );

      // Verify affinity property clamp(1 - D_morph, 0, 1)
      const aff = morphologicalAffinity(uFeat, cFeat);
      assert.ok(
        Math.abs(aff - (1.0 - dMorph)) < 1e-12,
        `Affinity mismatch for pair ${i}: aff=${aff}, expected=${1.0 - dMorph}`
      );
    }
  });

  it("Task 2D: Missing/Null/Undefined parameter handling", () => {
    assert.equal(crossDemographicMismatchPenalty(null), 0.0);
    assert.equal(crossDemographicMismatchPenalty(undefined), 0.0);
    assert.equal(crossDemographicMismatchPenalty(null, null), 0.0);

    const f = emptyFeatures();
    // Null argument symmetry: returning 0.0 if either argument (first OR second) is null/undefined
    assert.equal(crossDemographicMismatchPenalty(f, null), 0.0);
    assert.equal(crossDemographicMismatchPenalty(null, f), 0.0);
  });
});
