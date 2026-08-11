import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  transformNormalizedPointToHud,
  transformNormalizedBoxToHud,
} from "./hud-transform.ts";

function assertCloseTo(actual: number, expected: number, delta: number = 0.0001, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= delta,
    msg ?? `Expected ${actual} to be close to ${expected} (delta <= ${delta})`
  );
}

describe("M2 Challenger Empirical Stress Suite - HUD Transform Math", () => {
  describe("1. Extreme Ultra-Wide Aspect Ratios (21:9, 32:9)", () => {
    it("transforms 21:9 image (2560x1080) in 1:1 square container", () => {
      // R_img = 2560 / 1080 = 2.370370...
      // R_box = 100 / 100 = 1.0
      // maxR = 2.370370...
      // kx = 2.370370..., ky = 1.0
      const imgW = 2560;
      const imgH = 1080;

      const ptCenter = { x: 50, y: 50 };
      const resCenter = transformNormalizedPointToHud(ptCenter, imgW, imgH, 100, 100);
      assertCloseTo(resCenter.x, 50);
      assertCloseTo(resCenter.y, 50);

      const ptLeft = { x: 0, y: 50 };
      const resLeft = transformNormalizedPointToHud(ptLeft, imgW, imgH, 100, 100);
      assertCloseTo(resLeft.x, 50 + (0 - 50) * (2560 / 1080)); // -68.5185%
      assertCloseTo(resLeft.y, 50);

      const ptRight = { x: 100, y: 50 };
      const resRight = transformNormalizedPointToHud(ptRight, imgW, imgH, 100, 100);
      assertCloseTo(resRight.x, 50 + (100 - 50) * (2560 / 1080)); // 168.5185%
      assertCloseTo(resRight.y, 50);

      const ptTop = { x: 50, y: 0 };
      const resTop = transformNormalizedPointToHud(ptTop, imgW, imgH, 100, 100);
      assertCloseTo(resTop.x, 50);
      assertCloseTo(resTop.y, 0); // ky = 1.0
    });

    it("transforms 32:9 ultra-wide panorama (3840x1080) in 1:1 container", () => {
      // R_img = 3840 / 1080 = 3.5555...
      const imgW = 3840;
      const imgH = 1080;

      const ptLeft = { x: 0, y: 50 };
      const resLeft = transformNormalizedPointToHud(ptLeft, imgW, imgH, 100, 100);
      assertCloseTo(resLeft.x, 50 - 50 * (3840 / 1080)); // -127.777%
      assertCloseTo(resLeft.y, 50);

      const box = { x: 40, y: 20, width: 20, height: 30 };
      const resBox = transformNormalizedBoxToHud(box, imgW, imgH, 100, 100);
      assertCloseTo(resBox.x, 50 + (40 - 50) * (3840 / 1080));
      assertCloseTo(resBox.y, 20);
      assertCloseTo(resBox.width, 20 * (3840 / 1080));
      assertCloseTo(resBox.height, 30);
    });

    it("transforms 21:9 image (2560x1080) in 16:9 widescreen container (400x225)", () => {
      // R_img = 2560/1080 = 2.370370...
      // R_box = 400/225 = 1.777777...
      // maxR = 2.370370...
      // kx = (2560/1080) / (400/225) = 1.333333...
      // ky = 1.0
      const imgW = 2560;
      const imgH = 1080;

      const ptLeft = { x: 0, y: 50 };
      const resLeft = transformNormalizedPointToHud(ptLeft, imgW, imgH, 400, 225);
      assertCloseTo(resLeft.x, 50 - 50 * (2.3703703703703702 / 1.7777777777777777));
      assertCloseTo(resLeft.y, 50);
    });
  });

  describe("2. Extreme Portrait Aspect Ratios (9:16, 9:21)", () => {
    it("transforms 9:16 portrait image (1080x1920) in 1:1 square container", () => {
      // R_img = 1080 / 1920 = 0.5625
      // R_box = 1.0
      // maxR = 1.0
      // kx = 1.0, ky = 1.0 / 0.5625 = 1.7777... (16/9)
      const imgW = 1080;
      const imgH = 1920;

      const ptTop = { x: 50, y: 0 };
      const resTop = transformNormalizedPointToHud(ptTop, imgW, imgH, 100, 100);
      assertCloseTo(resTop.x, 50);
      assertCloseTo(resTop.y, 50 - 50 * (16 / 9)); // -38.8888...%

      const ptBottom = { x: 50, y: 100 };
      const resBottom = transformNormalizedPointToHud(ptBottom, imgW, imgH, 100, 100);
      assertCloseTo(resBottom.x, 50);
      assertCloseTo(resBottom.y, 50 + 50 * (16 / 9)); // 138.8888...%

      const box = { x: 20, y: 40, width: 30, height: 20 };
      const resBox = transformNormalizedBoxToHud(box, imgW, imgH, 100, 100);
      assertCloseTo(resBox.x, 20);
      assertCloseTo(resBox.y, 50 + (40 - 50) * (16 / 9));
      assertCloseTo(resBox.width, 30);
      assertCloseTo(resBox.height, 20 * (16 / 9));
    });

    it("transforms 9:21 extreme mobile portrait (1080x2520) in 1:1 container", () => {
      // R_img = 1080 / 2520 = 0.428571...
      // maxR = 1.0
      // kx = 1.0, ky = 1 / (1080/2520) = 2.3333...
      const imgW = 1080;
      const imgH = 2520;

      const ptTop = { x: 50, y: 0 };
      const resTop = transformNormalizedPointToHud(ptTop, imgW, imgH, 100, 100);
      assertCloseTo(resTop.x, 50);
      assertCloseTo(resTop.y, 50 - 50 * (2520 / 1080)); // -66.6667%
    });
  });

  describe("3. Zero, Negative, Non-numeric, and Missing Image Dimensions", () => {
    const pt = { x: 35, y: 65 };
    const box = { x: 10, y: 20, width: 30, height: 40 };

    it("falls back to identity point when imgWidth is 0", () => {
      assert.deepEqual(transformNormalizedPointToHud(pt, 0, 1080), { x: 35, y: 65 });
    });

    it("falls back to identity point when imgHeight is 0", () => {
      assert.deepEqual(transformNormalizedPointToHud(pt, 1920, 0), { x: 35, y: 65 });
    });

    it("falls back to identity point when both imgWidth and imgHeight are 0", () => {
      assert.deepEqual(transformNormalizedPointToHud(pt, 0, 0), { x: 35, y: 65 });
    });

    it("falls back to identity point when negative dimensions are passed", () => {
      assert.deepEqual(transformNormalizedPointToHud(pt, -1920, 1080), { x: 35, y: 65 });
      assert.deepEqual(transformNormalizedPointToHud(pt, 1920, -1080), { x: 35, y: 65 });
      assert.deepEqual(transformNormalizedPointToHud(pt, -1920, -1080), { x: 35, y: 65 });
    });

    it("falls back to identity box when dimensions are 0 or negative", () => {
      assert.deepEqual(transformNormalizedBoxToHud(box, 0, 1080), { ...box });
      assert.deepEqual(transformNormalizedBoxToHud(box, 1920, 0), { ...box });
      assert.deepEqual(transformNormalizedBoxToHud(box, -100, -100), { ...box });
    });

    it("handles undefined, null, or NaN image dimensions gracefully", () => {
      assert.deepEqual(transformNormalizedPointToHud(pt, undefined as unknown as number, 1080), { x: 35, y: 65 });
      assert.deepEqual(transformNormalizedPointToHud(pt, 1920, null as unknown as number), { x: 35, y: 65 });
      assert.deepEqual(transformNormalizedPointToHud(pt, NaN, 1080), { x: 35, y: 65 });
      assert.deepEqual(transformNormalizedPointToHud(pt, 1920, NaN), { x: 35, y: 65 });
    });
  });

  describe("4. Missing, Zero, Negative, or Non-numeric Container Parameters", () => {
    const pt = { x: 25, y: 75 };
    const imgW = 1920;
    const imgH = 1080; // 16:9 landscape

    it("defaults boxWidth and boxHeight to 100 when omitted", () => {
      const resDefault = transformNormalizedPointToHud(pt, imgW, imgH);
      const resExplicit = transformNormalizedPointToHud(pt, imgW, imgH, 100, 100);
      assert.deepEqual(resDefault, resExplicit);
    });

    it("falls back to 100 when boxWidth or boxHeight is 0 or negative", () => {
      const resZero = transformNormalizedPointToHud(pt, imgW, imgH, 0, 0);
      const resNeg = transformNormalizedPointToHud(pt, imgW, imgH, -200, -200);
      const resExplicit = transformNormalizedPointToHud(pt, imgW, imgH, 100, 100);
      assert.deepEqual(resZero, resExplicit);
      assert.deepEqual(resNeg, resExplicit);
    });

    it("falls back to 100 when boxWidth or boxHeight is NaN or null", () => {
      const resNaN = transformNormalizedPointToHud(pt, imgW, imgH, NaN, NaN);
      const resNull = transformNormalizedPointToHud(pt, imgW, imgH, null as unknown as number, null as unknown as number);
      const resExplicit = transformNormalizedPointToHud(pt, imgW, imgH, 100, 100);
      assert.deepEqual(resNaN, resExplicit);
      assert.deepEqual(resNull, resExplicit);
    });
  });

  describe("5. High and Out-of-Bounds Landmark Coordinate Values (<0% or >100%)", () => {
    const imgW = 1920;
    const imgH = 1080; // 16:9

    it("maintains linear affine mapping for negative landmark coordinates (x < 0%)", () => {
      const ptNeg = { x: -20, y: -10 };
      const res = transformNormalizedPointToHud(ptNeg, imgW, imgH, 100, 100);
      // kx = 16/9 = 1.7777...
      // x = 50 + (-20 - 50)*(16/9) = 50 - 70*(16/9) = -74.4444...%
      assertCloseTo(res.x, 50 - 70 * (16 / 9));
      assertCloseTo(res.y, -10);
    });

    it("maintains linear affine mapping for high landmark coordinates (x > 100%, y > 100%)", () => {
      const ptHigh = { x: 150, y: 120 };
      const res = transformNormalizedPointToHud(ptHigh, imgW, imgH, 100, 100);
      // x = 50 + (150 - 50)*(16/9) = 50 + 100*(16/9) = 227.7777...%
      // y = 50 + (120 - 50)*1.0 = 120%
      assertCloseTo(res.x, 50 + 100 * (16 / 9));
      assertCloseTo(res.y, 120);
    });

    it("preserves exact linear distance invariant under transformation", () => {
      // T(p2) - T(p1) == (p2 - p1) * scale factor
      const pt1 = { x: 10, y: 20 };
      const pt2 = { x: 90, y: 80 };
      const t1 = transformNormalizedPointToHud(pt1, imgW, imgH, 100, 100);
      const t2 = transformNormalizedPointToHud(pt2, imgW, imgH, 100, 100);

      const dxOrig = pt2.x - pt1.x; // 80
      const dyOrig = pt2.y - pt1.y; // 60

      const dxTrans = t2.x - t1.x;
      const dyTrans = t2.y - t1.y;

      assertCloseTo(dxTrans, dxOrig * (16 / 9));
      assertCloseTo(dyTrans, dyOrig * 1.0);
    });
  });
});
