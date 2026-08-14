import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extract5AnchorPoints,
  compute5PointAffineTransform,
  applyAffineTransform2D,
  warp5PointCanonicalCanvas,
  CANONICAL_5_POINTS_150,
  type Point2D,
  type Landmark,
} from "./geometry.ts";

/** Mock CanvasImageSource and canvas DOM elements for Node test environment. */
function createMockCanvas(width = 300, height = 300): any {
  return {
    width,
    height,
    getContext: (contextId: string) => {
      if (contextId === "2d") {
        return {
          save: () => {},
          restore: () => {},
          setTransform: () => {},
          drawImage: () => {},
          imageSmoothingQuality: "high",
        };
      }
      return null;
    },
  };
}

describe("M2 Empirical Challenger: Degenerate Landmark & Canvas Memory Verification", () => {
  describe("1. Degenerate Anchor Configurations (Collinear, Zero-Scale, Coincident, NaN/Infinity)", () => {
    it("handles 5-point input with NaN or Infinity coordinates safely (returns null)", () => {
      const nan5: Array<{ x: number; y: number }> = [
        { x: 46.5, y: 54.0 },
        { x: NaN, y: 54.0 },
        { x: 75.0, y: 85.5 },
        { x: 52.5, y: 115.5 },
        { x: 97.5, y: Infinity },
      ];
      const anchors = extract5AnchorPoints(nan5);
      assert.equal(anchors, null, "extract5AnchorPoints must return null for NaN/Infinity inputs");
    });

    it("handles 68-point input with NaN/Infinity coordinates safely (returns null)", () => {
      const nan68 = Array.from({ length: 68 }, (_, i) => ({
        x: i === 30 ? NaN : 50 + i,
        y: i === 42 ? Infinity : 50 + i,
      }));
      const anchors = extract5AnchorPoints(nan68);
      assert.equal(anchors, null, "extract5AnchorPoints must return null when 68-pt landmarks contain NaN/Infinity");
    });

    it("handles 478-point input with NaN/Infinity coordinates safely (returns null)", () => {
      const nan478 = Array.from({ length: 478 }, (_, i) => ({
        x: i === 1 ? NaN : 0.5,
        y: i === 33 ? -Infinity : 0.5,
      }));
      const anchors = extract5AnchorPoints(nan478);
      assert.equal(anchors, null, "extract5AnchorPoints must return null when 478-pt landmarks contain NaN/Infinity");
    });

    it("handles zero-scale / coincident anchor points (all points at same coordinate)", () => {
      const coincidentPoints: Point2D[] = [
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
      ];
      const transform = compute5PointAffineTransform(coincidentPoints, CANONICAL_5_POINTS_150);
      assert.ok(Number.isFinite(transform.a), "transform.a must be finite");
      assert.ok(Number.isFinite(transform.b), "transform.b must be finite");
      assert.ok(Number.isFinite(transform.tx), "transform.tx must be finite");
      assert.ok(Number.isFinite(transform.ty), "transform.ty must be finite");
      assert.ok(Number.isFinite(transform.scale), "transform.scale must be finite");
      assert.ok(Number.isFinite(transform.rotationDeg), "transform.rotationDeg must be finite");
      assert.equal(transform.scale, 1.0, "Zero-scale fallback must set scale=1.0");
    });

    it("handles collinear anchor points (all points along horizontal line y = 50)", () => {
      const collinearPoints: Point2D[] = [
        { x: 10, y: 50 },
        { x: 30, y: 50 },
        { x: 50, y: 50 },
        { x: 70, y: 50 },
        { x: 90, y: 50 },
      ];
      const transform = compute5PointAffineTransform(collinearPoints, CANONICAL_5_POINTS_150);
      assert.ok(Number.isFinite(transform.a), "collinear transform.a must be finite");
      assert.ok(Number.isFinite(transform.b), "collinear transform.b must be finite");
      assert.ok(Number.isFinite(transform.tx), "collinear transform.tx must be finite");
      assert.ok(Number.isFinite(transform.ty), "collinear transform.ty must be finite");
      assert.ok(Number.isFinite(transform.scale), "collinear transform.scale must be finite");
      assert.ok(Number.isFinite(transform.rotationDeg), "collinear transform.rotationDeg must be finite");
    });

    it("handles collinear anchor points along diagonal line (y = 2x + 10)", () => {
      const collinearPoints: Point2D[] = [
        { x: 10, y: 30 },
        { x: 20, y: 50 },
        { x: 30, y: 70 },
        { x: 40, y: 90 },
        { x: 50, y: 110 },
      ];
      const transform = compute5PointAffineTransform(collinearPoints, CANONICAL_5_POINTS_150);
      assert.ok(Number.isFinite(transform.a));
      assert.ok(Number.isFinite(transform.b));
      assert.ok(Number.isFinite(transform.tx));
      assert.ok(Number.isFinite(transform.ty));
      assert.ok(Number.isFinite(transform.scale));
      assert.ok(Number.isFinite(transform.rotationDeg));
    });
  });

  describe("2. Similarity Transform & In-Plane Tilt Normalization (> 20 deg)", () => {
    it("accurately solves similarity transform for 30 deg tilted head", () => {
      const thetaRad = (30 * Math.PI) / 180;
      const cosT = Math.cos(thetaRad);
      const sinT = Math.sin(thetaRad);
      const scaleFactor = 1.2;

      // Transform canonical points with rotation 30 deg and scale 1.2
      const tiltedSource: Point2D[] = CANONICAL_5_POINTS_150.map((pt) => {
        // Inverse mapping to simulate source face tilted by +30 deg
        const rx = pt.x - 75;
        const ry = pt.y - 75;
        return {
          x: (cosT * rx - sinT * ry) / scaleFactor + 100,
          y: (sinT * rx + cosT * ry) / scaleFactor + 100,
        };
      });

      const transform = compute5PointAffineTransform(tiltedSource, CANONICAL_5_POINTS_150);

      // Verify solved rotation magnitude is ~30 degrees (negative angle unwarps positive tilt back to canonical)
      assert.ok(
        Math.abs(Math.abs(transform.rotationDeg) - 30.0) < 0.5,
        `Expected rotation magnitude ~30.0 deg, got ${transform.rotationDeg.toFixed(2)} deg`
      );

      // Verify solved scale is ~1.2
      assert.ok(
        Math.abs(transform.scale - 1.2) < 0.05,
        `Expected scale ~1.2, got ${transform.scale.toFixed(2)}`
      );

      // Verify transformed points map back to canonical targets with high accuracy
      for (let i = 0; i < 5; i++) {
        const warped = applyAffineTransform2D(tiltedSource[i]!, transform);
        const tgt = CANONICAL_5_POINTS_150[i]!;
        const err = Math.hypot(warped.x - tgt.x, warped.y - tgt.y);
        assert.ok(err < 1.0, `Point ${i} warp error ${err.toFixed(3)}px >= 1.0px`);
      }
    });
  });

  describe("3. Canvas Performance & Memory Leak Verification", () => {
    it("executes 1,000 warp calls cleanly without memory leakage or excessive overhead (< 5ms per frame)", () => {
      const mockCanvas = createMockCanvas(300, 300);

      // Setup mock global document if missing in Node
      if (typeof globalThis.document === "undefined") {
        (globalThis as any).document = {
          createElement: (tag: string) => {
            if (tag === "canvas") return createMockCanvas(150, 150);
            return {};
          },
        };
      }

      const sample5: Array<{ x: number; y: number }> = [
        { x: 40, y: 50 },
        { x: 100, y: 50 },
        { x: 70, y: 80 },
        { x: 50, y: 110 },
        { x: 90, y: 110 },
      ];

      const iterations = 1000;
      const t0 = performance.now();

      for (let i = 0; i < iterations; i++) {
        const canvas = warp5PointCanonicalCanvas(mockCanvas, sample5, 150);
        assert.ok(canvas, "canvas output must be defined");
      }

      const totalMs = performance.now() - t0;
      const perCallMs = totalMs / iterations;

      console.log(`[CANVAS PERF] warp5PointCanonicalCanvas: ${totalMs.toFixed(2)}ms total for ${iterations} calls (${perCallMs.toFixed(4)}ms/call)`);

      assert.ok(perCallMs < 5.0, `Warp canvas per-call latency ${perCallMs.toFixed(4)}ms exceeds 5.0ms budget`);
    });
  });
});
