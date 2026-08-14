import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_5_POINTS_150,
  extract5AnchorPoints,
  compute5PointAffineTransform,
  applyAffineTransform2D,
  warp5PointCanonicalCanvas,
  type Point2D,
} from "./geometry.ts";
import { createTestCanvas } from "./synthetic-fixtures.ts";

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

describe("R2: Canonical 5-Point Affine Warp Preprocessing", () => {
  describe("Canonical Anchor Point Definition & Extraction", () => {
    it("defines 5 fixed canonical reference coordinates in 150x150 space", () => {
      assert.equal(CANONICAL_5_POINTS_150.length, 5);
      const [le, re, n, lm, rm] = CANONICAL_5_POINTS_150;
      assert.deepEqual(le, { x: 46.5, y: 54.0 }, "Left eye canonical coord");
      assert.deepEqual(re, { x: 103.5, y: 54.0 }, "Right eye canonical coord");
      assert.deepEqual(n, { x: 75.0, y: 85.5 }, "Nose tip canonical coord");
      assert.deepEqual(lm, { x: 52.5, y: 115.5 }, "Left mouth corner canonical coord");
      assert.deepEqual(rm, { x: 97.5, y: 115.5 }, "Right mouth corner canonical coord");

      // Verify eye line horizontal alignment in canonical space
      assert.equal(le.y, re.y, "Canonical eye line must be perfectly horizontal (y=54.0)");
      assert.equal(le.x + re.x, 150.0, "Eyes must be symmetrically centered at x=75.0");
      assert.equal(lm.x + rm.x, 150.0, "Mouth corners must be symmetrically centered at x=75.0");
    });

    it("extracts 5 anchor points from 5-element landmark array", () => {
      const fivePts: Point2D[] = [
        { x: 40, y: 50 },
        { x: 100, y: 50 },
        { x: 70, y: 80 },
        { x: 50, y: 110 },
        { x: 90, y: 110 },
      ];
      const anchors = extract5AnchorPoints(fivePts);
      assert.ok(anchors);
      assert.equal(anchors.length, 5);
      assert.deepEqual(anchors[0], fivePts[0]);
      assert.deepEqual(anchors[1], fivePts[1]);
      assert.deepEqual(anchors[2], fivePts[2]);
      assert.deepEqual(anchors[3], fivePts[3]);
      assert.deepEqual(anchors[4], fivePts[4]);
    });

    it("extracts 5 anchor points from 68-point dlib landmarks", () => {
      const lms68 = Array.from({ length: 68 }, (_, i) => ({ x: i * 2, y: i * 3 }));
      // Set distinct eye landmarks
      for (let i = 36; i <= 41; i++) lms68[i] = { x: 40, y: 50 };
      for (let i = 42; i <= 47; i++) lms68[i] = { x: 100, y: 50 };
      lms68[30] = { x: 70, y: 85 };
      lms68[48] = { x: 50, y: 115 };
      lms68[54] = { x: 90, y: 115 };

      const anchors = extract5AnchorPoints(lms68);
      assert.ok(anchors);
      assert.equal(anchors.length, 5);
      assert.deepEqual(anchors[0], { x: 40, y: 50 }); // Left eye center
      assert.deepEqual(anchors[1], { x: 100, y: 50 }); // Right eye center
      assert.deepEqual(anchors[2], { x: 70, y: 85 }); // Nose tip
      assert.deepEqual(anchors[3], { x: 50, y: 115 }); // Left mouth
      assert.deepEqual(anchors[4], { x: 90, y: 115 }); // Right mouth
    });

    it("extracts 5 anchor points from 468-point MediaPipe landmarks", () => {
      const lms468 = Array.from({ length: 468 }, (_, i) => ({ x: i * 0.5, y: i * 0.5 }));
      lms468[33] = { x: 40, y: 50 };
      lms468[133] = { x: 50, y: 50 };
      lms468[263] = { x: 100, y: 50 };
      lms468[362] = { x: 110, y: 50 };
      lms468[1] = { x: 75, y: 85 };
      lms468[61] = { x: 55, y: 115 };
      lms468[291] = { x: 95, y: 115 };

      const anchors = extract5AnchorPoints(lms468);
      assert.ok(anchors);
      assert.equal(anchors.length, 5);
      assert.deepEqual(anchors[0], { x: 45, y: 50 }); // Mid of 33 and 133
      assert.deepEqual(anchors[1], { x: 105, y: 50 }); // Mid of 263 and 362
      assert.deepEqual(anchors[2], { x: 75, y: 85 });
      assert.deepEqual(anchors[3], { x: 55, y: 115 });
      assert.deepEqual(anchors[4], { x: 95, y: 115 });
    });

    it("returns null for invalid/empty landmark arrays", () => {
      assert.equal(extract5AnchorPoints([]), null);
      assert.equal(extract5AnchorPoints(null as any), null);
      assert.equal(extract5AnchorPoints([{ x: 10, y: 10 }]), null);
    });
  });

  describe("Linear Least-Squares 2D Similarity Transform Solver", () => {
    it("computes exact identity transform when source equals target", () => {
      const transform = compute5PointAffineTransform(CANONICAL_5_POINTS_150, CANONICAL_5_POINTS_150);
      assert.ok(Math.abs(transform.a - 1.0) < 1e-6, `a=${transform.a}`);
      assert.ok(Math.abs(transform.b - 0.0) < 1e-6, `b=${transform.b}`);
      assert.ok(Math.abs(transform.tx - 0.0) < 1e-6, `tx=${transform.tx}`);
      assert.ok(Math.abs(transform.ty - 0.0) < 1e-6, `ty=${transform.ty}`);
      assert.ok(Math.abs(transform.scale - 1.0) < 1e-6, `scale=${transform.scale}`);
      assert.ok(Math.abs(transform.rotationDeg - 0.0) < 1e-6, `rotationDeg=${transform.rotationDeg}`);
    });

    it("recovers translation displacement correctly", () => {
      const dx = 25.0;
      const dy = -15.0;
      const shifted = CANONICAL_5_POINTS_150.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      const transform = compute5PointAffineTransform(shifted, CANONICAL_5_POINTS_150);

      assert.ok(Math.abs(transform.a - 1.0) < 1e-5);
      assert.ok(Math.abs(transform.b - 0.0) < 1e-5);
      assert.ok(Math.abs(transform.tx - (-dx)) < 1e-5, `tx=${transform.tx}`);
      assert.ok(Math.abs(transform.ty - (-dy)) < 1e-5, `ty=${transform.ty}`);
    });

    it("recovers uniform scale scaling factor correctly", () => {
      const s = 1.5;
      const scaled = CANONICAL_5_POINTS_150.map((p) => ({ x: p.x * s, y: p.y * s }));
      const transform = compute5PointAffineTransform(scaled, CANONICAL_5_POINTS_150);

      assert.ok(Math.abs(transform.scale - (1 / s)) < 1e-5, `scale=${transform.scale}`);
      for (let i = 0; i < 5; i++) {
        const mapped = applyAffineTransform2D(scaled[i]!, transform);
        assert.ok(Math.hypot(mapped.x - CANONICAL_5_POINTS_150[i]!.x, mapped.y - CANONICAL_5_POINTS_150[i]!.y) < 1e-4);
      }
    });
  });

  describe("In-Plane Head Tilt (> 20°) Normalization", () => {
    it("normalizes +25° in-plane head tilt to upright horizontal alignment (y_le == y_re == 54.0)", () => {
      const tiltDeg = 25.0;
      const center: Point2D = { x: 75.0, y: 75.0 };
      const tiltedSrc = CANONICAL_5_POINTS_150.map((p) => rotatePoint2D(p, center, tiltDeg));

      const transform = compute5PointAffineTransform(tiltedSrc, CANONICAL_5_POINTS_150);

      // Rotation should counter the tilt: rotationDeg ≈ -25°
      assert.ok(
        Math.abs(transform.rotationDeg - (-tiltDeg)) < 0.5,
        `Expected rotation ~ -25°, got ${transform.rotationDeg.toFixed(2)}°`,
      );

      // Verify mapped points alignment
      const mappedLE = applyAffineTransform2D(tiltedSrc[0]!, transform);
      const mappedRE = applyAffineTransform2D(tiltedSrc[1]!, transform);
      const mappedNose = applyAffineTransform2D(tiltedSrc[2]!, transform);

      assert.ok(Math.abs(mappedLE.y - 54.0) < 1e-3, `Left eye y=${mappedLE.y.toFixed(4)} != 54.0`);
      assert.ok(Math.abs(mappedRE.y - 54.0) < 1e-3, `Right eye y=${mappedRE.y.toFixed(4)} != 54.0`);
      assert.ok(Math.abs(mappedLE.y - mappedRE.y) < 1e-4, "Eyes must be horizontally aligned (delta_y < 0.0001)");
      assert.ok(Math.abs(mappedNose.x - 75.0) < 1e-3, `Nose x=${mappedNose.x.toFixed(4)} != 75.0`);
    });

    it("normalizes -30° in-plane head tilt to upright horizontal alignment", () => {
      const tiltDeg = -30.0;
      const center: Point2D = { x: 75.0, y: 75.0 };
      const tiltedSrc = CANONICAL_5_POINTS_150.map((p) => rotatePoint2D(p, center, tiltDeg));

      const transform = compute5PointAffineTransform(tiltedSrc, CANONICAL_5_POINTS_150);

      assert.ok(
        Math.abs(transform.rotationDeg - (-tiltDeg)) < 0.5,
        `Expected rotation ~ +30°, got ${transform.rotationDeg.toFixed(2)}°`,
      );

      const mappedLE = applyAffineTransform2D(tiltedSrc[0]!, transform);
      const mappedRE = applyAffineTransform2D(tiltedSrc[1]!, transform);
      assert.ok(Math.abs(mappedLE.y - mappedRE.y) < 1e-4, "Eye line must be horizontal");
    });

    it("normalizes extreme +45° in-plane head tilt to upright horizontal alignment", () => {
      const tiltDeg = 45.0;
      const center: Point2D = { x: 160.0, y: 160.0 };
      // Also scale by 1.3x and translate by (30, -20)
      const tiltedSrc = CANONICAL_5_POINTS_150.map((p) => {
        const r = rotatePoint2D(p, { x: 75, y: 75 }, tiltDeg);
        return { x: r.x * 1.3 + 30, y: r.y * 1.3 - 20 };
      });

      const transform = compute5PointAffineTransform(tiltedSrc, CANONICAL_5_POINTS_150);

      const mapped = tiltedSrc.map((p) => applyAffineTransform2D(p, transform));
      const mappedLE = mapped[0]!;
      const mappedRE = mapped[1]!;

      assert.ok(Math.abs(mappedLE.y - 54.0) < 0.1, `Left eye y=${mappedLE.y}`);
      assert.ok(Math.abs(mappedRE.y - 54.0) < 0.1, `Right eye y=${mappedRE.y}`);
      assert.ok(Math.abs(mappedLE.y - mappedRE.y) < 0.05, "Eye line horizontal under +45° tilt");
    });
  });

  describe("Canvas 2D Affine Warping Execution (warp5PointCanonicalCanvas)", () => {
    it("warps image canvas to 150x150 canonical crop with high visual quality", () => {
      const srcCanvas = createTestCanvas(320, 320) as HTMLCanvasElement;
      const ctx = srcCanvas.getContext("2d");
      assert.ok(ctx);
      ctx.fillStyle = "#0000ff"; // Blue background
      ctx.fillRect(0, 0, 320, 320);
      ctx.fillStyle = "#ff0000"; // Red marker at left eye position (100, 100)
      ctx.fillRect(95, 95, 10, 10);

      const srcAnchors: Point2D[] = [
        { x: 100, y: 100 }, // Left eye
        { x: 220, y: 100 }, // Right eye
        { x: 160, y: 160 }, // Nose tip
        { x: 110, y: 220 }, // Left mouth
        { x: 210, y: 220 }, // Right mouth
      ];

      const outCanvas = warp5PointCanonicalCanvas(srcCanvas, srcAnchors, 150);
      assert.equal(outCanvas.width, 150);
      assert.equal(outCanvas.height, 150);

      // Verify that left eye canonical coord (46.5, 54.0) contains the red marker
      const outCtx = outCanvas.getContext("2d")!;
      const sampleEye = outCtx.getImageData(46, 54, 1, 1).data;
      assert.ok(sampleEye[0]! > 200, "Left eye position (46.5, 54.0) must capture red marker");
    });
  });
});
