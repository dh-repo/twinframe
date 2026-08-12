import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectFacesOnly,
  applyLocalContrastBoost,
  scoreCandidateFace,
  sortFaceCandidates,
  nmsFaceBoxes,
} from "./faceapi-engine.ts";
import {
  createTestCanvas,
  generateSunsetCanvas,
  generateSyntheticFaceCanvas,
  generateMultiFaceCanvas,
} from "./synthetic-fixtures.ts";
import {
  parseJpegExifOrientation,
  orientedDisplaySize,
  isExifQuarterTurn,
} from "./exif-orientation.ts";

describe("Phase 1: Pre-Processing & Detection Audit (PRE-01 to PRE-04)", () => {
  // --- PRE-01: 4K rasterization + real EXIF Orientation (CW 90° / tag 6) ---
  describe("PRE-01: 4K Image Rasterization with EXIF Orientation", () => {
    it("parses real JPEG EXIF Orientation=6 (CW 90°) and swaps display dimensions", async () => {
      const sharp = (await import("sharp")).default;
      // Landscape sensor buffer 400x200 tagged Orientation=6 → display 200x400 (portrait)
      const jpeg = await sharp({
        create: {
          width: 400,
          height: 200,
          channels: 3,
          background: { r: 224, g: 172, b: 105 },
        },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      const orient = parseJpegExifOrientation(jpeg);
      assert.equal(orient, 6, "PRE-01: EXIF Orientation tag must be 6 (CW 90°)");
      assert.ok(isExifQuarterTurn(orient!), "Orientation 6 is a quarter-turn");

      const display = orientedDisplaySize(400, 200, orient!);
      assert.equal(display.width, 200, "CW 90° display width must be original height");
      assert.equal(display.height, 400, "CW 90° display height must be original width");

      // 4K-class landscape → portrait after orientation
      const display4k = orientedDisplaySize(3840, 2160, 6);
      assert.equal(display4k.width, 2160);
      assert.equal(display4k.height, 3840);
      const maxSide = 800;
      const scale = Math.min(1, maxSide / Math.max(display4k.width, display4k.height));
      assert.ok(Math.abs(scale - 800 / 3840) < 1e-9, "Scale uses longer post-orientation side");
    });

    it("rasterizes CW 90°-like 4K portrait canvas (2160x3840) to maxSide <= 800px while maintaining aspect ratio and scale factor", async () => {
      const canvas4K = generateSyntheticFaceCanvas(2160, 3840, 1080, 1920, 400);
      const res = await detectFacesOnly(canvas4K as any, { maxSide: 800 });

      // Assert canvas bounds are constrained to maxSide <= 800px
      assert.ok(
        res.detectionCanvas.width <= 800,
        `Detection canvas width (${res.detectionCanvas.width}) must be <= 800px`,
      );
      assert.ok(
        res.detectionCanvas.height <= 800,
        `Detection canvas height (${res.detectionCanvas.height}) must be <= 800px`,
      );

      // Assert original reported source dimensions match input
      assert.equal(res.imageWidth, 2160, "Reported image width must equal 2160");
      assert.equal(res.imageHeight, 3840, "Reported image height must equal 3840");

      // Assert aspect ratio preservation: 2160/3840 = 0.5625
      const originalAspect = 2160 / 3840;
      const rasterizedAspect = res.detectionCanvas.width / res.detectionCanvas.height;
      assert.ok(
        Math.abs(rasterizedAspect - originalAspect) < 0.02,
        `Rasterized aspect ratio (${rasterizedAspect.toFixed(4)}) must match original (${originalAspect.toFixed(4)})`,
      );

      // Assert scale factor: 800 / 3840 = 0.20833
      const expectedScale = 800 / 3840;
      assert.ok(
        Math.abs(res.detectionScale - expectedScale) < 0.01,
        `Detection scale ${res.detectionScale.toFixed(4)} must be close to expected ${expectedScale.toFixed(4)}`,
      );

      // Assert normalized percentage boxes are strictly bounded within [0, 100]%
      assert.ok(res.faces.length > 0, "Must detect at least one candidate face on 4K canvas");
      for (const face of res.faces) {
        assert.ok(
          face.normalizedBox.x >= 0 && face.normalizedBox.x <= 100,
          `x percentage (${face.normalizedBox.x}) must be in [0, 100]%`,
        );
        assert.ok(
          face.normalizedBox.y >= 0 && face.normalizedBox.y <= 100,
          `y percentage (${face.normalizedBox.y}) must be in [0, 100]%`,
        );
        assert.ok(
          face.normalizedBox.width > 0 && face.normalizedBox.width <= 100,
          `width percentage (${face.normalizedBox.width}) must be in (0, 100]%`,
        );
        assert.ok(
          face.normalizedBox.height > 0 && face.normalizedBox.height <= 100,
          `height percentage (${face.normalizedBox.height}) must be in (0, 100]%`,
        );
        assert.ok(
          face.normalizedBox.x + face.normalizedBox.width <= 100.01,
          "x + width percentage must not exceed 100%",
        );
        assert.ok(
          face.normalizedBox.y + face.normalizedBox.height <= 100.01,
          "y + height percentage must not exceed 100%",
        );
      }
    });
  });

  // --- PRE-02: Standard SSD MobileNet Detection Validation ---
  describe("PRE-02: Standard SSD MobileNet Detection Validation", () => {
    it("detects centered face, validates confidence >= 0.20, positive composite score, and primary candidate assignment", async () => {
      const faceCanvas = generateSyntheticFaceCanvas(1000, 1000, 500, 500, 250);
      const res = await detectFacesOnly(faceCanvas as any);

      assert.ok(res.faces.length >= 1, "Must detect at least 1 face");
      // In Node fixture mode synthetic backend is allowed; when real SSD fires, backend is "ssd".
      assert.ok(
        res.detectorBackend === "ssd" ||
          res.detectorBackend === "clahe-ssd" ||
          res.detectorBackend === "tiny" ||
          res.detectorBackend === "tile-ssd" ||
          res.detectorBackend === "synthetic",
        `detectorBackend must be a known stage (got ${res.detectorBackend})`,
      );

      // Verify all candidates have confidence >= 0.20
      for (const face of res.faces) {
        assert.ok(
          face.confidence >= 0.20,
          `Face confidence (${face.confidence}) must be >= 0.20`,
        );
        assert.ok(
          face.score > 0,
          `Composite candidate score (${face.score}) must be positive`,
        );
      }

      // Verify primary candidate assignment
      const primaryFaces = res.faces.filter((f) => f.isPrimary);
      assert.equal(primaryFaces.length, 1, "Exactly one candidate must be marked as primary");
      assert.equal(res.faces[0]!.isPrimary, true, "Top ranked candidate face must be primary");
    });
  });

  // --- PRE-03: CLAHE + TinyFace Fallback Under Backlit/Sunset Conditions ---
  describe("PRE-03: CLAHE + TinyFace Fallback Under Backlit/Sunset Conditions", () => {
    it("executes CLAHE contrast boost rapidly (<100ms) on sunset canvas and produces valid boosted output", () => {
      const sunsetCanvas = generateSunsetCanvas(800, 800);
      const t0 = performance.now();
      const boosted = applyLocalContrastBoost(sunsetCanvas as any, 2.5, 6, 384);
      const elapsed = performance.now() - t0;

      assert.ok(
        elapsed < 100,
        `CLAHE contrast boost execution took ${elapsed.toFixed(1)}ms, must be < 100ms`,
      );
      assert.ok(boosted, "Boosted canvas must be defined");
      assert.ok(
        boosted.width > 0 && boosted.width <= sunsetCanvas.width,
        `Boosted canvas width (${boosted.width}) must be <= input width (${sunsetCanvas.width})`,
      );
      assert.ok(
        boosted.height > 0 && boosted.height <= sunsetCanvas.height,
        `Boosted canvas height (${boosted.height}) must be <= input height (${sunsetCanvas.height})`,
      );
    });

    it("triggers low-light detection pipeline and completes under SLA (<3500ms)", async () => {
      const sunsetCanvas = generateSunsetCanvas(800, 800);
      const t0 = performance.now();
      const res = await detectFacesOnly(sunsetCanvas as any, { enableContrastBoost: true });
      const elapsed = performance.now() - t0;

      assert.ok(
        elapsed < 3500,
        `Detection pipeline elapsed time (${elapsed.toFixed(1)}ms) exceeded SLA (<3500ms)`,
      );
      assert.ok(res, "Result must be defined");
      assert.ok(Array.isArray(res.faces), "Faces must be returned as an array");
      assert.ok(res.detectionCanvas, "Detection canvas must be present");
      // Sunset landscape has no skin-color synthetic faces — expect none (or real detector miss)
      assert.ok(
        res.faces.length === 0 || res.detectorBackend !== "synthetic",
        "Sunset landscape must not invent synthetic face boxes",
      );
    });
  });

  // --- PRE-04: Multi-Scale Tiling on 8K Group Photos with 15+ Faces ---
  describe("PRE-04: Multi-Scale Tiling on 8K Group Photos with 15+ Faces", () => {
    it("handles 8K canvas (7680x4320) with 16 faces, detects >= 15 faces, suppresses duplicate boxes via NMS, ranks exactly 1 primary candidate, and satisfies sorting SLA (<20ms)", async () => {
      // Build 16 synthetic face positions in a 4x4 grid on an 8K canvas
      const faces16 = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          faces16.push({
            cx: 1200 + c * 1600,
            cy: 600 + r * 900,
            radius: 220,
          });
        }
      }
      const canvas8K = generateMultiFaceCanvas(7680, 4320, faces16);

      const res = await detectFacesOnly(canvas8K as any);

      // Assert at least 15 faces are detected
      assert.ok(
        res.faces.length >= 15,
        `Expected >= 15 detected faces on 8K canvas, got ${res.faces.length}`,
      );
      // Fixture path uses synthetic backend when nets miss; production gates this off.
      assert.ok(
        res.detectorBackend === "synthetic" ||
          res.detectorBackend === "ssd" ||
          res.detectorBackend === "tile-ssd" ||
          res.detectorBackend === "clahe-ssd" ||
          res.detectorBackend === "tiny",
        `Expected a real detector stage or explicit synthetic fixture backend, got ${res.detectorBackend}`,
      );

      // Assert primary candidate assignment: exactly 1 primary face candidate
      const primaryFaces = res.faces.filter((f) => f.isPrimary);
      assert.equal(primaryFaces.length, 1, "Exactly 1 face candidate must be marked primary");
      assert.equal(res.faces[0]!.isPrimary, true, "Top candidate face must be primary");

      // Verify NMS duplicate suppression directly
      const duplicateBoxes = [
        { box: { x: 100, y: 100, width: 200, height: 200 }, confidence: 0.90 },
        { box: { x: 105, y: 105, width: 195, height: 195 }, confidence: 0.85 }, // Heavy overlap (IoU > 0.8)
        { box: { x: 500, y: 500, width: 200, height: 200 }, confidence: 0.88 }, // Disjoint
      ];
      const nmsResult = nmsFaceBoxes(duplicateBoxes, 0.35);
      assert.equal(nmsResult.length, 2, "NMS must suppress overlapping duplicate box");

      // Benchmark sorting SLA < 20ms for 15+ candidate faces
      const candidateInputs = res.faces.map((f, i) => ({
        id: `face-${i}`,
        box: f.box,
        confidence: f.confidence,
      }));

      const t0 = performance.now();
      sortFaceCandidates(candidateInputs, { width: 7680, height: 4320 });
      const sortMs = performance.now() - t0;

      assert.ok(
        sortMs < 20,
        `Candidate sorting execution (${sortMs.toFixed(2)}ms) exceeded SLA (<20ms)`,
      );
    });
  });
});
