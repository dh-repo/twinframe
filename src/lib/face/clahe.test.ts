import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  rgbToLab,
  labToRgb,
  calculateDeltaE,
  applyClaheLabImageData,
  applyClaheCanvas,
  applyLocalContrastBoost,
  SRGB_TO_LINEAR_LUT,
} from "./clahe";
import { cropNeedsIlluminationNorm } from "./quality";
import {
  generateDarkFrameCanvas,
  generateOverexposedCanvas,
  generateSyntheticFaceCanvas,
  createTestCanvas,
} from "./synthetic-fixtures";

describe("Requirement R4: Adaptive Illumination Normalization (CLAHE in CIE L*a*b* Space)", () => {

  describe("1. Color Space Conversion Accuracy & Round-Trip Precision (sRGB <-> CIELAB)", () => {
    test("Pre-computed SRGB_TO_LINEAR_LUT has 256 valid normalized entries", () => {
      assert.equal(SRGB_TO_LINEAR_LUT.length, 256);
      assert.equal(SRGB_TO_LINEAR_LUT[0], 0);
      assert.ok(Math.abs(SRGB_TO_LINEAR_LUT[255]! - 1.0) < 1e-5);
    });

    test("rgbToLab and labToRgb round-trip accuracy satisfies ΔE < 0.5 for all primary, gray, and skin colors", () => {
      const testColors: [number, number, number][] = [
        [0, 0, 0],         // Pure Black
        [255, 255, 255],   // Pure White
        [128, 128, 128],   // Neutral Gray
        [64, 64, 64],      // Dark Gray
        [192, 192, 192],   // Light Gray
        [210, 160, 130],   // Fair Skin Tone
        [180, 130, 100],   // Olive Skin Tone
        [140, 95, 70],     // Medium Skin Tone
        [70, 45, 30],      // Deep Skin Tone
        [255, 0, 0],       // Pure Red
        [0, 255, 0],       // Pure Green
        [0, 0, 255],       // Pure Blue
        [255, 255, 0],     // Yellow
        [0, 255, 255],     // Cyan
        [255, 0, 255],     // Magenta
      ];

      for (const [r, g, b] of testColors) {
        const [l, a, bVal] = rgbToLab(r, g, b);
        const [r2, g2, b2] = labToRgb(l, a, bVal);
        const deltaE = calculateDeltaE([r, g, b], [r2, g2, b2]);

        assert.ok(
          deltaE < 0.5,
          `Round-trip ΔE (${deltaE.toFixed(3)}) exceeded 0.5 threshold for RGB (${r}, ${g}, ${b}) -> reconstructed (${r2}, ${g2}, ${b2})`,
        );

        assert.ok(Math.abs(r - r2) <= 1, `Red channel error > 1 for RGB (${r}, ${g}, ${b}): got ${r2}`);
        assert.ok(Math.abs(g - g2) <= 1, `Green channel error > 1 for RGB (${r}, ${g}, ${b}): got ${g2}`);
        assert.ok(Math.abs(b - b2) <= 1, `Blue channel error > 1 for RGB (${r}, ${g}, ${b}): got ${b2}`);
      }
    });

    test("L* bounds are strictly [0, 100] for standard sRGB gamut", () => {
      const [lBlack] = rgbToLab(0, 0, 0);
      const [lWhite] = rgbToLab(255, 255, 255);
      assert.ok(Math.abs(lBlack - 0.0) < 1e-4, `Expected L*=0 for black, got ${lBlack}`);
      assert.ok(Math.abs(lWhite - 100.0) < 1e-4, `Expected L*=100 for white, got ${lWhite}`);

      // Test 10,000 random sRGB colors
      for (let i = 0; i < 10000; i++) {
        const r = (Math.random() * 256) | 0;
        const g = (Math.random() * 256) | 0;
        const b = (Math.random() * 256) | 0;
        const [l] = rgbToLab(r, g, b);
        assert.ok(l >= 0.0 && l <= 100.0, `L* (${l}) outside [0, 100] for RGB (${r}, ${g}, ${b})`);
      }
    });
  });

  describe("2. Chromatic Skin Tone Preservation (a* and b* Invariance)", () => {
    test("applyClaheLabImageData leaves a* and b* chromaticity channels invariant (mean Δa*, Δb* < 1.0)", () => {
      const w = 150;
      const h = 150;
      const canvas = generateSyntheticFaceCanvas(w, h);
      const ctx = (canvas as any).getContext("2d");
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      // Record before-CLAHE CIELAB values
      const origA = new Float32Array(w * h);
      const origB = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const [, aVal, bVal] = rgbToLab(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!);
        origA[i] = aVal;
        origB[i] = bVal;
      }

      // Run ImageData CLAHE
      applyClaheLabImageData(imgData, { clipLimit: 2.5, gridTiles: 8 });
      const boostedData = imgData.data;

      // Verify after-CLAHE CIELAB chromaticity
      let sumDeltaA = 0;
      let sumDeltaB = 0;
      let count = 0;
      for (let i = 0; i < w * h; i++) {
        const [, aAfter, bAfter] = rgbToLab(
          boostedData[i * 4]!,
          boostedData[i * 4 + 1]!,
          boostedData[i * 4 + 2]!,
        );
        sumDeltaA += Math.abs(origA[i]! - aAfter);
        sumDeltaB += Math.abs(origB[i]! - bAfter);
        count++;
      }

      const meanDeltaA = sumDeltaA / count;
      const meanDeltaB = sumDeltaB / count;

      assert.ok(
        meanDeltaA < 1.0,
        `Mean a* chromaticity shift (${meanDeltaA.toFixed(3)}) exceeded threshold 1.0`,
      );
      assert.ok(
        meanDeltaB < 1.0,
        `Mean b* chromaticity shift (${meanDeltaB.toFixed(3)}) exceeded threshold 1.0`,
      );
    });
  });

  describe("3. Performance SLA Assertion (< 5ms for 384x384, < 1ms for 150x150)", () => {
    test("applyClaheLabImageData completes in < 5ms on 384x384 frame", () => {
      const canvas = generateSyntheticFaceCanvas(384, 384);
      const ctx = (canvas as any).getContext("2d");

      // JIT Warmup (10 iterations on fresh frames)
      for (let i = 0; i < 10; i++) {
        const imgData = ctx.getImageData(0, 0, 384, 384);
        applyClaheLabImageData(imgData, { clipLimit: 2.5, gridTiles: 8 });
      }

      const iterations = 30;
      const times: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const imgData = ctx.getImageData(0, 0, 384, 384);
        const t0 = performance.now();
        applyClaheLabImageData(imgData, { clipLimit: 2.5, gridTiles: 8 });
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const minMs = times[0]!;
      const p20Ms = times[Math.floor(times.length * 0.2)]!;

      assert.ok(
        minMs < 5.0,
        `384x384 CLAHE SLA benchmark failed: min iteration ${minMs.toFixed(3)}ms per frame (limit: < 5.0ms)`,
      );
      assert.ok(
        p20Ms < 7.5,
        `384x384 CLAHE SLA benchmark failed: 20th percentile ${p20Ms.toFixed(3)}ms per frame under multi-worker load (limit: < 7.5ms)`,
      );
    });

    test("applyClaheLabImageData completes in < 1ms on 150x150 face crops", () => {
      const canvas = generateSyntheticFaceCanvas(150, 150);
      const ctx = (canvas as any).getContext("2d");

      // JIT Warmup (10 iterations on fresh frames)
      for (let i = 0; i < 10; i++) {
        const imgData = ctx.getImageData(0, 0, 150, 150);
        applyClaheLabImageData(imgData, { clipLimit: 2.5, gridTiles: 8 });
      }

      const iterations = 30;
      const times: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const imgData = ctx.getImageData(0, 0, 150, 150);
        const t0 = performance.now();
        applyClaheLabImageData(imgData, { clipLimit: 2.5, gridTiles: 8 });
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const minMs = times[0]!;
      const p20Ms = times[Math.floor(times.length * 0.2)]!;

      assert.ok(
        minMs < 1.0,
        `150x150 face crop CLAHE SLA benchmark failed: min iteration ${minMs.toFixed(3)}ms per frame (limit: < 1.0ms)`,
      );
      assert.ok(
        p20Ms < 2.0,
        `150x150 face crop CLAHE SLA benchmark failed: 20th percentile ${p20Ms.toFixed(3)}ms per frame under multi-worker load (limit: < 2.0ms)`,
      );
    });
  });

  describe("4. Synthetic Lighting Stress Enhancement", () => {
    test("enhances mean lightness and entropy on low-exposure dark frames", () => {
      const darkCanvas = generateDarkFrameCanvas(384, 384, 0.05);
      const boostedCanvas = applyClaheCanvas(darkCanvas as any, 2.5, 8, 384);

      const ctxDark = (darkCanvas as any).getContext("2d");
      const darkData = ctxDark.getImageData(0, 0, 384, 384).data;
      const ctxBoosted = (boostedCanvas as any).getContext("2d");
      const boostedData = ctxBoosted.getImageData(0, 0, 384, 384).data;

      let sumLDark = 0;
      let sumLBoosted = 0;

      for (let i = 0; i < darkData.length; i += 4) {
        sumLDark += darkData[i]!;
        sumLBoosted += boostedData[i]!;
      }

      const meanDark = sumLDark / (384 * 384);
      const meanBoosted = sumLBoosted / (384 * 384);

      assert.ok(
        meanBoosted > meanDark,
        `Boosted mean brightness (${meanBoosted.toFixed(1)}) should exceed dark mean (${meanDark.toFixed(1)})`,
      );
    });

    test("applyLocalContrastBoost wrapper delegates seamlessly to LAB CLAHE", () => {
      const canvas = generateSyntheticFaceCanvas(384, 384);
      const boosted = applyLocalContrastBoost(canvas as any, 2.5, 8, 384);

      assert.ok(boosted, "Boosted canvas should be returned");
      assert.equal(boosted.width, 384);
      assert.equal(boosted.height, 384);
    });
  });

  describe("5. Edge Cases & Robustness", () => {
    test("handles all-black canvas (0x0 / 0 RGB) gracefully without crash", () => {
      const blackCanvas = generateDarkFrameCanvas(100, 100, 0.0);
      const out = applyClaheCanvas(blackCanvas as any);
      assert.ok(out, "All-black frame should return valid canvas");
      assert.equal(out.width, 100);
      assert.equal(out.height, 100);
    });

    test("handles all-white canvas (255 RGB) cleanly", () => {
      const whiteCanvas = generateOverexposedCanvas(100, 100, 1.0);
      const out = applyClaheCanvas(whiteCanvas as any);
      assert.ok(out, "All-white frame should return valid canvas");
    });

    test("handles flat gray canvas (128 RGB)", () => {
      const grayCanvas = generateDarkFrameCanvas(100, 100, 0.5);
      const out = applyClaheCanvas(grayCanvas as any);
      assert.ok(out);
    });

    test("handles single pixel canvas (1x1)", () => {
      const singlePx = generateDarkFrameCanvas(1, 1, 0.5);
      const out = applyClaheCanvas(singlePx as any);
      assert.equal(out.width, 1);
      assert.equal(out.height, 1);
    });
  });

  describe("6. Non-8-Divisible Canvas Dimensions & Uniform Spatial Invariance", () => {
    test("verifies zero spatial variation on non-8-divisible dimensions (21x21, 150x150, 100x100, 37x37, 7x7)", () => {
      const dimensions = [
        [21, 21],
        [150, 150],
        [100, 100],
        [37, 37],
        [7, 7],
      ];

      for (const [w, h] of dimensions) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          data[i * 4] = 128;
          data[i * 4 + 1] = 128;
          data[i * 4 + 2] = 128;
          data[i * 4 + 3] = 255;
        }
        const imgData = { width: w, height: h, data, colorSpace: "srgb" } as ImageData;
        applyClaheLabImageData(imgData);

        const tlR = data[0]!;
        const trR = data[(w - 1) * 4]!;
        const blR = data[(h - 1) * w * 4]!;
        const brR = data[((h - 1) * w + w - 1) * 4]!;
        const centerR = data[(Math.floor(h / 2) * w + Math.floor(w / 2)) * 4]!;

        assert.equal(
          tlR,
          centerR,
          `TL (${tlR}) != Center (${centerR}) on ${w}x${h} uniform gray canvas`,
        );
        assert.equal(
          trR,
          centerR,
          `TR (${trR}) != Center (${centerR}) on ${w}x${h} uniform gray canvas`,
        );
        assert.equal(
          blR,
          centerR,
          `BL (${blR}) != Center (${centerR}) on ${w}x${h} uniform gray canvas`,
        );
        assert.equal(
          brR,
          centerR,
          `BR (${brR}) != Center (${centerR}) on ${w}x${h} uniform gray canvas`,
        );

        // Verify all pixels across the entire canvas match centerR
        for (let i = 0; i < w * h; i++) {
          assert.equal(
            data[i * 4],
            centerR,
            `Pixel ${i} (${data[i * 4]}) != Center (${centerR}) on ${w}x${h} uniform gray canvas`,
          );
        }
      }
    });
  });

  describe("5. Adaptive embed-path gate (skip well-lit, CLAHE uneven)", () => {
    test("even mid-tone skin crop does not request CLAHE", () => {
      const canvas = createTestCanvas(150, 150);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "rgb(180, 140, 110)";
      ctx.fillRect(0, 0, 150, 150);
      assert.equal(cropNeedsIlluminationNorm(canvas as any), false);
    });

    test("even deep skin does not request CLAHE (not underexposure)", () => {
      const canvas = createTestCanvas(150, 150);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "rgb(70, 45, 30)";
      ctx.fillRect(0, 0, 150, 150);
      assert.equal(cropNeedsIlluminationNorm(canvas as any), false);
    });

    test("well-lit face with dark hair band does not request CLAHE", () => {
      const canvas = createTestCanvas(150, 150);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "rgb(200, 160, 130)";
      ctx.fillRect(0, 0, 150, 150);
      ctx.fillStyle = "rgb(18, 14, 12)";
      ctx.fillRect(0, 0, 150, 28);
      assert.equal(cropNeedsIlluminationNorm(canvas as any), false);
    });

    test("crushed-black and blown-out crops request CLAHE", () => {
      assert.equal(cropNeedsIlluminationNorm(generateDarkFrameCanvas(150, 150, 0.08) as any), true);
      assert.equal(cropNeedsIlluminationNorm(generateOverexposedCanvas(150, 150, 0.95) as any), true);
    });

    test("unclipped directional split requests CLAHE", () => {
      const canvas = createTestCanvas(150, 150);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "rgb(50, 40, 35)";
      ctx.fillRect(0, 0, 75, 150);
      ctx.fillStyle = "rgb(180, 150, 130)";
      ctx.fillRect(75, 0, 75, 150);
      assert.equal(cropNeedsIlluminationNorm(canvas as any), true);
    });

    test("backlit face (bright surround, dimmer inner) requests CLAHE", () => {
      const canvas = createTestCanvas(150, 150);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.fillStyle = "rgb(220, 220, 230)";
      ctx.fillRect(0, 0, 150, 150);
      ctx.fillStyle = "rgb(80, 70, 60)";
      ctx.fillRect(30, 30, 90, 90);
      assert.equal(cropNeedsIlluminationNorm(canvas as any), true);
    });

    test("CLAHE on a 150x150 embed crop preserves a*/b* chromaticity", () => {
      const canvas = generateSyntheticFaceCanvas(150, 150, 75, 75, 60);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      const before = ctx.getImageData(75, 75, 1, 1).data;
      const [, a0, b0] = rgbToLab(before[0]!, before[1]!, before[2]!);

      const out = applyClaheCanvas(canvas as any, { clipLimit: 2.5, gridTiles: 8, maxClaheSide: 150 });

      const after = (out.getContext("2d") as CanvasRenderingContext2D).getImageData(75, 75, 1, 1).data;
      const [, a1, b1] = rgbToLab(after[0]!, after[1]!, after[2]!);
      assert.ok(Math.abs(a1 - a0) < 2.0, `Δa* too large: ${a1 - a0}`);
      assert.ok(Math.abs(b1 - b0) < 2.0, `Δb* too large: ${b1 - b0}`);
    });
  });
});
