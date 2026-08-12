import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateHeadPose68, getPoseAdaptiveLandmarkWeight } from "./pose.ts";
import { analyzeImageQuality } from "./quality.ts";
import { isValidHumanFaceLandmarks68 } from "./geometry.ts";


describe("3D Head Pose Estimation & Quality Analysis", () => {
  it("computes frontal head pose correctly", () => {
    // Generate synthetic 68-point frontal face landmarks
    const landmarks = new Array(68).fill(0).map(() => ({ x: 0.5, y: 0.5 }));
    // Left eye center ~ (0.35, 0.45), Right eye center ~ (0.65, 0.45)
    landmarks[36] = { x: 0.30, y: 0.45 };
    landmarks[39] = { x: 0.40, y: 0.45 };
    landmarks[42] = { x: 0.60, y: 0.45 };
    landmarks[45] = { x: 0.70, y: 0.45 };
    landmarks[30] = { x: 0.50, y: 0.55 }; // nose tip centered
    landmarks[8]  = { x: 0.50, y: 0.80 }; // chin
    landmarks[27] = { x: 0.50, y: 0.40 }; // nose bridge

    const pose = estimateHeadPose68(landmarks);
    assert.ok(Math.abs(pose.yawDeg) < 5);
    assert.ok(Math.abs(pose.rollDeg) < 5);
    assert.ok(pose.poseScore > 0.8);

    const weight = getPoseAdaptiveLandmarkWeight(pose, 0.10);
    assert.ok(Math.abs(weight - 0.10) < 0.02);
  });

  it("dampens landmark weight under head yaw rotation", () => {
    const landmarks = new Array(68).fill(0).map(() => ({ x: 0.5, y: 0.5 }));
    landmarks[36] = { x: 0.30, y: 0.45 };
    landmarks[39] = { x: 0.40, y: 0.45 };
    landmarks[42] = { x: 0.60, y: 0.45 };
    landmarks[45] = { x: 0.70, y: 0.45 };
    landmarks[30] = { x: 0.62, y: 0.55 }; // nose tip shifted right -> positive yaw
    landmarks[8]  = { x: 0.50, y: 0.80 };
    landmarks[27] = { x: 0.50, y: 0.40 };

    const pose = estimateHeadPose68(landmarks);
    assert.ok(Math.abs(pose.yawDeg) > 15);
    const weight = getPoseAdaptiveLandmarkWeight(pose, 0.10);
    assert.ok(weight < 0.10);
  });

  it("analyzes ImageData quality correctly", () => {
    // 64x64 synthetic image
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    
    // Fill with checkerboard pattern for high Laplacian variance (sharpness)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const val = (x + y) % 2 === 0 ? 50 : 200;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }
    }

    const imgData = { width, height, data } as ImageData;
    const metrics = analyzeImageQuality(imgData);

    assert.ok(metrics.sharpnessScore > 0.5);
    assert.ok(metrics.overallQuality > 0.4);
    assert.equal(metrics.issues.length, 0);
  });

  it("validates human face landmark structural morphology and rejects non-face textures", () => {
    // 1. Valid face landmarks
    const validLandmarks = new Array(68).fill(0).map(() => ({ x: 50, y: 50 }));
    validLandmarks[36] = { x: 30, y: 35 }; // left eye outer
    validLandmarks[39] = { x: 40, y: 35 }; // left eye inner
    validLandmarks[42] = { x: 60, y: 35 }; // right eye inner
    validLandmarks[45] = { x: 70, y: 35 }; // right eye outer
    validLandmarks[30] = { x: 50, y: 55 }; // nose tip
    validLandmarks[48] = { x: 40, y: 75 }; // mouth left
    validLandmarks[54] = { x: 60, y: 75 }; // mouth right
    validLandmarks[8]  = { x: 50, y: 90 }; // chin

    assert.ok(isValidHumanFaceLandmarks68(validLandmarks, 100, 100));

    // 2. Invalid non-face landmarks (inverted vertical order: mouth above eyes, e.g. sunset cloud edge)
    const invalidLandmarks = [...validLandmarks];
    invalidLandmarks[30] = { x: 50, y: 20 }; // nose tip above eyes!
    assert.equal(isValidHumanFaceLandmarks68(invalidLandmarks, 100, 100), false);
  });
});

