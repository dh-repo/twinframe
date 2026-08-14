import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_5_POINTS_150,
  compute5PointAffineTransform,
  applyAffineTransform2D,
  type Point2D,
} from "./geometry.ts";

/** Rotate a 2D point around a center origin by angleDeg. */
function rotatePoint2D(p: Point2D, center: Point2D, angleDeg: number): Point2D {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos),
  };
}

describe("M2 Challenger: Empirical Verification of 5-Point Affine Warp Preprocessing", () => {
  describe("1. Extreme Head Tilt Sweep & Alignment Verification", () => {
    const testTilts = [0, 25, -30, 45, -45, 90, -90, 135, -135, 180, -180];

    testTilts.forEach((tiltDeg) => {
      it(`normalizes ${tiltDeg}° in-plane tilt with horizontal eye alignment and residual < 1.0px`, () => {
        const center: Point2D = { x: 75.0, y: 75.0 };
        const tiltedSrc = CANONICAL_5_POINTS_150.map((p) => rotatePoint2D(p, center, tiltDeg));

        const transform = compute5PointAffineTransform(tiltedSrc, CANONICAL_5_POINTS_150);

        // 1. Math Invariants
        const a = transform.a;
        const b = transform.b;
        const s = transform.scale;
        const calcScale = Math.hypot(a, b);
        assert.ok(
          Math.abs(s - calcScale) < 1e-7,
          `Scale invariant failed: s=${s}, sqrt(a^2+b^2)=${calcScale}`,
        );
        assert.ok(
          Math.abs(a * a + b * b - s * s) < 1e-7,
          `Mathematical invariant a^2 + b^2 = s^2 violated: ${a * a + b * b} vs ${s * s}`,
        );

        // 2. Map source points through transform
        const mapped = tiltedSrc.map((p) => applyAffineTransform2D(p, transform));

        // 3. Compute residual errors across all 5 anchor points
        let sumSquaredErr = 0;
        let maxErr = 0;

        mapped.forEach((m, idx) => {
          const tgt = CANONICAL_5_POINTS_150[idx]!;
          const err = Math.hypot(m.x - tgt.x, m.y - tgt.y);
          sumSquaredErr += err * err;
          if (err > maxErr) maxErr = err;
        });

        const rmse = Math.sqrt(sumSquaredErr / 5);

        assert.ok(
          rmse < 1.0,
          `RMSE for tilt ${tiltDeg}° is ${rmse.toFixed(6)}px, expected < 1.0px`,
        );
        assert.ok(
          maxErr < 1.0,
          `Max residual error for tilt ${tiltDeg}° is ${maxErr.toFixed(6)}px, expected < 1.0px`,
        );

        // 4. Verify horizontal eye line alignment
        const mappedLE = mapped[0]!;
        const mappedRE = mapped[1]!;
        const eyeDeltaY = Math.abs(mappedLE.y - mappedRE.y);
        assert.ok(
          eyeDeltaY < 1e-3,
          `Eye line delta Y for tilt ${tiltDeg}° is ${eyeDeltaY.toFixed(6)}px, expected horizontal (< 0.001px)`,
        );
        assert.ok(
          Math.abs(mappedLE.y - 54.0) < 1e-3,
          `Left eye Y coordinate is ${mappedLE.y.toFixed(4)}, expected 54.0`,
        );
        assert.ok(
          Math.abs(mappedRE.y - 54.0) < 1e-3,
          `Right eye Y coordinate is ${mappedRE.y.toFixed(4)}, expected 54.0`,
        );
      });
    });
  });

  describe("2. Compound Affine Transformations (Scale + Translation + Rotation)", () => {
    it("recovers affine parameters under severe scale (0.25x to 4.0x) and translation (±500px)", () => {
      const scales = [0.25, 0.5, 1.0, 2.0, 4.0];
      const translations = [
        { tx: 100, ty: -50 },
        { tx: -250, ty: 400 },
        { tx: 500, ty: 500 },
      ];

      scales.forEach((s) => {
        translations.forEach(({ tx, ty }) => {
          // Source = target * scale + translation, then rotated 25°
          const transformedSrc = CANONICAL_5_POINTS_150.map((p) => {
            const scaled = { x: p.x * s + tx, y: p.y * s + ty };
            return rotatePoint2D(scaled, { x: 75 * s + tx, y: 75 * s + ty }, 25.0);
          });

          const transform = compute5PointAffineTransform(transformedSrc, CANONICAL_5_POINTS_150);

          // Expected scale of transform = 1 / s
          const expectedScale = 1.0 / s;
          assert.ok(
            Math.abs(transform.scale - expectedScale) < 1e-4,
            `Expected inverse scale ${expectedScale}, got ${transform.scale}`,
          );

          // Verify mapped points against canonical targets
          transformedSrc.forEach((srcPt, idx) => {
            const mapped = applyAffineTransform2D(srcPt, transform);
            const tgt = CANONICAL_5_POINTS_150[idx]!;
            const dist = Math.hypot(mapped.x - tgt.x, mapped.y - tgt.y);
            assert.ok(dist < 1e-3, `Dist to target anchor ${idx} is ${dist.toFixed(6)}px, expected < 0.001px`);
          });
        });
      });
    });
  });

  describe("3. Noise & Perturbation Residual Stress Test", () => {
    it("maintains low residual RMSE (< 1.0px) under landmark noise (±0.5px)", () => {
      // Add random noise to canonical points
      const noise = [
        { dx: 0.3, dy: -0.4 },
        { dx: -0.2, dy: 0.5 },
        { dx: 0.4, dy: 0.1 },
        { dx: -0.5, dy: -0.3 },
        { dx: 0.1, dy: 0.2 },
      ];

      const noisySrc = CANONICAL_5_POINTS_150.map((p, i) => ({
        x: p.x + noise[i]!.dx,
        y: p.y + noise[i]!.dy,
      }));

      const transform = compute5PointAffineTransform(noisySrc, CANONICAL_5_POINTS_150);
      const mapped = noisySrc.map((p) => applyAffineTransform2D(p, transform));

      let sumSq = 0;
      mapped.forEach((m, idx) => {
        const tgt = CANONICAL_5_POINTS_150[idx]!;
        const err = Math.hypot(m.x - tgt.x, m.y - tgt.y);
        sumSq += err * err;
      });

      const rmse = Math.sqrt(sumSq / 5);
      assert.ok(rmse < 1.0, `RMSE under noise = ${rmse.toFixed(4)}px, expected < 1.0px`);
    });
  });

  describe("4. Degenerate & Edge Case Handling", () => {
    it("handles zero denominator / collinear points gracefully without NaN", () => {
      // All 5 points identical
      const identicalSrc: Point2D[] = [
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
      ];

      const transform = compute5PointAffineTransform(identicalSrc, CANONICAL_5_POINTS_150);
      assert.ok(Number.isFinite(transform.a), "a must be finite");
      assert.ok(Number.isFinite(transform.b), "b must be finite");
      assert.ok(Number.isFinite(transform.tx), "tx must be finite");
      assert.ok(Number.isFinite(transform.ty), "ty must be finite");
      assert.equal(transform.scale, 1.0, "Fallback scale should be 1.0");

      const mapped = applyAffineTransform2D(identicalSrc[0]!, transform);
      assert.ok(Number.isFinite(mapped.x), "Mapped x must be finite");
      assert.ok(Number.isFinite(mapped.y), "Mapped y must be finite");
    });
  });
});
