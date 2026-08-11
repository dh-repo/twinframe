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

describe("hud-transform: aspect ratio HUD math", () => {
  describe("1:1 aspect ratio photos (square)", () => {
    const imgW = 1000;
    const imgH = 1000;

    it("leaves center point unchanged", () => {
      const pt = { x: 50, y: 50 };
      const res = transformNormalizedPointToHud(pt, imgW, imgH, 280, 280);
      assertCloseTo(res.x, 50);
      assertCloseTo(res.y, 50);
    });

    it("leaves corner points unchanged", () => {
      const pt = { x: 0, y: 0 };
      const res = transformNormalizedPointToHud(pt, imgW, imgH, 280, 280);
      assertCloseTo(res.x, 0);
      assertCloseTo(res.y, 0);
    });

    it("leaves normalized box unchanged", () => {
      const box = { x: 20, y: 30, width: 40, height: 40 };
      const res = transformNormalizedBoxToHud(box, imgW, imgH, 280, 280);
      assertCloseTo(res.x, 20);
      assertCloseTo(res.y, 30);
      assertCloseTo(res.width, 40);
      assertCloseTo(res.height, 40);
    });
  });

  describe("16:9 aspect ratio photos (landscape)", () => {
    const imgW = 1920;
    const imgH = 1080;

    it("keeps center point at 50%, 50%", () => {
      const pt = { x: 50, y: 50 };
      const res = transformNormalizedPointToHud(pt, imgW, imgH, 280, 280);
      assertCloseTo(res.x, 50);
      assertCloseTo(res.y, 50);
    });

    it("expands horizontal coordinates due to object-cover cropping", () => {
      // 16/9 = 1.777777...
      // Point at image left edge (x=0) shifts left off-screen: 50 + (0-50)*(16/9) = -38.8888...%
      const ptLeft = { x: 0, y: 50 };
      const resLeft = transformNormalizedPointToHud(ptLeft, imgW, imgH, 280, 280);
      assertCloseTo(resLeft.x, -38.88888888888889);
      assertCloseTo(resLeft.y, 50);

      // Point at image right edge (x=100) shifts right: 50 + (100-50)*(16/9) = 138.8888...%
      const ptRight = { x: 100, y: 50 };
      const resRight = transformNormalizedPointToHud(ptRight, imgW, imgH, 280, 280);
      assertCloseTo(resRight.x, 138.88888888888889);
      assertCloseTo(resRight.y, 50);
    });

    it("leaves vertical coordinates at scale 1.0 for landscape in square container", () => {
      const ptTop = { x: 50, y: 10 };
      const resTop = transformNormalizedPointToHud(ptTop, imgW, imgH, 280, 280);
      assertCloseTo(resTop.x, 50);
      assertCloseTo(resTop.y, 10);
    });

    it("transforms bounding box appropriately for 16:9", () => {
      const box = { x: 25, y: 20, width: 30, height: 40 };
      const res = transformNormalizedBoxToHud(box, imgW, imgH, 100, 100);
      // x: 50 + (25 - 50) * (16/9) = 50 - 44.4444... = 5.5555...
      assertCloseTo(res.x, 5.555555555555557);
      assertCloseTo(res.y, 20);
      // width: 30 * (16/9) = 53.3333...
      assertCloseTo(res.width, 53.333333333333336);
      assertCloseTo(res.height, 40);
    });
  });

  describe("4:3 aspect ratio photos (standard landscape)", () => {
    const imgW = 1440;
    const imgH = 1080;

    it("keeps center point at 50%, 50%", () => {
      const pt = { x: 50, y: 50 };
      const res = transformNormalizedPointToHud(pt, imgW, imgH, 280, 280);
      assertCloseTo(res.x, 50);
      assertCloseTo(res.y, 50);
    });

    it("expands horizontal coordinates by 4/3 factor", () => {
      // 4/3 = 1.33333...
      // x=0 -> 50 + (-50)*(4/3) = -16.6666...%
      const ptLeft = { x: 0, y: 50 };
      const resLeft = transformNormalizedPointToHud(ptLeft, imgW, imgH, 280, 280);
      assertCloseTo(resLeft.x, -16.666666666666668);
      assertCloseTo(resLeft.y, 50);

      // x=100 -> 50 + 50*(4/3) = 116.6666...%
      const ptRight = { x: 100, y: 50 };
      const resRight = transformNormalizedPointToHud(ptRight, imgW, imgH, 280, 280);
      assertCloseTo(resRight.x, 116.66666666666667);
      assertCloseTo(resRight.y, 50);
    });

    it("transforms bounding box for 4:3", () => {
      const box = { x: 30, y: 30, width: 40, height: 40 };
      const res = transformNormalizedBoxToHud(box, imgW, imgH, 280, 280);
      // x: 50 + (30-50)*(4/3) = 50 - 26.6666... = 23.3333...
      assertCloseTo(res.x, 23.333333333333332);
      assertCloseTo(res.y, 30);
      // width: 40 * (4/3) = 53.3333...
      assertCloseTo(res.width, 53.333333333333336);
      assertCloseTo(res.height, 40);
    });
  });

  describe("3:4 aspect ratio photos (portrait)", () => {
    const imgW = 1200;
    const imgH = 1600;

    it("keeps center point at 50%, 50%", () => {
      const pt = { x: 50, y: 50 };
      const res = transformNormalizedPointToHud(pt, imgW, imgH, 280, 280);
      assertCloseTo(res.x, 50);
      assertCloseTo(res.y, 50);
    });

    it("expands vertical coordinates by 4/3 factor while leaving horizontal scale 1.0", () => {
      // 3/4 ratio in 1:1 container -> height is scaled up by 1 / (3/4) = 4/3
      // y=0 -> 50 + (-50)*(4/3) = -16.6666...%
      const ptTop = { x: 50, y: 0 };
      const resTop = transformNormalizedPointToHud(ptTop, imgW, imgH, 280, 280);
      assertCloseTo(resTop.x, 50);
      assertCloseTo(resTop.y, -16.666666666666668);

      // y=100 -> 50 + 50*(4/3) = 116.6666...%
      const ptBottom = { x: 50, y: 100 };
      const resBottom = transformNormalizedPointToHud(ptBottom, imgW, imgH, 280, 280);
      assertCloseTo(resBottom.x, 50);
      assertCloseTo(resBottom.y, 116.66666666666667);
    });

    it("transforms bounding box for 3:4 portrait", () => {
      const box = { x: 30, y: 30, width: 40, height: 40 };
      const res = transformNormalizedBoxToHud(box, imgW, imgH, 280, 280);
      assertCloseTo(res.x, 30);
      assertCloseTo(res.y, 23.333333333333332);
      assertCloseTo(res.width, 40);
      assertCloseTo(res.height, 53.333333333333336);
    });
  });

  describe("Edge cases and fallbacks", () => {
    it("handles zero or negative image dimensions gracefully", () => {
      const pt = { x: 25, y: 35 };
      assert.deepEqual(transformNormalizedPointToHud(pt, 0, 100), { x: 25, y: 35 });
      assert.deepEqual(transformNormalizedPointToHud(pt, 100, 0), { x: 25, y: 35 });
      assert.deepEqual(transformNormalizedPointToHud(pt, -100, 100), { x: 25, y: 35 });
    });

    it("handles zero or negative container dimensions by falling back to 100", () => {
      const pt = { x: 50, y: 50 };
      const res = transformNormalizedPointToHud(pt, 1920, 1080, 0, 0);
      assertCloseTo(res.x, 50);
      assertCloseTo(res.y, 50);
    });

    it("handles non-square container aspect ratio", () => {
      // 16:9 photo in 2:1 container (boxWidth: 400, boxHeight: 200 => R_box = 2.0)
      // R_img = 1.77777..., R_box = 2.0
      // maxR = 2.0, kx = 2.0/2.0 = 1.0, ky = 2.0/(16/9) = 1.125
      const pt = { x: 50, y: 10 };
      const res = transformNormalizedPointToHud(pt, 1920, 1080, 400, 200);
      assertCloseTo(res.x, 50);
      assertCloseTo(res.y, 50 + (10 - 50) * 1.125);
    });
  });
});
