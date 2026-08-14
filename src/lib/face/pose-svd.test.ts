import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alignToCanonical3D,
  CANONICAL_FACE_3D,
  LANDMARK_MAP_68_TO_CANONICAL,
  LANDMARK_MAP_MEDIAPIPE_TO_CANONICAL,
} from "./pose.ts";
import { extractGeometryFeatures68, unwarpLandmarksToFrontal } from "./geometry.ts";
import type { Point3D, Matrix3x3, Vector3D } from "./types.ts";

/** Helper to create 3D rotation matrix from Yaw, Pitch, Roll angles in degrees. */
function createRotationMatrix(yawDeg: number, pitchDeg: number, rollDeg: number): Matrix3x3 {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const roll = (rollDeg * Math.PI) / 180;

  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);

  // R = Rz(roll) * Rx(pitch) * Ry(yaw)
  const R00 = cy * cr + sy * sp * sr;
  const R01 = sr * cp;
  const R02 = -sy * cr + cy * sp * sr;

  const R10 = -cy * sr + sy * sp * cr;
  const R11 = cr * cp;
  const R12 = sy * sr + cy * sp * cr;

  const R20 = sy * cp;
  const R21 = -sp;
  const R22 = cy * cp;

  return [
    [R00, R01, R02],
    [R10, R11, R12],
    [R20, R21, R22],
  ];
}

/** Transform 3D point by scale, rotation, and translation: P_obs = s * R * Q + T */
function transformPoint(p: Point3D, R: Matrix3x3, T: Vector3D, s: number): Point3D {
  return {
    x: s * (R[0][0] * p.x + R[0][1] * p.y + R[0][2] * p.z) + T[0],
    y: s * (R[1][0] * p.x + R[1][1] * p.y + R[1][2] * p.z) + T[1],
    z: s * (R[2][0] * p.x + R[2][1] * p.y + R[2][2] * p.z) + T[2],
  };
}

