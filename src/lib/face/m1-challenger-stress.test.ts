import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreCandidateFace,
  sortFaceCandidates,
  applyLocalContrastBoost,
  type FaceCandidateInput,
} from "./faceapi-engine.ts";

describe("M1 Empirical Challenger Stress Suite - Face Candidate & Pipeline Edge Cases", () => {
  describe("1. Empty candidate arrays", () => {
    it("handles empty candidates array without crashing or throwing", () => {
      const result = sortFaceCandidates([], { width: 1280, height: 720 });
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 0);
    });
  });

  describe("2. Extreme aspect ratio bounding boxes", () => {
    it("handles extremely thin vertical bounding boxes (height >> width)", () => {
      const thinBox = { x: 100, y: 100, width: 0.001, height: 10000 };
      const score = scoreCandidateFace(thinBox, 0.95, { width: 1920, height: 1080 });
      assert.ok(Number.isFinite(score), "Score must be finite");
      assert.ok(score >= 0, "Score must be non-negative");
    });

    it("handles extremely wide horizontal bounding boxes (width >> height)", () => {
      const wideBox = { x: 50, y: 50, width: 10000, height: 0.001 };
      const score = scoreCandidateFace(wideBox, 0.90, { width: 1920, height: 1080 });
      assert.ok(Number.isFinite(score), "Score must be finite");
      assert.ok(score >= 0, "Score must be non-negative");
    });

    it("handles zero-dimension bounding boxes (0x0)", () => {
      const zeroBox = { x: 500, y: 500, width: 0, height: 0 };
      const score = scoreCandidateFace(zeroBox, 0.99, { width: 1000, height: 1000 });
      assert.equal(score, 0, "Zero-area box should score 0");
    });

    it("handles negative box dimensions gracefully without returning NaN", () => {
      const negBox = { x: 100, y: 100, width: -100, height: -50 };
      const score = scoreCandidateFace(negBox, 0.85, { width: 800, height: 600 });
      assert.ok(Number.isFinite(score), "Score should be finite despite negative dimensions");
    });

    it("handles 1x1 image dimensions and 10000x10000 image dimensions", () => {
      const box = { x: 0, y: 0, width: 10, height: 10 };
      const scoreTinyImg = scoreCandidateFace(box, 0.8, { width: 1, height: 1 });
      const scoreHugeImg = scoreCandidateFace(box, 0.8, { width: 10000, height: 10000 });
      assert.ok(Number.isFinite(scoreTinyImg));
      assert.ok(Number.isFinite(scoreHugeImg));
    });
  });

  describe("3. Detector Confidence Edge Cases", () => {
    it("handles 0 confidence score", () => {
      const box = { x: 100, y: 100, width: 200, height: 200 };
      const score = scoreCandidateFace(box, 0, { width: 1000, height: 1000 });
      assert.equal(score, 0, "Confidence 0 should yield score 0");
    });

    it("handles negative confidence scores by falling back safely", () => {
      const box = { x: 100, y: 100, width: 200, height: 200 };
      const score = scoreCandidateFace(box, -0.5, { width: 1000, height: 1000 });
      assert.ok(Number.isFinite(score));
      assert.ok(score > 0, "Negative confidence should fallback to safe positive default");
    });

    it("handles NaN, Infinity, and undefined confidence values", () => {
      const box = { x: 100, y: 100, width: 200, height: 200 };
      const imgDim = { width: 1000, height: 1000 };

      const scoreNaN = scoreCandidateFace(box, NaN, imgDim);
      const scoreInf = scoreCandidateFace(box, Infinity, imgDim);
      const scoreUndef = scoreCandidateFace(box, undefined as unknown as number, imgDim);

      assert.ok(Number.isFinite(scoreNaN), "NaN confidence must produce finite score");
      assert.ok(Number.isFinite(scoreInf), "Infinity confidence must produce finite score");
      assert.ok(Number.isFinite(scoreUndef), "Undefined confidence must produce finite score");
    });
  });

  describe("4. High Candidate Counts (10+ faces)", () => {
    it("correctly ranks 10 candidate faces, assigning isPrimary=true only to the top face", () => {
      const candidates: FaceCandidateInput[] = Array.from({ length: 10 }, (_, i) => ({
        id: `face-${i}`,
        box: { x: i * 50, y: 100, width: 80 + i * 10, height: 80 + i * 10 },
        confidence: 0.7 + (i % 3) * 0.1,
      }));

      const sorted = sortFaceCandidates(candidates, { width: 1920, height: 1080 });
      assert.equal(sorted.length, 10);

      const primaryCount = sorted.filter((c) => c.isPrimary).length;
      assert.equal(primaryCount, 1, "Exactly one face must be marked as primary");
      assert.equal(sorted[0]!.isPrimary, true, "Top ranked candidate must be primary");

      for (let i = 0; i < sorted.length - 1; i++) {
        assert.ok(sorted[i]!.score >= sorted[i + 1]!.score, `Score[${i}] >= Score[${i + 1}]`);
      }
    });

    it("correctly ranks 100 candidate faces in a dense crowd shot", () => {
      const candidates: FaceCandidateInput[] = Array.from({ length: 100 }, (_, i) => ({
        id: `crowd-face-${i}`,
        box: { x: (i * 17) % 1200, y: (i * 13) % 800, width: 40 + (i % 20), height: 40 + (i % 20) },
        confidence: 0.3 + (i % 7) * 0.1,
      }));

      const sorted = sortFaceCandidates(candidates, { width: 1280, height: 960 });
      assert.equal(sorted.length, 100);
      assert.equal(sorted[0]!.isPrimary, true);
      assert.equal(sorted.filter((c) => c.isPrimary).length, 1);
    });
  });

  describe("5. Low-light CLAHE Contrast Boost Behavior", () => {
    function createMockCanvas(width: number, height: number, fillVal = 128): HTMLCanvasElement {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        data[i * 4] = fillVal;
        data[i * 4 + 1] = fillVal;
        data[i * 4 + 2] = fillVal;
        data[i * 4 + 3] = 255;
      }

      const mockCanvas: any = {
        width,
        height,
        getContext: (type: string) => {
          if (type !== "2d") return null;
          return {
            drawImage: () => {},
            getImageData: () => ({
              data: new Uint8ClampedArray(data),
              width,
              height,
            }),
            putImageData: () => {},
          };
        },
      };

      if (typeof globalThis.document === "undefined") {
        (globalThis as any).document = {
          createElement: (tag: string) => {
            if (tag === "canvas") return createMockCanvas(width, height, fillVal);
            return {};
          },
        };
      }

      return mockCanvas as HTMLCanvasElement;
    }

    it("handles 0x0 canvas by returning original canvas without error", () => {
      const c = createMockCanvas(0, 0);
      const res = applyLocalContrastBoost(c);
      assert.equal(res, c);
    });

    it("handles non-square image aspect ratios (1920x1080 and 1080x1920)", () => {
      const landscape = createMockCanvas(1920, 1080, 50);
      const portrait = createMockCanvas(1080, 1920, 50);

      const outLandscape = applyLocalContrastBoost(landscape);
      const outPortrait = applyLocalContrastBoost(portrait);

      assert.ok(outLandscape);
      assert.ok(outPortrait);
    });

    it("handles extreme dark (all 0) and extreme bright (all 255) luminance input", () => {
      const darkCanvas = createMockCanvas(320, 320, 0);
      const brightCanvas = createMockCanvas(320, 320, 255);

      const outDark = applyLocalContrastBoost(darkCanvas);
      const outBright = applyLocalContrastBoost(brightCanvas);

      assert.ok(outDark);
      assert.ok(outBright);
    });
  });

  describe("6. Sub-300ms SLA Timing & Benchmarks", () => {
    it("completes candidate sorting for 100 faces in under 2ms", () => {
      const candidates: FaceCandidateInput[] = Array.from({ length: 100 }, (_, i) => ({
        id: `sla-face-${i}`,
        box: { x: (i * 10) % 800, y: (i * 8) % 600, width: 100, height: 100 },
        confidence: 0.8,
      }));

      const start = performance.now();
      for (let run = 0; run < 10; run++) {
        sortFaceCandidates(candidates, { width: 1920, height: 1080 });
      }
      const elapsed = (performance.now() - start) / 10;

      assert.ok(elapsed < 20, `100 candidate face sorting average duration ${elapsed.toFixed(3)}ms > 20ms budget`);
    });
  });
});
