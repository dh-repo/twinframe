import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alignToCanonical3D,
  CANONICAL_FACE_3D,
} from "./pose.ts";
import { extractGeometryFeatures68 } from "./geometry.ts";
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

/** Deterministic pseudo-random generator (LCG) for reproducible stress testing */
function createPRNG(seed = 42) {
  let state = seed;
  return function nextFloat(min: number, max: number): number {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const norm = state / 4294967296;
    return min + norm * (max - min);
  };
}

describe("Empirical Challenger 1: 3D SVD Kabsch & Landmark Unwarping Stress Test", () => {
  it("CHALLENGE-01: 100 Random Rotations with Yaw (±45°), Pitch (±35°), Roll (±25°)", () => {
    const rng = createPRNG(1337);
    const numRotations = 100;
    let totalResidualError = 0;
    let maxReconstructionErr = 0;

    for (let i = 0; i < numRotations; i++) {
      const yaw = rng(-45, 45);
      const pitch = rng(-35, 35);
      const roll = rng(-25, 25);
      const scale = rng(0.7, 1.5);
      const trans: Vector3D = [rng(-50, 50), rng(-50, 50), rng(-50, 50)];

      const R_gt = createRotationMatrix(yaw, pitch, roll);
      const syntheticObserved = CANONICAL_FACE_3D.map((p) =>
        transformPoint(p, R_gt, trans, scale)
      );

      const result = alignToCanonical3D(syntheticObserved);

      assert.ok(Number.isFinite(result.scale), `Iteration ${i}: scale is not finite`);
      assert.ok(Number.isFinite(result.residualError), `Iteration ${i}: residualError is not finite`);
      assert.ok(
        Math.abs(result.scale - scale) < 0.05,
        `Iteration ${i}: scale mismatch for yaw=${yaw.toFixed(1)}, pitch=${pitch.toFixed(1)}. Expected ${scale.toFixed(3)}, got ${result.scale.toFixed(3)}`
      );

      totalResidualError += result.residualError;

      // Verify unwarped landmarks reconstruct CANONICAL_FACE_3D
      for (let j = 0; j < 68; j++) {
        const u = result.unwarpedLandmarks[j]!;
        const gt = CANONICAL_FACE_3D[j]!;
        const distErr = Math.hypot(u.x - gt.x, u.y - gt.y, u.z - gt.z);
        if (distErr > maxReconstructionErr) maxReconstructionErr = distErr;
      }
    }

    const avgResidualError = totalResidualError / numRotations;
    assert.ok(
      avgResidualError < 1e-3,
      `Average residual error across 100 random rotations too high: ${avgResidualError}`
    );
    assert.ok(
      maxReconstructionErr < 1e-3,
      `Max reconstruction error across 100 random rotations too high: ${maxReconstructionErr}`
    );
  });

  it("CHALLENGE-02: Strict < 3.5% Ratio Variance Across 100 Extreme Synthetic Rotations", () => {
    const rng = createPRNG(2026);
    const frontalFeat = extractGeometryFeatures68(CANONICAL_FACE_3D);

    const featureKeysToTest: (keyof typeof frontalFeat)[] = [
      "faceAspect",
      "jawWidth",
      "chinSharpness",
      "foreheadHeight",
      "eyeSpacing",
      "eyeOpenness",
      "eyeSlant",
      "browHeight",
      "noseLength",
      "noseWidth",
      "mouthWidth",
      "lipFullness",
      "cheekboneProminence",
      "faceRoundness",
    ];

    const numRotations = 100;
    let maxObservedVariancePct = 0;
    let worstCaseKey = "";

    for (let i = 0; i < numRotations; i++) {
      const yaw = rng(-45, 45);
      const pitch = rng(-35, 35);
      const roll = rng(-25, 25);
      const scale = rng(0.8, 1.3);
      const trans: Vector3D = [rng(-20, 20), rng(-20, 20), rng(-10, 10)];

      const R_gt = createRotationMatrix(yaw, pitch, roll);
      const syntheticObserved = CANONICAL_FACE_3D.map((p) =>
        transformPoint(p, R_gt, trans, scale)
      );

      const rotatedFeat = extractGeometryFeatures68(syntheticObserved);

      for (const key of featureKeysToTest) {
        const valRef = frontalFeat[key];
        const valRot = rotatedFeat[key];

        if (typeof valRef === "number" && typeof valRot === "number" && valRef > 0) {
          const relDiff = Math.abs(valRot - valRef) / valRef;
          const pctVar = relDiff * 100;

          if (pctVar > maxObservedVariancePct) {
            maxObservedVariancePct = pctVar;
            worstCaseKey = key;
          }

          assert.ok(
            pctVar < 3.5,
            `Iteration ${i} (${key}) under yaw=${yaw.toFixed(1)}° pitch=${pitch.toFixed(1)}°: variance ${pctVar.toFixed(3)}% >= 3.5% limit!`
          );
        }
      }
    }

    assert.ok(
      maxObservedVariancePct < 3.5,
      `Max feature ratio variance across 100 rotations was ${maxObservedVariancePct.toFixed(3)}% on key '${worstCaseKey}' (limit 3.5%)`
    );
  });

  it("CHALLENGE-03: Random 50% Occlusion Masks & Asymmetric Missing Keypoints", () => {
    const rng = createPRNG(999);
    const numOcclusionTests = 50;

    for (let i = 0; i < numOcclusionTests; i++) {
      const yaw = rng(-40, 40);
      const pitch = rng(-30, 30);
      const roll = rng(-20, 20);

      const R = createRotationMatrix(yaw, pitch, roll);
      const syntheticObserved = CANONICAL_FACE_3D.map((p) =>
        transformPoint(p, R, [10, -5, 20], 1.1)
      );

      // Create random 50% visibility mask
      const visibilityMask = new Array(68).fill(true);
      let visibleCount = 68;

      for (let j = 0; j < 68; j++) {
        if (rng(0, 1) < 0.5 && visibleCount > 4) {
          visibilityMask[j] = false;
          visibleCount--;
        }
      }

      const result = alignToCanonical3D(syntheticObserved, visibilityMask);

      // Sanity checks: no NaN, valid values
      assert.ok(Number.isFinite(result.scale), `Occlusion test ${i}: scale is not finite`);
      assert.ok(Number.isFinite(result.residualError), `Occlusion test ${i}: residual error is not finite`);
      assert.ok(result.scale > 0, `Occlusion test ${i}: scale must be positive`);

      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          assert.ok(
            Number.isFinite(result.rotation[r]![c]!),
            `Occlusion test ${i}: rotation[${r}][${c}] is not finite`
          );
        }
      }

      for (let j = 0; j < 68; j++) {
        const u = result.unwarpedLandmarks[j]!;
        assert.ok(Number.isFinite(u.x), `Occlusion test ${i} lm ${j}: x is not finite`);
        assert.ok(Number.isFinite(u.y), `Occlusion test ${i} lm ${j}: y is not finite`);
        assert.ok(Number.isFinite(u.z), `Occlusion test ${i} lm ${j}: z is not finite`);
        assert.equal(result.isOccludedMask[j], !visibilityMask[j]);
      }
    }
  });

  it("CHALLENGE-04: Asymmetric Half-Face Occlusion Patterns (Left-only, Right-only, Upper, Lower)", () => {
    const R = createRotationMatrix(35, -20, 10);
    const syntheticObserved = CANONICAL_FACE_3D.map((p) =>
      transformPoint(p, R, [-15, 25, 5], 0.95)
    );

    // 1. Left side occluded (indices 0..8, 17..21, 36..39, 48..51)
    const leftOccluded = new Array(68).fill(true);
    for (let i = 0; i < 34; i++) leftOccluded[i] = false;

    const resLeft = alignToCanonical3D(syntheticObserved, leftOccluded);
    assert.ok(Number.isFinite(resLeft.scale));
    assert.ok(Number.isFinite(resLeft.residualError));
    assert.ok(resLeft.unwarpedLandmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));

    // 2. Right side occluded (indices 9..16, 22..26, 42..45, 53..56)
    const rightOccluded = new Array(68).fill(true);
    for (let i = 34; i < 68; i++) rightOccluded[i] = false;

    const resRight = alignToCanonical3D(syntheticObserved, rightOccluded);
    assert.ok(Number.isFinite(resRight.scale));
    assert.ok(Number.isFinite(resRight.residualError));
    assert.ok(resRight.unwarpedLandmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));

    // 3. Upper face occluded (eyes & brows 17..26, 36..47)
    const upperOccluded = new Array(68).fill(true);
    for (let i = 17; i <= 47; i++) upperOccluded[i] = false;

    const resUpper = alignToCanonical3D(syntheticObserved, upperOccluded);
    assert.ok(Number.isFinite(resUpper.scale));
    assert.ok(Number.isFinite(resUpper.residualError));
    assert.ok(resUpper.unwarpedLandmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));

    // 4. Lower face occluded (jaw & mouth 0..16, 48..67)
    const lowerOccluded = new Array(68).fill(true);
    for (let i = 0; i <= 16; i++) lowerOccluded[i] = false;
    for (let i = 48; i <= 67; i++) lowerOccluded[i] = false;

    const resLower = alignToCanonical3D(syntheticObserved, lowerOccluded);
    assert.ok(Number.isFinite(resLower.scale));
    assert.ok(Number.isFinite(resLower.residualError));
    assert.ok(resLower.unwarpedLandmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));
  });

  it("CHALLENGE-05: 2D Flat Input (z=0) Under 50 Random Rotations & Occlusions", () => {
    const rng = createPRNG(777);
    const numTests = 50;

    for (let i = 0; i < numTests; i++) {
      const yaw = rng(-35, 35);
      const pitch = rng(-25, 25);
      const roll = rng(-15, 15);

      const R = createRotationMatrix(yaw, pitch, roll);
      // Project to 2D (discard Z coordinate, z=0)
      const syntheticObserved2D = CANONICAL_FACE_3D.map((p) => {
        const p3d = transformPoint(p, R, [5, -5, 0], 1.0);
        return { x: p3d.x, y: p3d.y }; // Point2D without z
      });

      const visibilityMask = new Array(68).fill(true);
      for (let j = 0; j < 68; j++) {
        if (rng(0, 1) < 0.3) visibilityMask[j] = false;
      }

      const result = alignToCanonical3D(syntheticObserved2D, visibilityMask);

      assert.ok(Number.isFinite(result.scale), `2D Test ${i}: scale is not finite`);
      assert.ok(Number.isFinite(result.residualError), `2D Test ${i}: residual error is not finite`);
      assert.ok(result.unwarpedLandmarks.length === 68);
      assert.ok(result.unwarpedLandmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));
    }
  });
});
