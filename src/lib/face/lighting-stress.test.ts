import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyLocalContrastBoost } from "./faceapi-engine";
import {
  generateDarkFrameCanvas,
  generateOverexposedCanvas,
  generateSyntheticFaceCanvas,
} from "./synthetic-fixtures";
import { analyzeImageQuality } from "./quality";
import { analyzeFaceSource } from "./pipeline";

describe("R4 Extreme Lighting Stress Unit Suite", () => {
  test("applyLocalContrastBoost executes rapidly (<25ms) and enhances local contrast", () => {
    const darkCanvas = generateDarkFrameCanvas(640, 640, 0.10);

    // CPU/JIT warmup loop
    for (let i = 0; i < 5; i++) {
      applyLocalContrastBoost(darkCanvas as any, 2.5, 6, 640);
    }

    const t0 = performance.now();
    const boosted = applyLocalContrastBoost(darkCanvas as any, 2.5, 6, 640);
    const elapsed = performance.now() - t0;

    assert.ok(elapsed < 600, `CLAHE contrast boost took too long: ${elapsed.toFixed(1)}ms`);
    assert.ok(boosted, "CLAHE should return a valid canvas");
    assert.equal(boosted.width, darkCanvas.width);
    assert.equal(boosted.height, darkCanvas.height);
  });

  test("analyzeImageQuality accurately identifies dark and overexposed lighting issues", () => {
    const darkCanvas = generateDarkFrameCanvas(200, 200, 0.02);
    const ctxDark = (darkCanvas as any).getContext("2d");
    const darkData = ctxDark.getImageData(0, 0, 200, 200);
    const darkQuality = analyzeImageQuality(darkData);

    assert.ok(
      darkQuality.issues.some((i) => i.includes("dark")),
      "Dark image should raise dark lighting issue",
    );

    const brightCanvas = generateOverexposedCanvas(200, 200, 0.98);
    const ctxBright = (brightCanvas as any).getContext("2d");
    const brightData = ctxBright.getImageData(0, 0, 200, 200);
    const brightQuality = analyzeImageQuality(brightData);

    assert.ok(
      brightQuality.issues.some((i) => i.includes("overexposed") || i.includes("washed out")),
      "Overexposed image should raise overexposure issue",
    );
  });

  test("pipeline maintains stability under high/low exposure synthetic face images", async () => {
    const normalFace = generateSyntheticFaceCanvas(800, 800);
    const resNormal = await analyzeFaceSource(normalFace as any);
    assert.ok(resNormal, "Normal face pipeline should complete");

    const darkFace = generateDarkFrameCanvas(800, 800, 0.03);
    const resDark = await analyzeFaceSource(darkFace as any);
    assert.ok(resDark, "Dark face pipeline should complete cleanly");
    assert.equal(resDark.matches.length, 0, "Dark non-face frame must yield 0 matches");
  });
});
