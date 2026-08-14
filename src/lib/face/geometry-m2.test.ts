import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractAnatomicalFeatures,
  extractAnatomicalFeatures68,
  extractGeometryFeatures,
  extractGeometryFeatures68,
  CANONICAL_ANATOMICAL_DEFAULTS,
  type Landmark,
} from "./geometry.ts";
import { CANONICAL_FACE_3D } from "./pose.ts";
import type { Point3D, Matrix3x3 } from "./types.ts";

/** Convert 3D Euler angles (in degrees) to a 3x3 rotation matrix R (yaw, pitch, roll). */
function eulerToRotationMatrix(yawDeg: number, pitchDeg: number, rollDeg: number): Matrix3x3 {
  const rad = Math.PI / 180;
  const y = yawDeg * rad;
  const p = pitchDeg * rad;
  const r = rollDeg * rad;

  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const cr = Math.cos(r);
  const sr = Math.sin(r);

  const r00 = cy * cr + sy * sp * sr;
  const r01 = -cy * sr + sy * sp * cr;
  const r02 = sy * cp;

  const r10 = cp * sr;
  const r11 = cp * cr;
  const r12 = -sp;

  const r20 = -sy * cr + cy * sp * sr;
  const r21 = sy * sr + cy * sp * cr;
  const r22 = cy * cp;

  return [
    [r00, r01, r02],
    [r10, r11, r12],
    [r20, r21, r22],
  ];
}

/** Rotate a 3D point by 3x3 rotation matrix R. */
function rotatePoint3D(pt: Point3D, R: Matrix3x3): Point3D {
  return {
    x: R[0][0] * pt.x + R[0][1] * pt.y + R[0][2] * pt.z,
    y: R[1][0] * pt.x + R[1][1] * pt.y + R[1][2] * pt.z,
    z: R[2][0] * pt.x + R[2][1] * pt.y + R[2][2] * pt.z,
  };
}