describe("3D Canonical Alignment & SVD Kabsch Solver (Milestone 1)", () => {
  it("M1-01: Canonical Reference Face Mesh Export & Index Mappings", () => {
    assert.equal(CANONICAL_FACE_3D.length, 68);
    assert.equal(LANDMARK_MAP_68_TO_CANONICAL.length, 68);
    assert.ok(Object.keys(LANDMARK_MAP_MEDIAPIPE_TO_CANONICAL).length >= 20);

    // Midpoint origin check: inter-ocular midpoint of left/right eye centers (36,39 vs 42,45)
    const lEyeCenter = {
      x: (CANONICAL_FACE_3D[36]!.x + CANONICAL_FACE_3D[39]!.x) / 2,
      y: (CANONICAL_FACE_3D[36]!.y + CANONICAL_FACE_3D[39]!.y) / 2,
      z: (CANONICAL_FACE_3D[36]!.z + CANONICAL_FACE_3D[39]!.z) / 2,
    };
    const rEyeCenter = {
      x: (CANONICAL_FACE_3D[42]!.x + CANONICAL_FACE_3D[45]!.x) / 2,
      y: (CANONICAL_FACE_3D[42]!.y + CANONICAL_FACE_3D[45]!.y) / 2,
      z: (CANONICAL_FACE_3D[42]!.z + CANONICAL_FACE_3D[45]!.z) / 2,
    };
    const interOcularMid = {
      x: (lEyeCenter.x + rEyeCenter.x) / 2,
      y: (lEyeCenter.y + rEyeCenter.y) / 2,
      z: (lEyeCenter.z + rEyeCenter.z) / 2,
    };

    assert.ok(Math.abs(interOcularMid.x) < 1e-4);
    assert.ok(Math.abs(interOcularMid.y) < 1e-4);
  });

  it("M1-02: Identity Alignment of Frontal Canonical Face", () => {
    const result = alignToCanonical3D(CANONICAL_FACE_3D);

    assert.ok(result.scale > 0.999 && result.scale < 1.001);
    assert.ok(result.residualError < 1e-4);
    assert.equal(result.unwarpedLandmarks.length, 68);

    // Rotation matrix should be identity
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const expected = r === c ? 1 : 0;
        assert.ok(
          Math.abs(result.rotation[r]![c]! - expected) < 1e-4,
          `Rotation element [${r}][${c}] expected ${expected}, got ${result.rotation[r]![c]!}`
        );
      }
    }

    // Translation vector should be near zero
    assert.ok(Math.hypot(...result.translation) < 1e-4);
  });

  it("M1-03: Synthetic Yaw (±35°) and Pitch (±20°) 3D SVD Rotation Alignment", () => {
    const testCases = [
      { yaw: 30, pitch: 0, roll: 0, scale: 1.2, trans: [10, -5, 15] as Vector3D },
      { yaw: -35, pitch: 15, roll: -5, scale: 0.9, trans: [-20, 8, -10] as Vector3D },
      { yaw: 0, pitch: 20, roll: 10, scale: 1.05, trans: [5, 12, 0] as Vector3D },
      { yaw: -25, pitch: -20, roll: 0, scale: 1.1, trans: [0, 0, 5] as Vector3D },
    ];

    for (const tc of testCases) {
      const R_gt = createRotationMatrix(tc.yaw, tc.pitch, tc.roll);
      const syntheticObserved = CANONICAL_FACE_3D.map((p) =>
        transformPoint(p, R_gt, tc.trans, tc.scale)
      );

      const result = alignToCanonical3D(syntheticObserved);

      assert.ok(
        Math.abs(result.scale - tc.scale) < 0.05,
        `Scale recovery error: expected ${tc.scale}, got ${result.scale}`
      );
      assert.ok(
        result.residualError < 1e-3,
        `Residual error too high: ${result.residualError}`
      );

      // Verify unwarped landmarks reconstruct CANONICAL_FACE_3D
      let maxReconstructionErr = 0;
      for (let i = 0; i < 68; i++) {
        const u = result.unwarpedLandmarks[i]!;
        const gt = CANONICAL_FACE_3D[i]!;
        const distErr = Math.hypot(u.x - gt.x, u.y - gt.y, u.z - gt.z);
        if (distErr > maxReconstructionErr) maxReconstructionErr = distErr;
      }

      assert.ok(
        maxReconstructionErr < 1e-3,
        `Max reconstruction error for yaw ${tc.yaw} pitch ${tc.pitch}: ${maxReconstructionErr}`
      );
    }
  });

  it("M1-04: Ratio Variance Invariance Across Yaw (±30°) and Pitch (±20°) (< 3.5%)", () => {
    // Generate frontal reference features
    const frontalFeat = extractGeometryFeatures68(CANONICAL_FACE_3D);

    const testPoses = [
      { yaw: 30, pitch: 0, roll: 0 },
      { yaw: -30, pitch: 0, roll: 0 },
      { yaw: 0, pitch: 20, roll: 0 },
      { yaw: 0, pitch: -20, roll: 0 },
      { yaw: 25, pitch: 15, roll: -5 },
    ];

    const featureKeysToTest: (keyof typeof frontalFeat)[] = [
      "faceAspect",
      "jawWidth",
      "eyeSpacing",
      "noseLength",
      "noseWidth",
      "mouthWidth",
      "lipFullness",
    ];

    for (const pose of testPoses) {
      const R = createRotationMatrix(pose.yaw, pose.pitch, pose.roll);
      const rotatedLandmarks = CANONICAL_FACE_3D.map((p) =>
        transformPoint(p, R, [0, 0, 0], 1.0)
      );

      const rotatedFeat = extractGeometryFeatures68(rotatedLandmarks);

      for (const key of featureKeysToTest) {
        const valRef = frontalFeat[key];
        const valRot = rotatedFeat[key];
        if (typeof valRef === "number" && typeof valRot === "number" && valRef > 0) {
          const relDiff = Math.abs(valRot - valRef) / valRef;
          const pctVar = relDiff * 100;
          assert.ok(
            pctVar < 3.5,
            `Feature ${key} variance under yaw ${pose.yaw} pitch ${pose.pitch} was ${pctVar.toFixed(2)}% (exceeds 3.5% threshold)`
          );
        }
      }
    }
  });

  it("M1-05: Asymmetric Landmark Occlusion Handling Without NaN", () => {
    const visibilityMask = new Array(68).fill(true);
    // Mask out 30% of landmarks (left side of face)
    for (let i = 0; i < 20; i++) {
      visibilityMask[i] = false;
    }

    const R = createRotationMatrix(25, 10, 0);
    const syntheticObserved = CANONICAL_FACE_3D.map((p) =>
      transformPoint(p, R, [5, -2, 10], 1.1)
    );

    const result = alignToCanonical3D(syntheticObserved, visibilityMask);

    assert.ok(Number.isFinite(result.scale));
    assert.ok(Number.isFinite(result.residualError));

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        assert.ok(Number.isFinite(result.rotation[r]![c]!));
      }
    }

    for (let i = 0; i < 68; i++) {
      const pt = result.unwarpedLandmarks[i]!;
      assert.ok(Number.isFinite(pt.x));
      assert.ok(Number.isFinite(pt.y));
      assert.ok(Number.isFinite(pt.z));
      assert.equal(result.isOccludedMask[i], !visibilityMask[i]);
    }
  });

  it("M1-06: Edge Case Handling (<3 Visible Points & Degenerate Inputs)", () => {
    // All landmarks occluded
    const allOccluded = new Array(68).fill(false);
    const resultAllOccluded = alignToCanonical3D(CANONICAL_FACE_3D, allOccluded);

    assert.equal(resultAllOccluded.scale, 1.0);
    assert.equal(resultAllOccluded.residualError, Infinity);
    assert.equal(resultAllOccluded.unwarpedLandmarks.length, 68);

    // Empty array input
    const resultEmpty = alignToCanonical3D([]);
    assert.equal(resultEmpty.scale, 1.0);
    assert.equal(resultEmpty.unwarpedLandmarks.length, 0);
  });

  it("M1-07: Helper Function unwarpLandmarksToFrontal Integration", () => {
    const unwarped = unwarpLandmarksToFrontal(CANONICAL_FACE_3D);
    assert.equal(unwarped.length, 68);
    assert.ok(Math.abs(unwarped[8]!.x - CANONICAL_FACE_3D[8]!.x) < 1e-3);
  });
});
