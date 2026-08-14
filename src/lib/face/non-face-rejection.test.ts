import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateSunsetCanvas,
  generateDarkFrameCanvas,
  generateOverexposedCanvas,
  generateAbstractNoiseCanvas,
} from "./synthetic-fixtures";
import { analyzeFaceSource } from "./pipeline";
import { analyzeImageQuality } from "./quality";
import { isValidHumanFaceLandmarks68 } from "./geometry";
import { rankByDescriptor } from "./match";
import { loadCelebrityEmbeddings } from "./embeddings";

describe("R1 Non-Face & False Candidate Hardening Unit Suite", () => {
  test("isValidHumanFaceLandmarks68 rejects non-facial landmark meshes", () => {
    // Empty / short arrays
    assert.equal(isValidHumanFaceLandmarks68([]), false);
    assert.equal(isValidHumanFaceLandmarks68(new Array(67).fill({ x: 50, y: 50 })), false);

    // Collapsed single-point cluster (fails coverage area & IOD)
    const collapsed = new Array(68).fill({ x: 50, y: 50 });
    assert.equal(isValidHumanFaceLandmarks68(collapsed, 100, 100), false);

    // Straight line across horizontal axis (sunset horizon line)
    const lineLandmarks = Array.from({ length: 68 }, (_, i) => ({ x: i * 1.4, y: 50 }));
    assert.equal(isValidHumanFaceLandmarks68(lineLandmarks, 100, 100), false);

    // Inverted vertical order (Chin at top, Eyes at bottom)
    const inverted = Array.from({ length: 68 }, (_, i) => ({ x: 50, y: 100 - i }));
    assert.equal(isValidHumanFaceLandmarks68(inverted, 100, 100), false);
  });

  test("analyzeImageQuality correctly flags featureless, dark, and bright frames", () => {
    const darkCanvas = generateDarkFrameCanvas(128, 128, 0.02);
    const ctxDark = (darkCanvas as any).getContext("2d");
    const darkData = ctxDark.getImageData(0, 0, 128, 128);
    const darkMetrics = analyzeImageQuality(darkData);
    assert.ok(darkMetrics.illuminationBalance < 0.15);

    const brightCanvas = generateOverexposedCanvas(128, 128, 0.98);
    const ctxBright = (brightCanvas as any).getContext("2d");
    const brightData = ctxBright.getImageData(0, 0, 128, 128);
    const brightMetrics = analyzeImageQuality(brightData);
    assert.ok(brightMetrics.illuminationBalance < 0.15);
  });

  test("rankByDescriptor returns empty matches array for non-face descriptors (distance ceiling)", async () => {
    const gallery = await loadCelebrityEmbeddings();
    // Non-face descriptor (uniform vector or random high-distance vector)
    const nonFaceDescriptor = new Float32Array(128).fill(0.088); // L2 norm = 1.0

    const matches = rankByDescriptor(
      {
        descriptor: nonFaceDescriptor,
        age: 30,
        gender: "unknown",
        genderProbability: 0.5,
        detConfidence: 0.20,
      },
      gallery,
      5,
    );

    assert.equal(matches.length, 0, "Non-face descriptor must produce 0 matches");
  });

  test("analyzeFaceSource returns 100% rejection (0 matches) on synthetic non-face images", async () => {
    const nonFaceImages = [
      generateSunsetCanvas(800, 800),
      generateDarkFrameCanvas(800, 800, 0.01),
      generateOverexposedCanvas(800, 800, 0.99),
      generateAbstractNoiseCanvas(800, 800),
    ];

    for (const img of nonFaceImages) {
      const res = await analyzeFaceSource(img as any, { topK: 5 });
      assert.equal(res.matches.length, 0, "Non-face image produced non-zero matches");
      assert.equal(res.quality.ok, false, "Non-face image passed quality check");
    }
  });

  test("isValidHumanFaceLandmarks68 returns true for small faces (10% to 15%) when bounding box bounds are provided", () => {
    function generateLandmarks68(x0: number, y0: number, w: number, h: number) {
      const pts: Array<{ x: number; y: number }> = new Array(68);
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts[i] = { x: x0 + t * w, y: y0 + h * 0.5 + Math.sin(t * Math.PI) * (h * 0.5) };
      }
      for (let i = 17; i <= 21; i++) {
        const t = (i - 17) / 4;
        pts[i] = { x: x0 + w * 0.15 + t * (w * 0.3), y: y0 + h * 0.2 };
      }
      for (let i = 22; i <= 26; i++) {
        const t = (i - 22) / 4;
        pts[i] = { x: x0 + w * 0.55 + t * (w * 0.3), y: y0 + h * 0.2 };
      }
      pts[27] = { x: x0 + w * 0.5, y: y0 + h * 0.25 };
      pts[28] = { x: x0 + w * 0.5, y: y0 + h * 0.35 };
      pts[29] = { x: x0 + w * 0.5, y: y0 + h * 0.45 };
      pts[30] = { x: x0 + w * 0.5, y: y0 + h * 0.55 };
      for (let i = 31; i <= 35; i++) {
        const t = (i - 31) / 4;
        pts[i] = { x: x0 + w * 0.35 + t * (w * 0.3), y: y0 + h * 0.58 };
      }
      const lEyeX = x0 + w * 0.3;
      const lEyeY = y0 + h * 0.3;
      pts[36] = { x: lEyeX - w * 0.08, y: lEyeY };
      pts[37] = { x: lEyeX - w * 0.04, y: lEyeY - h * 0.04 };
      pts[38] = { x: lEyeX + w * 0.04, y: lEyeY - h * 0.04 };
      pts[39] = { x: lEyeX + w * 0.08, y: lEyeY };
      pts[40] = { x: lEyeX + w * 0.04, y: lEyeY + h * 0.04 };
      pts[41] = { x: lEyeX - w * 0.04, y: lEyeY + h * 0.04 };

      const rEyeX = x0 + w * 0.7;
      const rEyeY = y0 + h * 0.3;
      pts[42] = { x: rEyeX - w * 0.08, y: rEyeY };
      pts[43] = { x: rEyeX - w * 0.04, y: rEyeY - h * 0.04 };
      pts[44] = { x: rEyeX + w * 0.04, y: rEyeY - h * 0.04 };
      pts[45] = { x: rEyeX + w * 0.08, y: rEyeY };
      pts[46] = { x: rEyeX + w * 0.04, y: rEyeY + h * 0.04 };
      pts[47] = { x: rEyeX - w * 0.04, y: rEyeY + h * 0.04 };

      const mouthY = y0 + h * 0.75;
      for (let i = 48; i <= 67; i++) {
        const t = (i - 48) / 19;
        pts[i] = { x: x0 + w * 0.35 + (t % 1) * (w * 0.3), y: mouthY + (i === 51 ? -h * 0.02 : i === 57 ? h * 0.02 : 0) };
      }
      pts[8] = { x: x0 + w * 0.5, y: y0 + h * 0.95 };
      return pts;
    }

    // 15% x 15% face in percentage space
    const smallFace15 = generateLandmarks68(40, 40, 15, 15);
    // Bounding box dimensions (15, 15) pass validation!
    assert.equal(isValidHumanFaceLandmarks68(smallFace15, 15, 15), true);

    // 10% x 10% face in percentage space
    const smallFace10 = generateLandmarks68(45, 45, 10, 10);
    // Bounding box dimensions (10, 10) pass validation!
    assert.equal(isValidHumanFaceLandmarks68(smallFace10, 10, 10), true);
  });
});

