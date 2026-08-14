import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createHorizontalFlipCanvas,
  createTightScaleCanvas,
  detectAndDescribeWithTTA,
  FACENET_EMBED_SIZE,
} from "./faceapi-engine.ts";
import {
  createTestCanvas,
  generateSyntheticFaceCanvas,
  generateDarkFrameCanvas,
  generateOverexposedCanvas,
} from "./synthetic-fixtures.ts";

function l2Norm(vec: ArrayLike<number>): number {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const val = vec[i] ?? 0;
    sumSq += val * val;
  }
  return Math.sqrt(sumSq);
}

function l2Distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sumSq = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

describe("M1_TTA Micro-Crop & Vector Output Consistency Empirical Challenger Suite", () => {
  let originalWindow: any;
  let originalDocument: any;

  before(() => {
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
  });

  after(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  // --- 1. MICRO-CROP CANVAS GEOMETRY ---
  describe("1. Micro-Crop Calculations & Canvas Transformations", () => {
    it("createHorizontalFlipCanvas: preserves canvas dimensions and flips pixel content horizontally", () => {
      const w = 100;
      const h = 80;
      const source = createTestCanvas(w, h) as HTMLCanvasElement;
      const ctx = source.getContext("2d")!;
      
      // Draw Red on left side (0..49), Blue on right side (50..99)
      ctx.fillStyle = "rgb(255,0,0)";
      ctx.fillRect(0, 0, 50, h);
      ctx.fillStyle = "rgb(0,0,255)";
      ctx.fillRect(50, 0, 50, h);

      const flipped = createHorizontalFlipCanvas(source);

      assert.equal(flipped.width, w, "Flipped canvas width must match source width");
      assert.equal(flipped.height, h, "Flipped canvas height must match source height");

      const fctx = flipped.getContext("2d")!;
      const leftPixel = fctx.getImageData(10, 40, 1, 1).data;
      const rightPixel = fctx.getImageData(90, 40, 1, 1).data;

      // Left pixel of flipped canvas should now be Blue (0, 0, 255)
      assert.ok(leftPixel[2]! > 200 && leftPixel[0]! < 50, "Left side of flipped canvas must be Blue");
      // Right pixel of flipped canvas should now be Red (255, 0, 0)
      assert.ok(rightPixel[0]! > 200 && rightPixel[2]! < 50, "Right side of flipped canvas must be Red");
    });

    it("createTightScaleCanvas: resizes and centers crop using 0.85x scale factor (1.15x zoom around center)", () => {
      const srcSize = 200;
      const outSize = FACENET_EMBED_SIZE; // 150
      const scaleFactor = 0.85;

      const source = createTestCanvas(srcSize, srcSize) as HTMLCanvasElement;
      const ctx = source.getContext("2d")!;

      // Background black
      ctx.fillStyle = "rgb(0,0,0)";
      ctx.fillRect(0, 0, srcSize, srcSize);

      // Center marker green (R=0, G=255, B=0)
      ctx.fillStyle = "rgb(0,255,0)";
      ctx.fillRect(90, 90, 20, 20); // Center is at 100, 100

      // Outer margin marker red (at 2, 2 — outside 0.85x crop box which starts at x=15, y=15)
      ctx.fillStyle = "rgb(255,0,0)";
      ctx.fillRect(2, 2, 10, 10);

      const tight = createTightScaleCanvas(source, outSize, scaleFactor);

      assert.equal(tight.width, outSize, "Output canvas width must equal FACENET_EMBED_SIZE");
      assert.equal(tight.height, outSize, "Output canvas height must equal FACENET_EMBED_SIZE");

      const tctx = tight.getContext("2d")!;
      const centerPixel = tctx.getImageData(outSize / 2, outSize / 2, 1, 1).data;
      const cornerPixel = tctx.getImageData(2, 2, 1, 1).data;

      // Center pixel must preserve green (0, 255, 0)
      assert.ok(centerPixel[1]! > 200, "Center pixel must remain Green after tight zoom");
      // Outer corner (red at 2,2) should be cropped out (leaving black at corner 2,2 of tight crop)
      assert.ok(cornerPixel[0]! < 50, "Outer border pixels must be cropped out by tight zoom");
    });

    it("handles extreme scale factors (0.1, 0.5, 1.0) and custom output sizes without crashing", () => {
      const source = createTestCanvas(300, 300) as HTMLCanvasElement;
      
      const canvas1 = createTightScaleCanvas(source, 100, 0.1);
      const canvas2 = createTightScaleCanvas(source, 200, 0.5);
      const canvas3 = createTightScaleCanvas(source, 150, 1.0);

      assert.equal(canvas1.width, 100);
      assert.equal(canvas2.width, 200);
      assert.equal(canvas3.width, 150);
    });
  });

  // --- 2. VECTOR OUTPUT ARRAY CONSISTENCY & TTA ENSEMBLE MATH ---
  describe("2. TTA Vector Array Consistency & Mathematical Invariants", () => {
    it("detectAndDescribeWithTTA returns descriptors containing exactly 4 valid 128-d vectors", async () => {
      const faceCanvas = generateSyntheticFaceCanvas(800, 800);
      const result = await detectAndDescribeWithTTA(faceCanvas as any);

      assert.ok(result !== null, "Detection result must not be null for synthetic face");
      assert.ok(Array.isArray(result.descriptors), "result.descriptors must be defined as an array");
      assert.equal(result.descriptors.length, 4, "descriptors array must contain exactly 4 templates: [v1, v2, v3, vEnsemble]");

      const [v1, v2, v3, vEnsemble] = result.descriptors;

      // 1. Verify vector dimensions (128-d)
      assert.equal(v1.length, 128, "v1 canonical descriptor must have length 128");
      assert.equal(v2.length, 128, "v2 flip descriptor must have length 128");
      assert.equal(v3.length, 128, "v3 tight scale descriptor must have length 128");
      assert.equal(vEnsemble.length, 128, "vEnsemble descriptor must have length 128");

      // 2. Verify primary descriptor is set to vEnsemble
      assert.deepEqual(result.descriptor, vEnsemble, "primary descriptor must equal vEnsemble");

      // 3. Verify zero NaNs, zero Infinities, and non-zero magnitude for all 4 vectors
      result.descriptors.forEach((vec, idx) => {
        for (let i = 0; i < vec.length; i++) {
          const val = vec[i];
          assert.ok(
            Number.isFinite(val),
            `Descriptor [${idx}] index [${i}] must be a finite number (got ${val})`,
          );
          assert.ok(
            !Number.isNaN(val),
            `Descriptor [${idx}] index [${i}] must not be NaN`,
          );
        }

        const norm = l2Norm(vec);
        assert.ok(
          Math.abs(norm - 1.0) < 1e-4,
          `Descriptor [${idx}] L2 norm (${norm.toFixed(6)}) must equal 1.0 ± 1e-4`,
        );

        let absSum = 0;
        for (let i = 0; i < vec.length; i++) absSum += Math.abs(vec[i] ?? 0);
        assert.ok(absSum > 0.1, `Descriptor [${idx}] must not be an all-zero vector`);
      });

      // 4. Mathematical invariant: vEnsemble = l2Normalize(v1 + v2 + v3)
      const expectedSum = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        expectedSum[i] = (v1[i] ?? 0) + (v2[i] ?? 0) + (v3[i] ?? 0);
      }
      let sumNorm = 0;
      for (let i = 0; i < 128; i++) sumNorm += expectedSum[i]! * expectedSum[i]!;
      sumNorm = Math.sqrt(sumNorm) || 1;

      for (let i = 0; i < 128; i++) {
        const expectedVal = expectedSum[i]! / sumNorm;
        const actualVal = vEnsemble[i]!;
        assert.ok(
          Math.abs(actualVal - expectedVal) < 1e-4,
          `vEnsemble[${i}] (${actualVal.toFixed(6)}) must match l2Normalize(v1+v2+v3)[${i}] (${expectedVal.toFixed(6)})`,
        );
      }
    });

    it("verifies micro-crop template diversity on asymmetric face canvas", async () => {
      // Create asymmetric face canvas (left eye larger / different color than right eye)
      const canvas = createTestCanvas(800, 800) as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      
      // Face oval
      ctx.fillStyle = "#e0ac69";
      ctx.beginPath();
      ctx.ellipse(400, 400, 200, 260, 0, 0, Math.PI * 2);
      ctx.fill();

      // Asymmetric Eyes: Left eye big Blue (cx=300, cy=350, r=40), Right eye small Red (cx=500, cy=350, r=10)
      ctx.fillStyle = "rgb(0,0,255)";
      ctx.beginPath();
      ctx.arc(300, 350, 40, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgb(255,0,0)";
      ctx.beginPath();
      ctx.arc(500, 350, 10, 0, Math.PI * 2);
      ctx.fill();

      const result = await detectAndDescribeWithTTA(canvas as any);
      assert.ok(result !== null);
      assert.equal(result.descriptors?.length, 4);

      const [v1, v2, v3] = result.descriptors;

      const distFlip = l2Distance(v1, v2);
      const distTight = l2Distance(v1, v3);

      // On asymmetric input, horizontal flip must yield a different descriptor (dist > 0)
      assert.ok(
        distFlip > 0.0001,
        `Horizontal flip descriptor v2 should differ from canonical v1 on asymmetric face (dist=${distFlip.toFixed(6)})`,
      );

      // Tight scale crop must yield a different descriptor (dist > 0)
      assert.ok(
        distTight > 0.0001,
        `Tight scale descriptor v3 should differ from canonical v1 (dist=${distTight.toFixed(6)})`,
      );
    });
  });

  // --- 3. EDGE CASE INPUTS & BOUNDARY CONDITIONS ---
  describe("3. Edge Case Inputs & Boundary Conditions", () => {
    it("handles dark frame (luma=0.0) without crashing, returning valid fallback or null", async () => {
      const darkCanvas = generateDarkFrameCanvas(600, 600, 0.0);
      const result = await detectAndDescribeWithTTA(darkCanvas as any);

      if (result) {
        assert.ok(Array.isArray(result.descriptors));
        result.descriptors.forEach((v) => {
          assert.equal(v.length, 128);
          assert.ok(v.every((n) => Number.isFinite(n)));
        });
      } else {
        assert.equal(result, null, "Null is valid when no face detected");
      }
    });

    it("handles bright overexposed frame (luma=1.0) cleanly", async () => {
      const brightCanvas = generateOverexposedCanvas(600, 600, 1.0);
      const result = await detectAndDescribeWithTTA(brightCanvas as any);

      if (result) {
        assert.ok(Array.isArray(result.descriptors));
        result.descriptors.forEach((v) => {
          assert.equal(v.length, 128);
          assert.ok(v.every((n) => Number.isFinite(n)));
        });
      }
    });

    it("handles extreme aspect ratios (10000x200 and 200x10000)", async () => {
      const wideCanvas = generateSyntheticFaceCanvas(10000, 200, 5000, 100, 50);
      const tallCanvas = generateSyntheticFaceCanvas(200, 10000, 100, 5000, 50);

      const resWide = await detectAndDescribeWithTTA(wideCanvas as any);
      const resTall = await detectAndDescribeWithTTA(tallCanvas as any);

      if (resWide) {
        assert.ok(resWide.descriptors && resWide.descriptors.length >= 1);
        resWide.descriptors.forEach((v) => assert.ok(v.every((n) => Number.isFinite(n))));
      }

      if (resTall) {
        assert.ok(resTall.descriptors && resTall.descriptors.length >= 1);
        resTall.descriptors.forEach((v) => assert.ok(v.every((n) => Number.isFinite(n))));
      }
    });
  });

  // --- 4. MEMORY & STABILITY LEAK HARNESS ---
  describe("4. Memory & Performance Leak Harness", () => {
    it("executes 20 consecutive TTA calls without memory corruption or descriptor degradation", async () => {
      const faceCanvas = generateSyntheticFaceCanvas(800, 800);

      for (let run = 0; run < 20; run++) {
        const result = await detectAndDescribeWithTTA(faceCanvas as any);
        assert.ok(result !== null, `Run ${run} must return non-null result`);
        assert.equal(result.descriptors?.length, 4, `Run ${run} must return 4 descriptors`);

        const vEnsemble = result.descriptors[3]!;
        assert.equal(vEnsemble.length, 128);
        assert.ok(Math.abs(l2Norm(vEnsemble) - 1.0) < 1e-4);
      }
    });
  });
});
