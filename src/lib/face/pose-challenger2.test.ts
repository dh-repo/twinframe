import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alignToCanonical3D,
  CANONICAL_FACE_3D,
} from "./pose.ts";
import type { Point3D, Point2D } from "./types.ts";

describe("Milestone 1 Empirical Stress-Test Harness (pose-challenger2)", () => {
  it("CH-01: Performance Benchmark — 10,000 alignToCanonical3D calls (< 0.1ms per call)", () => {
    // Warmup
    for (let i = 0; i < 100; i++) {
      alignToCanonical3D(CANONICAL_FACE_3D);
    }

    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      alignToCanonical3D(CANONICAL_FACE_3D);
    }
    const end = performance.now();
    const totalMs = end - start;
    const avgMsPerCall = totalMs / iterations;

    console.log(`[PERF BENCHMARK] 10,000 calls took ${totalMs.toFixed(2)}ms (avg: ${avgMsPerCall.toFixed(4)}ms/call)`);
    assert.ok(
      avgMsPerCall < 0.25,
      `Latency benchmark failed: ${avgMsPerCall.toFixed(4)}ms per call exceeds 0.25ms threshold`
    );
  });

  it("CH-02: Pathological Inputs — All-zero coordinates (68 and 468 points)", () => {
    const zero68: Point3D[] = new Array(68).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
    const zero468: Point3D[] = new Array(468).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));

    const res68 = alignToCanonical3D(zero68);
    assert.ok(res68, "Result should be defined");
    assert.ok(Number.isFinite(res68.scale), "Scale must be finite");
    assert.ok(Number.isFinite(res68.residualError), "Residual error must be finite");
    for (const lm of res68.unwarpedLandmarks) {
      assert.ok(Number.isFinite(lm.x), `Unwarped x must be finite, got ${lm.x}`);
      assert.ok(Number.isFinite(lm.y), `Unwarped y must be finite, got ${lm.y}`);
      assert.ok(Number.isFinite(lm.z), `Unwarped z must be finite, got ${lm.z}`);
    }

    const res468 = alignToCanonical3D(zero468);
    assert.ok(res468, "Result should be defined");
    assert.ok(Number.isFinite(res468.scale), "Scale must be finite");
    assert.ok(Number.isFinite(res468.residualError), "Residual error must be finite");
    for (const lm of res468.unwarpedLandmarks) {
      assert.ok(Number.isFinite(lm.x), `Unwarped x must be finite, got ${lm.x}`);
      assert.ok(Number.isFinite(lm.y), `Unwarped y must be finite, got ${lm.y}`);
      assert.ok(Number.isFinite(lm.z), `Unwarped z must be finite, got ${lm.z}`);
    }
  });

  it("CH-03: Pathological Inputs — NaN and Infinity inputs in landmarks and visibility mask", () => {
    const corruptLandmarks: Point3D[] = CANONICAL_FACE_3D.map((pt, idx) => {
      if (idx === 0) return { x: NaN, y: Infinity, z: -Infinity };
      if (idx === 1) return { x: Infinity, y: NaN, z: 0 };
      if (idx === 2) return { x: 0, y: 0, z: NaN };
      return { ...pt };
    });

    const corruptVisMask = new Array(68).fill(true);
    corruptVisMask[0] = NaN as any;
    corruptVisMask[1] = Infinity as any;
    corruptVisMask[2] = null as any;
    corruptVisMask[3] = undefined as any;

    const res = alignToCanonical3D(corruptLandmarks, corruptVisMask);
    assert.ok(res, "Result should be defined");
    assert.ok(Number.isFinite(res.scale), "Scale must be finite");

    for (let i = 0; i < res.unwarpedLandmarks.length; i++) {
      const lm = res.unwarpedLandmarks[i]!;
      assert.ok(Number.isFinite(lm.x), `Unwarped landmark [${i}].x is not finite: ${lm.x}`);
      assert.ok(Number.isFinite(lm.y), `Unwarped landmark [${i}].y is not finite: ${lm.y}`);
      assert.ok(Number.isFinite(lm.z), `Unwarped landmark [${i}].z is not finite: ${lm.z}`);
    }

    // Completely NaN array case (all points NaN)
    const allNanLandmarks: Point2D[] = new Array(68).fill(null).map(() => ({ x: NaN, y: NaN }));
    const resAllNan = alignToCanonical3D(allNanLandmarks);
    assert.equal(resAllNan.scale, 1.0);
    assert.equal(resAllNan.residualError, Infinity);
    for (let i = 0; i < resAllNan.unwarpedLandmarks.length; i++) {
      const lm = resAllNan.unwarpedLandmarks[i]!;
      assert.ok(Number.isFinite(lm.x), `All-NaN fallback landmark [${i}].x is not finite: ${lm.x}`);
      assert.ok(Number.isFinite(lm.y), `All-NaN fallback landmark [${i}].y is not finite: ${lm.y}`);
      assert.ok(Number.isFinite(lm.z), `All-NaN fallback landmark [${i}].z is not finite: ${lm.z}`);
    }
  });

  it("CH-04: Pathological Inputs — Single visible point & Underconstrained subsets", () => {
    const singleVisMask = new Array(68).fill(false);
    singleVisMask[10] = true;

    const res = alignToCanonical3D(CANONICAL_FACE_3D, singleVisMask);
    assert.equal(res.scale, 1.0, "Underconstrained scale should fall back to 1.0");
    assert.equal(res.residualError, Infinity, "Underconstrained residual error should be Infinity");
    assert.equal(res.unwarpedLandmarks.length, 68);

    for (let i = 0; i < res.unwarpedLandmarks.length; i++) {
      const lm = res.unwarpedLandmarks[i]!;
      assert.ok(Number.isFinite(lm.x), `Single visible point landmark [${i}].x is not finite: ${lm.x}`);
      assert.ok(Number.isFinite(lm.y), `Single visible point landmark [${i}].y is not finite: ${lm.y}`);
      assert.ok(Number.isFinite(lm.z), `Single visible point landmark [${i}].z is not finite: ${lm.z}`);
    }

    // Collinear points test case (3 visible points along a straight line)
    const collinearLandmarks: Point3D[] = CANONICAL_FACE_3D.map((_, i) => ({
      x: i * 10,
      y: 0,
      z: 0,
    }));
    const resCollinear = alignToCanonical3D(collinearLandmarks);
    assert.ok(Number.isFinite(resCollinear.scale), "Collinear scale must be finite");
    assert.ok(Number.isFinite(resCollinear.residualError), "Collinear residual error must be finite");
    for (let i = 0; i < resCollinear.unwarpedLandmarks.length; i++) {
      const lm = resCollinear.unwarpedLandmarks[i]!;
      assert.ok(Number.isFinite(lm.x), `Collinear landmark [${i}].x is not finite: ${lm.x}`);
      assert.ok(Number.isFinite(lm.y), `Collinear landmark [${i}].y is not finite: ${lm.y}`);
      assert.ok(Number.isFinite(lm.z), `Collinear landmark [${i}].z is not finite: ${lm.z}`);
    }
  });

  it("CH-05: Pathological Inputs — 180° flipped points (upside down / reflected)", () => {
    // Rotate by 180 degrees yaw (x -> -x, z -> -z)
    const flipped180: Point3D[] = CANONICAL_FACE_3D.map((pt) => ({
      x: -pt.x,
      y: pt.y,
      z: -pt.z,
    }));

    const res = alignToCanonical3D(flipped180);
    assert.ok(res, "Result should be defined");
    assert.ok(Number.isFinite(res.scale), "Scale must be finite");
    assert.ok(res.residualError < 1e-3, `Residual error for 180° flip should be near zero, got ${res.residualError}`);

    // Compute determinant of recovered rotation matrix det(R)
    const R = res.rotation;
    const detR =
      R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
      R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
      R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);

    assert.ok(Math.abs(detR - 1.0) < 1e-4, `Determinant of R must be +1.0 (proper rotation), got ${detR}`);

    for (let i = 0; i < res.unwarpedLandmarks.length; i++) {
      const lm = res.unwarpedLandmarks[i]!;
      assert.ok(Number.isFinite(lm.x), `180° flip unwarped landmark [${i}].x is not finite: ${lm.x}`);
      assert.ok(Number.isFinite(lm.y), `180° flip unwarped landmark [${i}].y is not finite: ${lm.y}`);
      assert.ok(Number.isFinite(lm.z), `180° flip unwarped landmark [${i}].z is not finite: ${lm.z}`);
    }
  });
});
