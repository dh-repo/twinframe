import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OneEuroFilter, LandmarkSmoother } from "./smoothing.ts";

describe("1 Euro Filter Landmark Temporal Smoothing Suite", () => {
  describe("1. Mathematical Correctness & 1D Scalar Filtering", () => {
    it("returns exact initial value on frame 0 (first sample)", () => {
      const filter = new OneEuroFilter();
      const val = filter.filter(100.0, 0.0);
      assert.equal(val, 100.0);
    });

    it("strongly smooths low-speed noise (jitter reduction under fc_min = 1.0 Hz)", () => {
      const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007, derCutoff: 1.0 });
      filter.filter(100.0, 0.0);
      // Simulate low-speed jitter at 60fps (dt = 0.0166s)
      const noisySample = 102.0;
      const filtered = filter.filter(noisySample, 0.0166);
      // Filtered value should suppress the 2.0 jitter, remaining close to 100.0
      assert.ok(filtered < 101.0, `Filtered value ${filtered} should suppress jitter towards 100`);
    });

    it("adapts quickly to high-speed movement (lag reduction via beta = 0.007)", () => {
      const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007, derCutoff: 1.0 });
      filter.filter(100.0, 0.0);
      filter.filter(100.5, 0.0166);

      // Sudden large jump (high velocity)
      const jumpVal = 200.0;
      const filteredJump = filter.filter(jumpVal, 0.0333);
      // Alpha should increase, moving filtered value towards 200 faster than low cutoff
      assert.ok(filteredJump > 105.0, `High speed filter value ${filteredJump} should adapt rapidly`);
    });
  });

  describe("2. Multi-dimensional 2D Landmark Array Smoothing", () => {
    it("smooths 5-point SCRFD facial landmark array across video frame sequence", () => {
      const smoother = new LandmarkSmoother();
      const frame0 = [
        { x: 100, y: 150 },
        { x: 200, y: 150 },
        { x: 150, y: 200 },
        { x: 120, y: 250 },
        { x: 180, y: 250 },
      ];

      const out0 = smoother.filterPoints2D(frame0, 0.0);
      assert.deepEqual(out0, frame0);

      const frame1 = frame0.map((pt) => ({ x: pt.x + 1.0, y: pt.y + 0.5 }));
      const out1 = smoother.filterPoints2D(frame1, 0.033);
      assert.equal(out1.length, 5);
      assert.ok(out1[0]!.x > 100 && out1[0]!.x < 101);
    });

    it("smooths 68-point facial landmark array efficiently", () => {
      const smoother = new LandmarkSmoother();
      const pts = Array.from({ length: 68 }, (_, i) => ({ x: i * 5, y: i * 10 }));
      const out0 = smoother.filterPoints2D(pts, 0.0);
      assert.equal(out0.length, 68);
    });
  });

  describe("3. Multi-dimensional 3D Landmark & Flat Buffer Support", () => {
    it("smooths 3D landmarks (x, y, z) correctly", () => {
      const smoother = new LandmarkSmoother();
      const frame3D = [{ x: 10, y: 20, z: 5 }];
      const out0 = smoother.filterPoints3D(frame3D, 0.0);
      assert.deepEqual(out0, frame3D);

      const frame3DNext = [{ x: 11, y: 21, z: 6 }];
      const out1 = smoother.filterPoints3D(frame3DNext, 0.016);
      assert.ok(out1[0]!.z > 5 && out1[0]!.z < 6);
    });

    it("filters flat Float32Array buffers without allocation overhead", () => {
      const smoother = new LandmarkSmoother();
      const buf0 = new Float32Array([10, 20, 30, 40]);
      const out0 = smoother.filterFlat(buf0, 0.0);
      assert.equal(out0.length, 4);
      assert.equal(out0[0], 10);
    });
  });

  describe("4. Edge Cases, Pause Recovery, & Reset Behavior", () => {
    it("handles zero or negative time deltas (dt <= 0) safely without NaN", () => {
      const filter = new OneEuroFilter();
      filter.filter(50.0, 0.1);
      const res = filter.filter(60.0, 0.1);
      assert.ok(Number.isFinite(res));
      assert.equal(res, 50.0);
    });

    it("auto-resets when time gap exceeds 1.0s (video pause / seek recovery)", () => {
      const filter = new OneEuroFilter();
      filter.filter(100.0, 0.0);
      filter.filter(102.0, 0.016);

      // 2-second gap (video seek/pause)
      const afterPause = filter.filter(500.0, 2.016);
      assert.equal(afterPause, 500.0, "Should reset filter state on large gap");
    });

    it("resets filter state when reset() is explicitly called", () => {
      const filter = new OneEuroFilter();
      filter.filter(100.0, 0.0);
      filter.reset();
      const fresh = filter.filter(300.0, 10.0);
      assert.equal(fresh, 300.0);
    });

    it("handles non-finite input values (NaN / Infinity) without crashing", () => {
      const filter = new OneEuroFilter();
      filter.filter(10.0, 0.0);
      const resNaN = filter.filter(NaN, 0.016);
      assert.ok(Number.isFinite(resNaN));
    });
  });
});
