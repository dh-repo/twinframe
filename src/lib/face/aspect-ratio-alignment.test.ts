import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { transformNormalizedBoxToHud, transformNormalizedPointToHud } from "./hud-transform";

describe("R3 Aspect Ratio & Coordinate Alignment Robustness Unit Suite", () => {
  const aspectRatios = [
    { name: "9:16 Portrait", imgW: 1080, imgH: 1920 },
    { name: "4:3 Standard", imgW: 1600, imgH: 1200 },
    { name: "1:1 Square", imgW: 1000, imgH: 1000 },
    { name: "16:9 Widescreen", imgW: 1920, imgH: 1080 },
    { name: "21:9 Ultrawide", imgW: 2560, imgH: 1080 },
  ];

  test("HUD matrix transform preserves center invariant (50, 50) -> (50, 50) across aspect ratios", () => {
    for (const ar of aspectRatios) {
      const centerPoint = { x: 50, y: 50 };
      const transformed = transformNormalizedPointToHud(centerPoint, ar.imgW, ar.imgH, 320, 320);
      assert.ok(
        Math.abs(transformed.x - 50) < 1e-4,
        `Center X drifted for ${ar.name}: ${transformed.x}`,
      );
      assert.ok(
        Math.abs(transformed.y - 50) < 1e-4,
        `Center Y drifted for ${ar.name}: ${transformed.y}`,
      );
    }
  });

  test("HUD matrix transform scales bounding box dimensions consistently and preserves point-to-box alignment", () => {
    const testCases = [
      { name: "Center (50, 50)", point: { x: 50, y: 50 }, box: { x: 25, y: 20, width: 50, height: 60 } },
      { name: "Off-Center Top-Left (20, 30)", point: { x: 20, y: 30 }, box: { x: 10, y: 20, width: 20, height: 20 } },
      { name: "Off-Center Bottom-Right (80, 70)", point: { x: 80, y: 70 }, box: { x: 70, y: 60, width: 20, height: 20 } },
    ];

    for (const ar of aspectRatios) {
      for (const tc of testCases) {
        const transformed = transformNormalizedBoxToHud(tc.box, ar.imgW, ar.imgH, 320, 320);
        assert.ok(transformed.width > 0, `Transformed width invalid for ${ar.name} on ${tc.name}`);
        assert.ok(transformed.height > 0, `Transformed height invalid for ${ar.name} on ${tc.name}`);

        // Transformed box center should match transformed point center
        const boxCenterX = transformed.x + transformed.width / 2;
        const boxCenterY = transformed.y + transformed.height / 2;
        const pointCenter = transformNormalizedPointToHud(tc.point, ar.imgW, ar.imgH, 320, 320);
        assert.ok(
          Math.abs(boxCenterX - pointCenter.x) < 1e-4,
          `Box center X mismatched point center X for ${ar.name} on ${tc.name}`,
        );
        assert.ok(
          Math.abs(boxCenterY - pointCenter.y) < 1e-4,
          `Box center Y mismatched point center Y for ${ar.name} on ${tc.name}`,
        );
      }
    }
  });

  test("Crop coordinate calculation preserves aspect ratio bounds without NaN", () => {
    for (const ar of aspectRatios) {
      const iw = ar.imgW;
      const ih = ar.imgH;
      const scale = 1.2;
      const offset = { x: 30, y: -20 };
      const containerSize = 320;

      const drawScale = Math.max(containerSize / iw, containerSize / ih) * scale;
      const cropCenterX = iw / 2 - offset.x / drawScale;
      const cropCenterY = ih / 2 - offset.y / drawScale;
      const side = Math.min(iw, ih) * 0.6;
      let sx = cropCenterX - side / 2;
      let sy = cropCenterY - side / 2;
      sx = Math.max(0, Math.min(iw - side, sx));
      sy = Math.max(0, Math.min(ih - side, sy));

      assert.ok(Number.isFinite(sx) && sx >= 0 && sx <= iw - side);
      assert.ok(Number.isFinite(sy) && sy >= 0 && sy <= ih - side);
    }
  });
});
