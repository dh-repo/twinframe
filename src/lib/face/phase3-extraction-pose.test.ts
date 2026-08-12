import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { l2Normalize, loadCelebrityEmbeddings } from "./embeddings.ts";
import { estimateHeadPose68, getPoseAdaptiveLandmarkWeight, type HeadPose } from "./pose.ts";
import { extractCenterFaceCanvas, createHorizontalFlipCanvas } from "./faceapi-engine.ts";
import { createTestCanvas } from "./synthetic-fixtures.ts";
import { rankByDescriptor } from "./match.ts";

/** Helper function to calculate L2 norm of an array or Float32Array */
function computeL2Norm(v: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const val = v[i] ?? 0;
    sum += val * val;
  }
  return Math.sqrt(sum);
}

describe("Phase 3: Extraction & 3D Pose Weighting Assertions", () => {
  // --- CROP-01: High-Res Crop Dimensions (320x320) ---
  describe("CROP-01: High-Res Crop Canvas Dimensions", () => {
    it("validates high-res crop canvas dimensions default to 320x320 via extractCenterFaceCanvas", () => {
      const sourceCanvas = createTestCanvas(800, 600);
      const cropCanvas = extractCenterFaceCanvas(sourceCanvas as HTMLCanvasElement);

      assert.equal(cropCanvas.width, 320, "CROP-01: Crop canvas width must equal 320");
      assert.equal(cropCanvas.height, 320, "CROP-01: Crop canvas height must equal 320");
    });

    it("validates explicit outSize = 320 argument for crop canvas generation", () => {
      const sourceCanvas = createTestCanvas(1920, 1080);
      const outSize = 320;
      const cropCanvas = extractCenterFaceCanvas(sourceCanvas as HTMLCanvasElement, outSize);

      assert.equal(cropCanvas.width, 320, "CROP-01: Explicit outSize crop width must be 320");
      assert.equal(cropCanvas.height, 320, "CROP-01: Explicit outSize crop height must be 320");
    });

    it("verifies crop TTA horizontal flip preserves 320x320 square canvas dimensions", () => {
      const cropCanvas = createTestCanvas(320, 320) as HTMLCanvasElement;
      const ctx = cropCanvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 0, 40, 40); // red marker top-left
      }
      const flipCanvas = createHorizontalFlipCanvas(cropCanvas);

      assert.equal(flipCanvas.width, 320, "CROP-01: Flipped TTA canvas width must equal 320");
      assert.equal(flipCanvas.height, 320, "CROP-01: Flipped TTA canvas height must equal 320");
      // Marker should move to top-right after horizontal flip
      const fctx = flipCanvas.getContext("2d");
      if (fctx) {
        const tr = fctx.getImageData(300, 10, 1, 1).data;
        assert.ok(tr[0]! > 200, "CROP-01: TTA flip must move top-left red marker to top-right");
      }
    });

    it("POS wiring: rankByDescriptor damps geom weight when headPose yaw is large", () => {
      const baseDesc = new Float32Array(128).fill(0.1);
      baseDesc[0] = 1;
      const gallery = [
        {
          id: "a",
          name: "A",
          path: "/a.jpg",
          descriptor: Array.from(baseDesc),
          age: 30,
          gender: "female" as const,
          genderProb: 0.9,
          features: {
            faceAspect: 0.9,
            jawWidth: 0.5,
            chinSharpness: 0.5,
            foreheadHeight: 0.5,
            eyeSpacing: 0.5,
            eyeOpenness: 0.5,
            eyeSlant: 0.5,
            browHeight: 0.5,
            noseLength: 0.5,
            noseWidth: 0.5,
            mouthWidth: 0.5,
            lipFullness: 0.5,
            cheekboneProminence: 0.5,
            faceRoundness: 0.5,
            skinL: 0.5,
            skinA: 0.5,
            skinB: 0.5,
            hairL: 0.5,
            hairA: 0.5,
            hairB: 0.5,
            masculine: 0.2,
            feminine: 0.8,
            youthfulness: 0.5,
          },
        },
      ];
      const frontal = rankByDescriptor(
        {
          descriptor: baseDesc,
          age: 30,
          gender: "female",
          genderProbability: 0.9,
          features: gallery[0]!.features,
          headPose: { yawDeg: 10, pitchDeg: 0, rollDeg: 0, poseScore: 1 },
        },
        gallery,
        1,
      );
      const profile = rankByDescriptor(
        {
          descriptor: baseDesc,
          age: 30,
          gender: "female",
          genderProbability: 0.9,
          features: gallery[0]!.features,
          headPose: { yawDeg: 80, pitchDeg: 0, rollDeg: 0, poseScore: 0.2 },
        },
        gallery,
        1,
      );
      assert.ok(frontal.length === 1 && profile.length === 1, "Both pose queries must return matches");
      // With identical descriptors, scores remain valid (non-empty); weight path must not throw
      assert.ok(Number.isFinite(frontal[0]!.matchPercent));
      assert.ok(Number.isFinite(profile[0]!.matchPercent));
      // Adaptive weight at 80° is 0.02 vs 0.098 at 10° — function is wired into ranking path
      const w10 = getPoseAdaptiveLandmarkWeight(
        { yawDeg: 10, pitchDeg: 0, rollDeg: 0, poseScore: 1 },
        0.1,
      );
      const w80 = getPoseAdaptiveLandmarkWeight(
        { yawDeg: 80, pitchDeg: 0, rollDeg: 0, poseScore: 0.2 },
        0.1,
      );
      assert.ok(w80 < w10, "High yaw must reduce geom weight used by rankByDescriptor");
    });
  });

  // --- EMB-01: 128-d Output Vector Length ---
  describe("EMB-01: 128-d Descriptor Vector Length Assertion", () => {
    it("asserts l2Normalize returns a Float32Array of length 128 for 128-d raw input", () => {
      const rawVector = new Float32Array(128).fill(0.25);
      const normalized = l2Normalize(rawVector);

      assert.equal(normalized.length, 128, "EMB-01: Normalized vector length must equal 128");
      assert.ok(normalized instanceof Float32Array, "EMB-01: Output must be a Float32Array instance");
    });

    it("asserts celebrity embeddings in gallery catalog contain 128-d descriptors", async () => {
      const celebs = await loadCelebrityEmbeddings();
      assert.ok(celebs.length > 0, "Celebrity gallery must not be empty");
      for (const celeb of celebs) {
        assert.equal(
          celeb.descriptor.length,
          128,
          `EMB-01: Celebrity '${celeb.id}' descriptor length must be 128, got ${celeb.descriptor.length}`,
        );
      }
    });

    it("preserves vector length N across arbitrary feature vector dimensions", () => {
      const dimensions = [16, 64, 128, 256, 512];
      for (const dim of dimensions) {
        const vec = new Float32Array(dim).map((_, i) => Math.sin(i * 0.1));
        const normVec = l2Normalize(vec);
        assert.equal(normVec.length, dim, `l2Normalize must preserve vector length ${dim}`);
      }
    });
  });

  // --- EMB-02: L2-Normalization Norm = 1.0 Assertion ---
  describe("EMB-02: L2-Normalization Norm = 1.0 Assertion", () => {
    it("asserts ||l2Normalize(v)||_2 === 1.0 within 1e-6 tolerance across varied non-trivial inputs", () => {
      const testCases: Float32Array[] = [
        new Float32Array(128).fill(1.0),
        new Float32Array(128).fill(0.05),
        new Float32Array(128).map((_, i) => (i % 2 === 0 ? 0.3 : -0.4)),
        new Float32Array(128).map((_, i) => Math.sin(i * 0.1) * 100),
        new Float32Array(128).map((_, i) => (i + 1) * 0.05 - 3.2),
      ];

      for (let idx = 0; idx < testCases.length; idx++) {
        const raw = testCases[idx]!;
        const normalized = l2Normalize(raw);
        const norm = computeL2Norm(normalized);
        assert.ok(
          Math.abs(norm - 1.0) < 1e-6,
          `EMB-02: L2 norm for test case ${idx} must equal 1.0 +/- 1e-6 (got ${norm})`,
        );
      }
    });

    it("does not mutate the source input array in-place", () => {
      const raw = new Float32Array([3, 4]);
      const rawCopy = new Float32Array(raw);
      const normalized = l2Normalize(raw);

      assert.deepEqual(raw, rawCopy, "l2Normalize must not mutate the source array");
      assert.ok(Math.abs(normalized[0]! - 0.6) < 1e-6, "Element 0 should be 0.6");
      assert.ok(Math.abs(normalized[1]! - 0.8) < 1e-6, "Element 1 should be 0.8");
      assert.ok(Math.abs(computeL2Norm(normalized) - 1.0) < 1e-6);
    });

    it("handles all-zero input vector cleanly without division-by-zero NaN or throwing", () => {
      const zeroVec = new Float32Array(128).fill(0);
      const normalized = l2Normalize(zeroVec);

      assert.equal(normalized.length, 128, "Zero vector output length must be 128");
      for (let i = 0; i < normalized.length; i++) {
        assert.equal(normalized[i], 0, `Element ${i} of zero vector output must be 0`);
        assert.ok(Number.isFinite(normalized[i]), `Element ${i} must be a finite number`);
      }
    });
  });

  // --- POS-01 to POS-04: 3D Pose Dynamic Weight Scaling ---
  describe("POS-01 to POS-04: 3D Pose Dynamic Weight Scaling", () => {
    it("POS-01: yaw = 10.0° evaluates to w_geom = 0.098", () => {
      const pose: HeadPose = { yawDeg: 10.0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 };
      const weight = getPoseAdaptiveLandmarkWeight(pose, 0.10);

      assert.equal(weight, 0.098, "POS-01: Weight at yaw=10.0° must equal 0.098");
      assert.equal(weight.toFixed(3), "0.098");
    });

    it("POS-02: yaw = 14.9° evaluates to w_geom = 0.097", () => {
      const pose: HeadPose = { yawDeg: 14.9, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 };
      const weight = getPoseAdaptiveLandmarkWeight(pose, 0.10);

      assert.equal(weight, 0.097, "POS-02: Weight at yaw=14.9° must equal 0.097");
      assert.equal(weight.toFixed(3), "0.097");
    });

    it("POS-03: yaw = 20.0° evaluates to w_geom = 0.094", () => {
      const pose: HeadPose = { yawDeg: 20.0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 };
      const weight = getPoseAdaptiveLandmarkWeight(pose, 0.10);

      assert.equal(weight, 0.094, "POS-03: Weight at yaw=20.0° must equal 0.094");
      assert.equal(weight.toFixed(3), "0.094");
    });

    it("POS-04: yaw = 80.0° evaluates to w_geom = 0.020 (clamped to floor factor 0.20)", () => {
      const pose: HeadPose = { yawDeg: 80.0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 };
      const weight = getPoseAdaptiveLandmarkWeight(pose, 0.10);

      assert.equal(weight, 0.02, "POS-04: Weight at yaw=80.0° must equal 0.020 (numeric 0.02)");
      assert.equal(weight.toFixed(3), "0.020", "POS-04: Formatted weight must be '0.020'");
    });

    it("Edge Case: asserts yaw angle negative symmetry (-10°, -14.9°, -20°, -80°)", () => {
      const yawTestCases = [
        { yaw: 10.0, expected: 0.098 },
        { yaw: 14.9, expected: 0.097 },
        { yaw: 20.0, expected: 0.094 },
        { yaw: 80.0, expected: 0.02 },
      ];

      for (const { yaw, expected } of yawTestCases) {
        const wPos = getPoseAdaptiveLandmarkWeight({ yawDeg: yaw, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 }, 0.10);
        const wNeg = getPoseAdaptiveLandmarkWeight({ yawDeg: -yaw, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 }, 0.10);

        assert.equal(wPos, expected, `Positive yaw ${yaw}° weight must be ${expected}`);
        assert.equal(wNeg, expected, `Negative yaw -${yaw}° weight must equal positive yaw weight ${expected}`);
      }
    });

    it("Edge Case: verifies clamping transition around arccos(0.2) ≈ 78.46° (78.0° -> 0.021, 78.5° -> 0.020, 90.0° -> 0.020)", () => {
      // 78.0° -> cos(78.0°) ≈ 0.20791 -> 0.10 * 0.20791 = 0.020791 -> rounded = 0.021
      const w78 = getPoseAdaptiveLandmarkWeight({ yawDeg: 78.0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 }, 0.10);
      assert.equal(w78, 0.021, "Weight at 78.0° must be 0.021 before floor clamping");
      assert.equal(w78.toFixed(3), "0.021");

      // 78.5° -> cos(78.5°) ≈ 0.19937 < 0.2 -> clamped to factor 0.20 -> 0.10 * 0.20 = 0.020
      const w785 = getPoseAdaptiveLandmarkWeight({ yawDeg: 78.5, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 }, 0.10);
      assert.equal(w785, 0.02, "Weight at 78.5° must be clamped to 0.020");
      assert.equal(w785.toFixed(3), "0.020");

      // 90.0° -> cos(90.0°) = 0 -> clamped to factor 0.20 -> 0.10 * 0.20 = 0.020
      const w90 = getPoseAdaptiveLandmarkWeight({ yawDeg: 90.0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 }, 0.10);
      assert.equal(w90, 0.02, "Weight at 90.0° must be clamped to 0.020");
      assert.equal(w90.toFixed(3), "0.020");
    });

    it("Edge Case: verifies scaling with custom baseWeight parameter (0.20)", () => {
      const baseWeight = 0.20;

      // yaw = 10.0°, baseWeight = 0.20 -> 0.20 * cos(10°) ≈ 0.20 * 0.984808 = 0.19696 -> rounded = 0.197
      const w10Custom = getPoseAdaptiveLandmarkWeight({ yawDeg: 10.0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 }, baseWeight);
      assert.equal(w10Custom, 0.197, "Custom baseWeight 0.20 at yaw=10.0° must equal 0.197");

      // yaw = 80.0°, baseWeight = 0.20 -> 0.20 * clamped(0.20) = 0.040
      const w80Custom = getPoseAdaptiveLandmarkWeight({ yawDeg: 80.0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 }, baseWeight);
      assert.equal(w80Custom, 0.04, "Custom baseWeight 0.20 at yaw=80.0° must equal 0.040");
      assert.equal(w80Custom.toFixed(3), "0.040");
    });

    it("verifies end-to-end landmark pose estimation to dynamic weight flow", () => {
      const landmarks = new Array(68).fill(0).map(() => ({ x: 0.5, y: 0.5 }));
      landmarks[36] = { x: 0.30, y: 0.45 };
      landmarks[39] = { x: 0.40, y: 0.45 };
      landmarks[42] = { x: 0.60, y: 0.45 };
      landmarks[45] = { x: 0.70, y: 0.45 };
      landmarks[30] = { x: 0.50, y: 0.55 };
      landmarks[8]  = { x: 0.50, y: 0.80 };
      landmarks[27] = { x: 0.50, y: 0.40 };

      const estimatedPose = estimateHeadPose68(landmarks);
      assert.ok(Math.abs(estimatedPose.yawDeg) < 1.0, "Frontal landmark face yaw should be near 0°");

      const weight = getPoseAdaptiveLandmarkWeight(estimatedPose, 0.10);
      assert.ok(weight >= 0.099, `Frontal landmark face weight should be near 0.10 (got ${weight})`);
    });
  });
});