describe("Milestone 2 (M2): Anatomical Vectorization & Morphology", () => {
  describe("Canonical Landmark Accuracy (9 Ratios & Angles)", () => {
    it("extracts valid 9 clinical proportions from 68-point CANONICAL_FACE_3D reference", () => {
      const anatomical = extractAnatomicalFeatures68(CANONICAL_FACE_3D);

      // 1. Facial Thirds
      assert.ok(anatomical.upperThirdRatio > 0.20 && anatomical.upperThirdRatio < 0.45, `upperThirdRatio=${anatomical.upperThirdRatio}`);
      assert.ok(anatomical.middleThirdRatio > 0.20 && anatomical.middleThirdRatio < 0.45, `middleThirdRatio=${anatomical.middleThirdRatio}`);
      assert.ok(anatomical.lowerThirdRatio > 0.20 && anatomical.lowerThirdRatio < 0.45, `lowerThirdRatio=${anatomical.lowerThirdRatio}`);
      const thirdSum = anatomical.upperThirdRatio + anatomical.middleThirdRatio + anatomical.lowerThirdRatio;
      assert.ok(Math.abs(thirdSum - 1.0) < 0.01, `Thirds sum=${thirdSum}`);

      // 2. Lateral Fifths (5 sectors)
      assert.equal(anatomical.lateralFifthsRatios.length, 5);
      const fifthsSum = anatomical.lateralFifthsRatios.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(fifthsSum - 1.0) < 0.01, `Fifths sum=${fifthsSum}`);

      // 3. Inter-canthal distance
      assert.ok(anatomical.interCanthalDistance >= 0.15 && anatomical.interCanthalDistance <= 0.35, `interCanthalDistance=${anatomical.interCanthalDistance}`);

      // 4. Canthal tilt angle (deg)
      assert.ok(Number.isFinite(anatomical.canthalTiltAngleDeg) && Math.abs(anatomical.canthalTiltAngleDeg) < 20.0, `canthalTiltAngleDeg=${anatomical.canthalTiltAngleDeg}`);

      // 5. Nasal index
      assert.ok(anatomical.nasalIndex >= 0.40 && anatomical.nasalIndex <= 1.20, `nasalIndex=${anatomical.nasalIndex}`);

      // 6. Bigonial to bizygomatic ratio
      assert.ok(anatomical.bigonialToBizygomaticRatio >= 0.60 && anatomical.bigonialToBizygomaticRatio <= 0.95, `bigonialToBizygomaticRatio=${anatomical.bigonialToBizygomaticRatio}`);

      // 7. Gonial jawline angle (deg)
      assert.ok(anatomical.gonialJawlineAngleDeg >= 100.0 && anatomical.gonialJawlineAngleDeg <= 145.0, `gonialJawlineAngleDeg=${anatomical.gonialJawlineAngleDeg}`);

      // 8. Lip vermilion height ratio
      assert.ok(anatomical.lipVermilionHeightRatio >= 0.30 && anatomical.lipVermilionHeightRatio <= 1.50, `lipVermilionHeightRatio=${anatomical.lipVermilionHeightRatio}`);

      // 9. Philtrum depth
      assert.ok(anatomical.philtrumDepth >= 0.20 && anatomical.philtrumDepth <= 1.20, `philtrumDepth=${anatomical.philtrumDepth}`);
    });
  });

  describe("Pose-Invariance Verification (< 3.5% Ratio Variance under Yaw ±30°, Pitch ±20°)", () => {
    it("maintains < 3.5% ratio variance under synthetic yaw perturbations up to ±30°", () => {
      const base = extractAnatomicalFeatures68(CANONICAL_FACE_3D);
      const testAngles = [-30, -20, -10, 10, 20, 30];

      for (const yaw of testAngles) {
        const R = eulerToRotationMatrix(yaw, 0, 0);
        const rotatedMesh = CANONICAL_FACE_3D.map((p) => rotatePoint3D(p, R));
        const rotatedFeat = extractAnatomicalFeatures68(rotatedMesh);

        const deltaUpper = Math.abs(rotatedFeat.upperThirdRatio - base.upperThirdRatio) / base.upperThirdRatio;
        const deltaMiddle = Math.abs(rotatedFeat.middleThirdRatio - base.middleThirdRatio) / base.middleThirdRatio;
        const deltaLower = Math.abs(rotatedFeat.lowerThirdRatio - base.lowerThirdRatio) / base.lowerThirdRatio;
        const deltaInterCanthal = Math.abs(rotatedFeat.interCanthalDistance - base.interCanthalDistance) / base.interCanthalDistance;
        const deltaBigonial = Math.abs(rotatedFeat.bigonialToBizygomaticRatio - base.bigonialToBizygomaticRatio) / base.bigonialToBizygomaticRatio;
        const deltaNasal = Math.abs(rotatedFeat.nasalIndex - base.nasalIndex) / base.nasalIndex;

        assert.ok(deltaUpper < 0.035, `yaw ${yaw}° upperThirdRatio variance ${(deltaUpper * 100).toFixed(2)}% >= 3.5%`);
        assert.ok(deltaMiddle < 0.035, `yaw ${yaw}° middleThirdRatio variance ${(deltaMiddle * 100).toFixed(2)}% >= 3.5%`);
        assert.ok(deltaLower < 0.035, `yaw ${yaw}° lowerThirdRatio variance ${(deltaLower * 100).toFixed(2)}% >= 3.5%`);
        assert.ok(deltaInterCanthal < 0.035, `yaw ${yaw}° interCanthalDistance variance ${(deltaInterCanthal * 100).toFixed(2)}% >= 3.5%`);
        assert.ok(deltaBigonial < 0.035, `yaw ${yaw}° bigonialToBizygomaticRatio variance ${(deltaBigonial * 100).toFixed(2)}% >= 3.5%`);
        assert.ok(deltaNasal < 0.035, `yaw ${yaw}° nasalIndex variance ${(deltaNasal * 100).toFixed(2)}% >= 3.5%`);
      }
    });

    it("maintains < 3.5% ratio variance under synthetic pitch perturbations up to ±20°", () => {
      const base = extractAnatomicalFeatures68(CANONICAL_FACE_3D);
      const testAngles = [-20, -10, 10, 20];

      for (const pitch of testAngles) {
        const R = eulerToRotationMatrix(0, pitch, 0);
        const rotatedMesh = CANONICAL_FACE_3D.map((p) => rotatePoint3D(p, R));
        const rotatedFeat = extractAnatomicalFeatures68(rotatedMesh);

        const deltaUpper = Math.abs(rotatedFeat.upperThirdRatio - base.upperThirdRatio) / base.upperThirdRatio;
        const deltaMiddle = Math.abs(rotatedFeat.middleThirdRatio - base.middleThirdRatio) / base.middleThirdRatio;
        const deltaLower = Math.abs(rotatedFeat.lowerThirdRatio - base.lowerThirdRatio) / base.lowerThirdRatio;
        const deltaInterCanthal = Math.abs(rotatedFeat.interCanthalDistance - base.interCanthalDistance) / base.interCanthalDistance;

        assert.ok(deltaUpper < 0.035, `pitch ${pitch}° upperThirdRatio variance ${(deltaUpper * 100).toFixed(2)}% >= 3.5%`);
        assert.ok(deltaMiddle < 0.035, `pitch ${pitch}° middleThirdRatio variance ${(deltaMiddle * 100).toFixed(2)}% >= 3.5%`);
        assert.ok(deltaLower < 0.035, `pitch ${pitch}° lowerThirdRatio variance ${(deltaLower * 100).toFixed(2)}% >= 3.5%`);
        assert.ok(deltaInterCanthal < 0.035, `pitch ${pitch}° interCanthalDistance variance ${(deltaInterCanthal * 100).toFixed(2)}% >= 3.5%`);
      }
    });
  });

  describe("NaN & Occlusion Safety", () => {
    it("handles empty landmark arrays gracefully without throwing NaN", () => {
      const res = extractAnatomicalFeatures([]);
      assert.deepEqual(res, CANONICAL_ANATOMICAL_DEFAULTS);
      const res68 = extractAnatomicalFeatures68([]);
      assert.deepEqual(res68, CANONICAL_ANATOMICAL_DEFAULTS);
    });

    it("handles underconstrained/corrupted landmarks with zero/NaN points without throwing", () => {
      const corrupt = Array.from({ length: 68 }, () => ({ x: NaN, y: NaN, z: NaN }));
      const res = extractAnatomicalFeatures68(corrupt);
      for (const [k, v] of Object.entries(res)) {
        if (Array.isArray(v)) {
          v.forEach((num) => assert.ok(Number.isFinite(num), `Key ${k} contains non-finite element`));
        } else {
          assert.ok(Number.isFinite(v as number), `Key ${k}=${v} is non-finite`);
        }
      }
    });
  });

  describe("Execution Latency SLA (< 15ms)", () => {
    it("executes full anatomical feature extraction in < 15ms per frame (and < 1.5ms target)", () => {
      const start = performance.now();
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        extractAnatomicalFeatures68(CANONICAL_FACE_3D);
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;

      assert.ok(avgMs < 15.0, `Average latency ${avgMs.toFixed(3)}ms exceeds 15.0ms SLA`);
      assert.ok(avgMs < 1.5, `Average latency ${avgMs.toFixed(3)}ms exceeds target 1.5ms`);
    });
  });

  describe("FaceFeatures Interface Population", () => {
    it("populates the optional anatomical field in extractGeometryFeatures68", () => {
      const f = extractGeometryFeatures68(CANONICAL_FACE_3D);
      assert.ok(f.anatomical, "f.anatomical is missing");
      assert.equal(typeof f.anatomical.upperThirdRatio, "number");
      assert.equal(f.anatomical.lateralFifthsRatios.length, 5);
    });
  });
});
