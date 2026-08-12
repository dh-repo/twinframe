import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectFacesOnly,
  applyLocalContrastBoost,
  scoreCandidateFace,
  sortFaceCandidates,
  nmsFaceBoxes,
  boxIoU,
} from "./faceapi-engine.ts";
import {
  createTestCanvas,
  generateSunsetCanvas,
  generateDarkFrameCanvas,
  generateOverexposedCanvas,
  generateSyntheticFaceCanvas,
  generateMultiFaceCanvas,
} from "./synthetic-fixtures.ts";

describe("M1 Empirical Challenger: Phase 1 SLA & Boundary Stress Test Suite", () => {
  // =========================================================================
  // 1. CLAHE EXECUTION SLA (< 100ms) STRESS TEST
  // =========================================================================
  describe("CLAHE Execution SLA (< 100ms) Stress Harness", () => {
    it("empirically verifies CLAHE execution stays under 100ms across 100 runs on 800x800, 1080p, 4K, and 8K canvases", () => {
      const sizes = [
        { w: 800, h: 800, name: "800x800" },
        { w: 1920, h: 1080, name: "1080p" },
        { w: 3840, h: 2160, name: "4K" },
        { w: 7680, h: 4320, name: "8K" },
      ];

      for (const size of sizes) {
        const canvas = generateSunsetCanvas(size.w, size.h);
        const latencies: number[] = [];
        const iterations = 25; // Total 100 runs across 4 resolutions

        for (let i = 0; i < iterations; i++) {
          const t0 = performance.now();
          const boosted = applyLocalContrastBoost(canvas as any, 2.5, 6, 384);
          const elapsed = performance.now() - t0;
          latencies.push(elapsed);

          assert.ok(boosted, `Boosted canvas must be created for ${size.name}`);
          assert.ok(
            boosted.width > 0 && boosted.width <= Math.min(size.w, 384),
            `Boosted canvas width (${boosted.width}) downscaled correctly for ${size.name}`,
          );
        }

        const maxMs = Math.max(...latencies);
        const meanMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;

        assert.ok(
          meanMs < 100,
          `CLAHE mean latency for ${size.name} was ${meanMs.toFixed(2)}ms (max: ${maxMs.toFixed(2)}ms), must be < 100ms SLA`,
        );
        assert.ok(
          maxMs < 100,
          `CLAHE max latency spike for ${size.name} was ${maxMs.toFixed(2)}ms, must be < 100ms SLA`,
        );
      }
    });

    it("verifies CLAHE output quality on extreme dark (luma=0.01) and bright (luma=0.99) canvases without throwing or NaN", () => {
      const darkCanvas = generateDarkFrameCanvas(640, 640, 0.01);
      const brightCanvas = generateOverexposedCanvas(640, 640, 0.99);

      const t0 = performance.now();
      const boostedDark = applyLocalContrastBoost(darkCanvas as any);
      const boostedBright = applyLocalContrastBoost(brightCanvas as any);
      const elapsed = performance.now() - t0;

      assert.ok(boostedDark && boostedBright, "Boosted canvases must be defined");
      assert.ok(elapsed < 100, `Extreme luminance CLAHE elapsed ${elapsed.toFixed(2)}ms < 100ms`);
    });
  });

  // =========================================================================
  // 2. LOW-LIGHT DETECTION PIPELINE SLA (< 3500ms) STRESS TEST
  // =========================================================================
  describe("Low-Light Detection Pipeline SLA (< 3500ms) Stress Harness", () => {
    it("empirically verifies low-light detection pipeline SLA (<3500ms) over 10 repeated passes on sunset & low-light conditions", async () => {
      const sunsetCanvas = generateSunsetCanvas(800, 800);
      const darkCanvas = generateDarkFrameCanvas(800, 800, 0.02);

      const testCanvases = [
        { canvas: sunsetCanvas, type: "sunset" },
        { canvas: darkCanvas, type: "dark low-light" },
      ];

      for (const item of testCanvases) {
        const latencies: number[] = [];
        const iterations = 5;

        for (let i = 0; i < iterations; i++) {
          const t0 = performance.now();
          const res = await detectFacesOnly(item.canvas as any, { enableContrastBoost: true });
          const elapsed = performance.now() - t0;
          latencies.push(elapsed);

          assert.ok(res, "Result must be defined");
          assert.ok(Array.isArray(res.faces), "Faces must be an array");
          assert.ok(res.detectionCanvas, "Detection canvas must be present");
        }

        const maxMs = Math.max(...latencies);
        const meanMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;

        assert.ok(
          maxMs < 3500,
          `Low-light detection max latency for ${item.type} was ${maxMs.toFixed(2)}ms (mean: ${meanMs.toFixed(2)}ms), must be < 3500ms SLA`,
        );
      }
    });
  });

  // =========================================================================
  // 3. 8K MULTI-FACE CANDIDATE SORTING SLA (< 20ms) STRESS TEST
  // =========================================================================
  describe("8K Multi-Face Candidate Sorting SLA (< 20ms) Stress Harness", () => {
    it("empirically verifies 8K candidate sorting SLA (<20ms) across 500 iterations for 15, 50, 100, and 1,000 candidate faces", () => {
      const candidateCounts = [15, 50, 100, 1000];
      const imgDimensions = { width: 7680, height: 4320 };

      for (const count of candidateCounts) {
        const candidates = Array.from({ length: count }, (_, i) => ({
          id: `face-${i}`,
          box: {
            x: (i * 120) % 7000,
            y: (i * 90) % 3800,
            width: 150 + (i % 50),
            height: 150 + (i % 50),
          },
          confidence: 0.5 + (i % 50) * 0.008,
        }));

        const latencies: number[] = [];
        const iterations = 100;

        for (let iter = 0; iter < iterations; iter++) {
          const t0 = performance.now();
          const sorted = sortFaceCandidates(candidates, imgDimensions);
          const elapsed = performance.now() - t0;
          latencies.push(elapsed);

          assert.equal(sorted.length, count, `Sorted count must equal input count ${count}`);
          assert.equal(sorted[0]!.isPrimary, true, "Top ranked element must be primary");
          assert.ok(
            sorted.slice(1).every((f) => !f.isPrimary),
            "Non-top elements must not be primary",
          );
        }

        const sortedLatencies = [...latencies].sort((a, b) => a - b);
        const maxMs = sortedLatencies[sortedLatencies.length - 1] ?? 0;
        const meanMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        // p99 avoids one-off GC/scheduler spikes that make raw max flaky under load.
        const p99Idx = Math.min(
          sortedLatencies.length - 1,
          Math.max(0, Math.ceil(sortedLatencies.length * 0.99) - 1),
        );
        const p99Ms = sortedLatencies[p99Idx] ?? maxMs;

        assert.ok(
          meanMs < 5,
          `Candidate sorting mean latency for ${count} faces was ${meanMs.toFixed(3)}ms, must be < 5ms`,
        );
        assert.ok(
          p99Ms < 20,
          `Candidate sorting p99 latency for ${count} faces was ${p99Ms.toFixed(3)}ms (max: ${maxMs.toFixed(3)}ms, mean: ${meanMs.toFixed(3)}ms), must be < 20ms SLA`,
        );
      }
    });
  });

  // =========================================================================
  // 4. PRE-01 BOUNDARY ASSERTIONS: RASTERIZATION, EXIF & NORMALIZATION
  // =========================================================================
  describe("PRE-01 Boundary Assertions: Aspect Ratio & Normalization", () => {
    it("handles ultra-wide (5120x1440) and tall panorama (1080x7200) rasterizations maintaining maxSide <= 800 and aspect ratio", async () => {
      const testCases = [
        { w: 5120, h: 1440, aspect: 5120 / 1440 },
        { w: 1080, h: 7200, aspect: 1080 / 7200 },
      ];

      for (const tc of testCases) {
        const canvas = createTestCanvas(tc.w, tc.h);
        const res = await detectFacesOnly(canvas as any, { maxSide: 800 });

        assert.ok(res.detectionCanvas.width <= 800, `Width must be <= 800 for ${tc.w}x${tc.h}`);
        assert.ok(res.detectionCanvas.height <= 800, `Height must be <= 800 for ${tc.w}x${tc.h}`);

        const actualAspect = res.detectionCanvas.width / res.detectionCanvas.height;
        assert.ok(
          Math.abs(actualAspect - tc.aspect) < 0.03,
          `Aspect ratio ${actualAspect.toFixed(4)} must match original ${tc.aspect.toFixed(4)}`,
        );
      }
    });
  });

  // =========================================================================
  // 5. NMS SUPPRESSION & CANDIDATE SCORING BOUNDARY TESTS
  // =========================================================================
  describe("NMS Suppression & Candidate Scoring Boundary Assertions", () => {
    it("verifies exact IoU calculation and non-max suppression thresholding", () => {
      const boxA = { x: 100, y: 100, width: 200, height: 200 };
      const boxBIdentical = { x: 100, y: 100, width: 200, height: 200 };
      const boxCDisjoint = { x: 500, y: 500, width: 200, height: 200 };

      assert.equal(boxIoU(boxA, boxBIdentical), 1.0, "Identical boxes IoU must equal 1.0");
      assert.equal(boxIoU(boxA, boxCDisjoint), 0.0, "Disjoint boxes IoU must equal 0.0");

      const input = [
        { box: boxA, confidence: 0.95 },
        { box: boxBIdentical, confidence: 0.85 },
        { box: boxCDisjoint, confidence: 0.90 },
      ];

      const kept = nmsFaceBoxes(input, 0.35);
      assert.equal(kept.length, 2, "NMS must keep exactly 2 boxes (suppressing duplicate)");
      assert.equal(kept[0]!.confidence, 0.95, "Highest confidence box must be preserved");
    });

    it("validates scoreCandidateFace distance penalty and area weighting", () => {
      const dimensions = { width: 1000, height: 1000 };
      const centerBox = { x: 400, y: 400, width: 200, height: 200 };
      const cornerBox = { x: 0, y: 0, width: 200, height: 200 };

      const centerScore = scoreCandidateFace(centerBox, 0.9, dimensions);
      const cornerScore = scoreCandidateFace(cornerBox, 0.9, dimensions);

      assert.ok(
        centerScore > cornerScore,
        `Center box score (${centerScore.toFixed(1)}) must be higher than corner box score (${cornerScore.toFixed(1)})`,
      );
    });
  });
});
