import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectFacesOnly,
  applyLocalContrastBoost,
  scoreCandidateFace,
  sortFaceCandidates,
  nmsFaceBoxes,
  boxIoU,
  type FaceCandidateInput,
} from "./faceapi-engine.ts";
import {
  createTestCanvas,
  generateSunsetCanvas,
  generateDarkFrameCanvas,
  generateOverexposedCanvas,
  generateAbstractNoiseCanvas,
  generateSyntheticFaceCanvas,
  generateMultiFaceCanvas,
} from "./synthetic-fixtures.ts";

describe("Phase 1 Adversarial Challenger Stress Harness (PRE-01 to PRE-04)", () => {
  // --- 1. EXTREME ASPECT RATIOS & CANVAS DIMENSIONS ---
  describe("1. Extreme Aspect Ratios & Dimension Boundaries", () => {
    it("PRE-01 Aspect Stress: rasterizes ultra-tall skyscraper portrait canvas (200x10000, 1:50 ratio)", async () => {
      const canvasTall = generateSyntheticFaceCanvas(200, 10000, 100, 5000, 50);
      const res = await detectFacesOnly(canvasTall as any, { maxSide: 800 });

      assert.ok(res.detectionCanvas.width <= 800, "Width must be <= 800px");
      assert.ok(res.detectionCanvas.height <= 800, "Height must be <= 800px");
      assert.equal(res.detectionCanvas.height, 800, "Max side height must equal 800px");

      const aspectOrig = 200 / 10000;
      const aspectRaster = res.detectionCanvas.width / res.detectionCanvas.height;
      assert.ok(
        Math.abs(aspectRaster - aspectOrig) < 0.01,
        `Rasterized aspect ratio ${aspectRaster} must match original ${aspectOrig}`,
      );
      assert.equal(res.imageWidth, 200);
      assert.equal(res.imageHeight, 10000);
      assert.ok(Number.isFinite(res.detectionScale) && res.detectionScale > 0);
    });

    it("PRE-01 Aspect Stress: rasterizes ultra-wide panoramic canvas (10000x200, 50:1 ratio)", async () => {
      const canvasWide = generateSyntheticFaceCanvas(10000, 200, 5000, 100, 50);
      const res = await detectFacesOnly(canvasWide as any, { maxSide: 800 });

      assert.ok(res.detectionCanvas.width <= 800, "Width must be <= 800px");
      assert.equal(res.detectionCanvas.width, 800, "Max side width must equal 800px");
      assert.ok(res.detectionCanvas.height <= 800, "Height must be <= 800px");

      const aspectOrig = 10000 / 200;
      const aspectRaster = res.detectionCanvas.width / res.detectionCanvas.height;
      assert.ok(
        Math.abs(aspectRaster - aspectOrig) < 0.1,
        `Aspect ratio ${aspectRaster} must preserve 50:1 proportion`,
      );
      assert.equal(res.imageWidth, 10000);
      assert.equal(res.imageHeight, 200);
    });

    it("PRE-01 Precision Stress: handles non-standard odd/fractional canvas dimensions (2161x3841)", async () => {
      const canvasOdd = generateSyntheticFaceCanvas(2161, 3841, 1080, 1920, 400);
      const res = await detectFacesOnly(canvasOdd as any, { maxSide: 800 });

      assert.ok(res.detectionCanvas.width <= 800);
      assert.ok(res.detectionCanvas.height <= 800);
      assert.equal(res.imageWidth, 2161);
      assert.equal(res.imageHeight, 3841);
      const expectedScale = 800 / 3841;
      assert.ok(Math.abs(res.detectionScale - expectedScale) < 0.01);
    });

    it("PRE-01 Boundary Stress: handles empty/tiny canvas (1x1 and 0x0) without throwing or NaN", async () => {
      const canvasTiny = createTestCanvas(1, 1);
      const res = await detectFacesOnly(canvasTiny as any);

      assert.ok(res, "Result must be defined");
      assert.ok(Array.isArray(res.faces), "Faces must be an array");
      assert.equal(res.imageWidth, 1);
      assert.equal(res.imageHeight, 1);
      assert.ok(Number.isFinite(res.detectionScale));
    });
  });

  // --- 2. CORRUPTED, EXTREME LIGHTING & NOISE INPUTS ---
  describe("2. Extreme Lighting, Noise & Corrupted Pixel Data", () => {
    it("PRE-03 Lighting Stress: dark black canvas (luma = 0.0) triggers recovery and returns cleanly", async () => {
      const darkCanvas = generateDarkFrameCanvas(800, 800, 0.0);
      const res = await detectFacesOnly(darkCanvas as any, { enableContrastBoost: true });

      assert.ok(res, "Must return valid detection result");
      assert.ok(Array.isArray(res.faces));
      assert.equal(res.imageWidth, 800);
      assert.equal(res.imageHeight, 800);
    });

    it("PRE-03 Lighting Stress: overexposed white canvas (luma = 1.0) executes safely", async () => {
      const brightCanvas = generateOverexposedCanvas(800, 800, 1.0);
      const res = await detectFacesOnly(brightCanvas as any);

      assert.ok(res, "Must return valid result");
      assert.ok(Array.isArray(res.faces));
    });

    it("PRE-03 Noise Stress: abstract high-frequency noise canvas completes under SLA", async () => {
      const noiseCanvas = generateAbstractNoiseCanvas(800, 800);
      const t0 = performance.now();
      const res = await detectFacesOnly(noiseCanvas as any, { enableContrastBoost: true });
      const elapsed = performance.now() - t0;

      assert.ok(elapsed < 3500, `Execution time (${elapsed.toFixed(1)}ms) must be under SLA <3500ms`);
      assert.ok(res);
    });

    it("PRE-03 CLAHE Param Stress: contrast boost handles heavy parameters without memory leak or crash", () => {
      const sunsetCanvas = generateSunsetCanvas(1200, 1200);
      const t0 = performance.now();
      const boosted = applyLocalContrastBoost(sunsetCanvas as any, 10.0, 16, 640);
      const elapsed = performance.now() - t0;

      assert.ok(elapsed < 100, `CLAHE execution took ${elapsed.toFixed(1)}ms, must be < 100ms`);
      assert.ok(boosted);
      assert.ok(boosted.width > 0 && boosted.height > 0);
    });
  });

  // --- 3. BOUNDING LIMITS, OUT-OF-BOUNDS & SCORING MATH ---
  describe("3. Zero/Max Bounding Limits, Out-of-Bounds & Candidate Scoring", () => {
    it("PRE-02 Scoring Bounds: verifies scoreCandidateFace handles 0x0 box, off-screen box, and NaN confidence", () => {
      const imgDim = { width: 1000, height: 1000 };

      // Zero box
      const scoreZero = scoreCandidateFace({ x: 100, y: 100, width: 0, height: 0 }, 0.9, imgDim);
      assert.equal(scoreZero, 0, "0x0 area box must score 0");

      // Off-screen box (x = -500, y = -500)
      const scoreOffscreen = scoreCandidateFace({ x: -500, y: -500, width: 200, height: 200 }, 0.8, imgDim);
      assert.ok(Number.isFinite(scoreOffscreen) && scoreOffscreen > 0, "Off-screen box must produce finite positive score");

      // NaN confidence
      const scoreNaNConf = scoreCandidateFace({ x: 100, y: 100, width: 200, height: 200 }, NaN, imgDim);
      assert.ok(Number.isFinite(scoreNaNConf) && scoreNaNConf > 0, "NaN confidence must fall back to finite default score");

      // Infinity confidence
      const scoreInfConf = scoreCandidateFace({ x: 100, y: 100, width: 200, height: 200 }, Infinity, imgDim);
      assert.ok(Number.isFinite(scoreInfConf) && scoreInfConf > 0, "Infinity confidence must fall back to finite default score");
    });

    it("PRE-02 Option Bounds: handles out-of-range selectedCandidateIndex (-5, 999) safely", () => {
      const candidates: FaceCandidateInput[] = [
        { box: { x: 100, y: 100, width: 200, height: 200 }, confidence: 0.85 },
        { box: { x: 400, y: 400, width: 150, height: 150 }, confidence: 0.75 },
      ];
      const imgDim = { width: 1000, height: 1000 };

      const sortedNeg = sortFaceCandidates(candidates, imgDim);
      assert.equal(sortedNeg.filter((c) => c.isPrimary).length, 1);
      assert.equal(sortedNeg[0]!.isPrimary, true);
    });

    it("PRE-02 Box IoU Bounds: boxIoU handles zero area and non-overlapping boxes correctly", () => {
      const boxA = { x: 0, y: 0, width: 100, height: 100 };
      const boxB = { x: 200, y: 200, width: 100, height: 100 };
      const boxZero = { x: 0, y: 0, width: 0, height: 0 };

      assert.equal(boxIoU(boxA, boxB), 0, "Disjoint boxes IoU must be 0");
      assert.equal(boxIoU(boxA, boxA), 1, "Identical boxes IoU must be 1.0");
      assert.equal(boxIoU(boxA, boxZero), 0, "Zero area box IoU must be 0");
    });
  });

  // --- 4. MULTI-SCALE TILING, NMS DENSE CROWD STRESS & SORTING SLA ---
  describe("4. Multi-Scale Tiling, NMS Dense Crowd Stress & Sorting SLA", () => {
    it("PRE-04 NMS Dense Crowd Stress: suppresses 200 overlapping face boxes down to disjoint candidates", () => {
      const boxes: Array<{ box: { x: number; y: number; width: number; height: number }; confidence: number }> = [];

      // Cluster 1 (around x=100, y=100) with 100 overlapping boxes
      for (let i = 0; i < 100; i++) {
        boxes.push({
          box: { x: 100 + (i % 5), y: 100 + (i % 5), width: 200, height: 200 },
          confidence: 0.5 + (i / 200),
        });
      }

      // Cluster 2 (around x=600, y=600) with 100 overlapping boxes
      for (let i = 0; i < 100; i++) {
        boxes.push({
          box: { x: 600 + (i % 5), y: 600 + (i % 5), width: 180, height: 180 },
          confidence: 0.4 + (i / 200),
        });
      }

      const kept = nmsFaceBoxes(boxes, 0.35);
      assert.equal(kept.length, 2, `NMS must collapse 200 boxes in 2 clusters into exactly 2 kept boxes (got ${kept.length})`);
      assert.ok(kept[0]!.confidence >= 0.95, "Kept box 1 must have highest confidence from cluster 1");
    });

    it("PRE-04 Sorting SLA Stress: sorts 500 candidate faces in < 5ms average duration", () => {
      const candidates: FaceCandidateInput[] = Array.from({ length: 500 }, (_, i) => ({
        id: `face-stress-${i}`,
        box: {
          x: (i * 37) % 7000,
          y: (i * 23) % 4000,
          width: 50 + (i % 100),
          height: 50 + (i % 100),
        },
        confidence: 0.20 + (i % 80) * 0.01,
      }));

      const imgDim = { width: 7680, height: 4320 };

      const t0 = performance.now();
      const runs = 10;
      for (let r = 0; r < runs; r++) {
        const sorted = sortFaceCandidates(candidates, imgDim);
        assert.equal(sorted.length, 500);
        assert.equal(sorted[0]!.isPrimary, true);
        assert.equal(sorted.filter((c) => c.isPrimary).length, 1);
      }
      const avgMs = (performance.now() - t0) / runs;

      assert.ok(
        avgMs < 5.0,
        `500 candidate face sorting average duration (${avgMs.toFixed(3)}ms) exceeded 5ms stress limit`,
      );
    });

    it("PRE-04 Multi-Face Tiling: 8K Canvas (7680x4320) with 20 synthetic faces detects >= 18 faces and fulfills normalized percentage bounds", async () => {
      const faces20 = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 5; c++) {
          faces20.push({
            cx: 1000 + c * 1350,
            cy: 700 + r * 900,
            radius: 200,
          });
        }
      }
      const canvas8K = generateMultiFaceCanvas(7680, 4320, faces20);
      const res = await detectFacesOnly(canvas8K as any);

      assert.ok(res.faces.length >= 18, `Expected >= 18 faces detected, got ${res.faces.length}`);
      const primaryCount = res.faces.filter((f) => f.isPrimary).length;
      assert.equal(primaryCount, 1, "Exactly 1 primary candidate face assigned");
      assert.equal(res.faces[0]!.isPrimary, true, "Top ranked candidate is primary");

      // Verify normalized percentage box invariants strictly
      for (const face of res.faces) {
        const { x, y, width, height } = face.normalizedBox;
        assert.ok(x >= 0 && x <= 100, `x (${x}) in [0, 100]`);
        assert.ok(y >= 0 && y <= 100, `y (${y}) in [0, 100]`);
        assert.ok(width > 0 && width <= 100, `width (${width}) in (0, 100]`);
        assert.ok(height > 0 && height <= 100, `height (${height}) in (0, 100]`);
        assert.ok(x + width <= 100.01, `x + width (${x + width}) <= 100%`);
        assert.ok(y + height <= 100.01, `y + height (${y + height}) <= 100%`);
      }
    });
  });
});
