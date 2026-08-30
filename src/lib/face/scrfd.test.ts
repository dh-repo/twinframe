import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateAnchors,
  estimateHeadPose,
  computeIoU,
  nmsFaceBoxes,
  selectPrimaryFace,
} from "./scrfd.ts";
import { estimateSmileMetrics } from "./types.ts";
import type { SCRFDDetectionResult } from "./types.ts";

describe("SCRFD-2.5G Face Detection Unit Suite", () => {
  it("generates correct multi-stride anchor grid (16,800 anchors for 640x640)", () => {
    const anchorsByStride = generateAnchors(640, 640);

    assert.equal(Object.keys(anchorsByStride).length, 3);
    assert.equal(anchorsByStride[8].length, 12800); // 80x80 * 2
    assert.equal(anchorsByStride[16].length, 3200); // 40x40 * 2
    assert.equal(anchorsByStride[32].length, 800);  // 20x20 * 2

    const totalAnchors =
      anchorsByStride[8].length +
      anchorsByStride[16].length +
      anchorsByStride[32].length;

    assert.equal(totalAnchors, 16800);

    // Verify first anchor center coordinate for stride 8
    assert.equal(anchorsByStride[8][0].cx, 4);
    assert.equal(anchorsByStride[8][0].cy, 4);
    assert.equal(anchorsByStride[8][0].stride, 8);
  });

  it("computes head pose (roll, yaw, pitch) accurately for frontal face", () => {
    // Perfectly symmetrical frontal landmarks [left_eye, right_eye, nose, left_mouth, right_mouth]
    const frontalLandmarks = [
      [38.0, 50.0],
      [74.0, 50.0],
      [56.0, 70.0],
      [42.0, 90.0],
      [70.0, 90.0],
    ];

    const pose = estimateHeadPose(frontalLandmarks);

    assert.equal(Math.abs(pose.roll) <= 1.0, true, `Expected roll ~0, got ${pose.roll}`);
    assert.equal(Math.abs(pose.yaw) <= 2.0, true, `Expected yaw ~0, got ${pose.yaw}`);
    assert.equal(Math.abs(pose.pitch) <= 5.0, true, `Expected pitch ~0, got ${pose.pitch}`);
  });

  it("detects positive yaw when head turns left and negative yaw when head turns right", () => {
    // Turn left: nose tip shifts right relative to eyes
    const turnLeftLandmarks = [
      [38.0, 50.0],
      [74.0, 50.0],
      [64.0, 70.0], // shifted right towards right eye
      [42.0, 90.0],
      [70.0, 90.0],
    ];

    const poseLeft = estimateHeadPose(turnLeftLandmarks);
    assert.equal(poseLeft.yaw > 25, true, `Expected yaw > 25 for left turn, got ${poseLeft.yaw}`);

    // Turn right: nose tip shifts left relative to eyes
    const turnRightLandmarks = [
      [38.0, 50.0],
      [74.0, 50.0],
      [48.0, 70.0], // shifted left towards left eye
      [42.0, 90.0],
      [70.0, 90.0],
    ];

    const poseRight = estimateHeadPose(turnRightLandmarks);
    assert.equal(poseRight.yaw < -25, true, `Expected yaw < -25 for right turn, got ${poseRight.yaw}`);
  });

  it("computes IoU correctly for overlapping bounding boxes", () => {
    const boxA = { x: 10, y: 10, width: 100, height: 100 };
    const boxB = { x: 10, y: 10, width: 100, height: 100 };
    const boxC = { x: 200, y: 200, width: 50, height: 50 };

    assert.equal(computeIoU(boxA, boxB), 1.0);
    assert.equal(computeIoU(boxA, boxC), 0.0);
  });

  it("applies Non-Maximum Suppression (NMS) to eliminate duplicate detection boxes", () => {
    const candidate1: SCRFDDetectionResult = {
      bbox: { x: 10, y: 10, width: 100, height: 100 },
      normalizedBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      score: 0.95,
      confidence: 0.95,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };

    const candidate2: SCRFDDetectionResult = {
      bbox: { x: 12, y: 12, width: 98, height: 98 }, // Overlaps > 0.40 IoU with candidate1
      normalizedBox: { x: 0.12, y: 0.12, width: 0.19, height: 0.19 },
      score: 0.88,
      confidence: 0.88,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };

    const candidate3: SCRFDDetectionResult = {
      bbox: { x: 250, y: 250, width: 80, height: 80 }, // Separate face
      normalizedBox: { x: 0.5, y: 0.5, width: 0.16, height: 0.16 },
      score: 0.90,
      confidence: 0.90,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };

    const filtered = nmsFaceBoxes([candidate1, candidate2, candidate3], 0.40);

    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].score, 0.95);
    assert.equal(filtered[1].score, 0.90);
    assert.equal(selectPrimaryFace(filtered), candidate1);
  });

  it("picks the largest remaining box as primary, not the highest score", () => {
    const smallHighScore: SCRFDDetectionResult = {
      bbox: { x: 10, y: 10, width: 40, height: 40 },
      normalizedBox: { x: 0.02, y: 0.02, width: 0.08, height: 0.08 },
      score: 0.95,
      confidence: 0.95,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };
    const largeLowScore: SCRFDDetectionResult = {
      bbox: { x: 100, y: 80, width: 200, height: 240 },
      normalizedBox: { x: 0.2, y: 0.16, width: 0.4, height: 0.48 },
      score: 0.7,
      confidence: 0.7,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };
    const mid: SCRFDDetectionResult = {
      bbox: { x: 20, y: 20, width: 50, height: 50 },
      normalizedBox: { x: 0.04, y: 0.04, width: 0.1, height: 0.1 },
      score: 0.8,
      confidence: 0.8,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };

    assert.equal(selectPrimaryFace([smallHighScore, largeLowScore, mid]), largeLowScore);
    assert.equal(selectPrimaryFace([smallHighScore]), smallHighScore);
    assert.equal(selectPrimaryFace([]), null);
  });

  it("breaks a near-tie toward the more central face when image size is known", () => {
    const leftOpponent: SCRFDDetectionResult = {
      bbox: { x: 163, y: 142, width: 46, height: 67 },
      normalizedBox: { x: 0.17, y: 0.22, width: 0.05, height: 0.1 },
      score: 0.83,
      confidence: 0.83,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };
    const centralSubject: SCRFDDetectionResult = {
      bbox: { x: 458, y: 155, width: 45, height: 66 },
      normalizedBox: { x: 0.48, y: 0.24, width: 0.05, height: 0.1 },
      score: 0.8,
      confidence: 0.8,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };
    assert.equal(selectPrimaryFace([leftOpponent, centralSubject]), leftOpponent);
    assert.equal(
      selectPrimaryFace([leftOpponent, centralSubject], { width: 960, height: 640 }),
      centralSubject,
    );
  });

  it("keeps a clearly larger off-center subject even when a smaller face is central", () => {
    const subject: SCRFDDetectionResult = {
      bbox: { x: 40, y: 80, width: 200, height: 240 },
      normalizedBox: { x: 0.04, y: 0.12, width: 0.21, height: 0.38 },
      score: 0.7,
      confidence: 0.7,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };
    const extra: SCRFDDetectionResult = {
      bbox: { x: 430, y: 280, width: 50, height: 60 },
      normalizedBox: { x: 0.45, y: 0.44, width: 0.05, height: 0.09 },
      score: 0.95,
      confidence: 0.95,
      landmarks: new Float32Array(10),
      normalizedLandmarks: [],
      pose: { yaw: 0, pitch: 0, roll: 0 },
    };
    assert.equal(selectPrimaryFace([subject, extra], { width: 960, height: 640 }), subject);
  });

  it("estimates smile metrics accurately for smiling vs neutral facial landmarks", () => {
    // Neutral landmarks (mouth width / IOD ~ 0.77)
    const neutralLandmarks = [
      [38.0, 50.0],
      [74.0, 50.0],
      [56.0, 70.0],
      [42.0, 90.0],
      [70.0, 90.0],
    ];

    // Smiling landmarks (wide mouth width / IOD ~ 0.94, pulled up and wide)
    const smilingLandmarks = [
      [38.0, 50.0],
      [74.0, 50.0],
      [56.0, 70.0],
      [39.0, 86.0],
      [73.0, 86.0],
    ];

    const resNeutral = estimateSmileMetrics(neutralLandmarks);
    const resSmile = estimateSmileMetrics(smilingLandmarks);

    assert.ok(resSmile.smileRatio > resNeutral.smileRatio, `Expected smileRatio ${resSmile.smileRatio} > ${resNeutral.smileRatio}`);
    assert.ok(resSmile.smileIntensity > resNeutral.smileIntensity, `Expected smileIntensity ${resSmile.smileIntensity} > ${resNeutral.smileIntensity}`);
  });
});
