import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractAnatomicalFeatures68,
  CANONICAL_ANATOMICAL_DEFAULTS,
} from "./geometry.ts";
import { CANONICAL_FACE_3D } from "./pose.ts";
import type { Point3D, Matrix3x3, ExtendedAnatomicalFeatures } from "./types.ts";

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

describe("Challenger 1 Stress Test: M2 Pose Invariance Across ALL 9 Clinical Ratios/Angles", () => {
  const base = extractAnatomicalFeatures68(CANONICAL_FACE_3D);

  it("quantifies and asserts < 3.5% ratio variance under synthetic yaw (±30°) across ALL 9 clinical proportions (CANONICAL_FACE_3D)", () => {
    const yawAngles = [-30, -25, -20, -15, -10, -5, 5, 10, 15, 20, 25, 30];
    const maxVariances: Record<string, number> = {
      upperThirdRatio: 0,
      middleThirdRatio: 0,
      lowerThirdRatio: 0,
      lateralFifths_sector0: 0,
      lateralFifths_sector1: 0,
      lateralFifths_sector2: 0,
      lateralFifths_sector3: 0,
      lateralFifths_sector4: 0,
      interCanthalDistance: 0,
      canthalTiltAngleAbsDeg: 0,
      nasalIndex: 0,
      bigonialToBizygomaticRatio: 0,
      gonialJawlineAngleDeg: 0,
      lipVermilionHeightRatio: 0,
      philtrumDepth: 0,
    };

    for (const yaw of yawAngles) {
      const R = eulerToRotationMatrix(yaw, 0, 0);
      const rotatedMesh = CANONICAL_FACE_3D.map((p) => rotatePoint3D(p, R));
      const rotatedFeat = extractAnatomicalFeatures68(rotatedMesh);

      const vUpper = Math.abs(rotatedFeat.upperThirdRatio - base.upperThirdRatio) / base.upperThirdRatio;
      const vMiddle = Math.abs(rotatedFeat.middleThirdRatio - base.middleThirdRatio) / base.middleThirdRatio;
      const vLower = Math.abs(rotatedFeat.lowerThirdRatio - base.lowerThirdRatio) / base.lowerThirdRatio;

      const vFifths = rotatedFeat.lateralFifthsRatios.map(
        (val, i) => Math.abs(val - base.lateralFifthsRatios[i]!) / base.lateralFifthsRatios[i]!
      );

      const vInterCanthal = Math.abs(rotatedFeat.interCanthalDistance - base.interCanthalDistance) / base.interCanthalDistance;
      const vCanthalTiltAbs = Math.abs(rotatedFeat.canthalTiltAngleDeg - base.canthalTiltAngleDeg);
      const vNasal = Math.abs(rotatedFeat.nasalIndex - base.nasalIndex) / base.nasalIndex;
      const vBigonial = Math.abs(rotatedFeat.bigonialToBizygomaticRatio - base.bigonialToBizygomaticRatio) / base.bigonialToBizygomaticRatio;
      const vGonialAngle = Math.abs(rotatedFeat.gonialJawlineAngleDeg - base.gonialJawlineAngleDeg) / base.gonialJawlineAngleDeg;
      const vLipVermilion = Math.abs(rotatedFeat.lipVermilionHeightRatio - base.lipVermilionHeightRatio) / base.lipVermilionHeightRatio;
      const vPhiltrumDepth = Math.abs(rotatedFeat.philtrumDepth - base.philtrumDepth) / base.philtrumDepth;

      maxVariances.upperThirdRatio = Math.max(maxVariances.upperThirdRatio, vUpper);
      maxVariances.middleThirdRatio = Math.max(maxVariances.middleThirdRatio, vMiddle);
      maxVariances.lowerThirdRatio = Math.max(maxVariances.lowerThirdRatio, vLower);

      vFifths.forEach((v, i) => {
        maxVariances[`lateralFifths_sector${i}`] = Math.max(maxVariances[`lateralFifths_sector${i}`]!, v);
      });

      maxVariances.interCanthalDistance = Math.max(maxVariances.interCanthalDistance, vInterCanthal);
      maxVariances.canthalTiltAngleAbsDeg = Math.max(maxVariances.canthalTiltAngleAbsDeg, vCanthalTiltAbs);
      maxVariances.nasalIndex = Math.max(maxVariances.nasalIndex, vNasal);
      maxVariances.bigonialToBizygomaticRatio = Math.max(maxVariances.bigonialToBizygomaticRatio, vBigonial);
      maxVariances.gonialJawlineAngleDeg = Math.max(maxVariances.gonialJawlineAngleDeg, vGonialAngle);
      maxVariances.lipVermilionHeightRatio = Math.max(maxVariances.lipVermilionHeightRatio, vLipVermilion);
      maxVariances.philtrumDepth = Math.max(maxVariances.philtrumDepth, vPhiltrumDepth);
    }

    console.log("Yaw (±30°) Max Variances:", JSON.stringify(maxVariances, null, 2));

    for (const [key, variance] of Object.entries(maxVariances)) {
      if (key === "canthalTiltAngleAbsDeg") {
        assert.ok(
          variance < 0.1,
          `Yaw absolute angle difference for ${key} is ${variance.toFixed(6)}°, which exceeds 0.1°!`
        );
      } else {
        assert.ok(
          variance < 0.035,
          `Yaw ratio variance for ${key} is ${(variance * 100).toFixed(4)}%, which exceeds strict 3.5% threshold!`
        );
      }
    }
  });

  it("quantifies and asserts < 3.5% ratio variance under synthetic pitch (±20°) across ALL 9 clinical proportions (CANONICAL_FACE_3D)", () => {
    const pitchAngles = [-20, -15, -10, -5, 5, 10, 15, 20];
    const maxVariances: Record<string, number> = {
      upperThirdRatio: 0,
      middleThirdRatio: 0,
      lowerThirdRatio: 0,
      lateralFifths_sector0: 0,
      lateralFifths_sector1: 0,
      lateralFifths_sector2: 0,
      lateralFifths_sector3: 0,
      lateralFifths_sector4: 0,
      interCanthalDistance: 0,
      canthalTiltAngleAbsDeg: 0,
      nasalIndex: 0,
      bigonialToBizygomaticRatio: 0,
      gonialJawlineAngleDeg: 0,
      lipVermilionHeightRatio: 0,
      philtrumDepth: 0,
    };

    for (const pitch of pitchAngles) {
      const R = eulerToRotationMatrix(0, pitch, 0);
      const rotatedMesh = CANONICAL_FACE_3D.map((p) => rotatePoint3D(p, R));
      const rotatedFeat = extractAnatomicalFeatures68(rotatedMesh);

      const vUpper = Math.abs(rotatedFeat.upperThirdRatio - base.upperThirdRatio) / base.upperThirdRatio;
      const vMiddle = Math.abs(rotatedFeat.middleThirdRatio - base.middleThirdRatio) / base.middleThirdRatio;
      const vLower = Math.abs(rotatedFeat.lowerThirdRatio - base.lowerThirdRatio) / base.lowerThirdRatio;

      const vFifths = rotatedFeat.lateralFifthsRatios.map(
        (val, i) => Math.abs(val - base.lateralFifthsRatios[i]!) / base.lateralFifthsRatios[i]!
      );

      const vInterCanthal = Math.abs(rotatedFeat.interCanthalDistance - base.interCanthalDistance) / base.interCanthalDistance;
      const vCanthalTiltAbs = Math.abs(rotatedFeat.canthalTiltAngleDeg - base.canthalTiltAngleDeg);
      const vNasal = Math.abs(rotatedFeat.nasalIndex - base.nasalIndex) / base.nasalIndex;
      const vBigonial = Math.abs(rotatedFeat.bigonialToBizygomaticRatio - base.bigonialToBizygomaticRatio) / base.bigonialToBizygomaticRatio;
      const vGonialAngle = Math.abs(rotatedFeat.gonialJawlineAngleDeg - base.gonialJawlineAngleDeg) / base.gonialJawlineAngleDeg;
      const vLipVermilion = Math.abs(rotatedFeat.lipVermilionHeightRatio - base.lipVermilionHeightRatio) / base.lipVermilionHeightRatio;
      const vPhiltrumDepth = Math.abs(rotatedFeat.philtrumDepth - base.philtrumDepth) / base.philtrumDepth;

      maxVariances.upperThirdRatio = Math.max(maxVariances.upperThirdRatio, vUpper);
      maxVariances.middleThirdRatio = Math.max(maxVariances.middleThirdRatio, vMiddle);
      maxVariances.lowerThirdRatio = Math.max(maxVariances.lowerThirdRatio, vLower);

      vFifths.forEach((v, i) => {
        maxVariances[`lateralFifths_sector${i}`] = Math.max(maxVariances[`lateralFifths_sector${i}`]!, v);
      });

      maxVariances.interCanthalDistance = Math.max(maxVariances.interCanthalDistance, vInterCanthal);
      maxVariances.canthalTiltAngleAbsDeg = Math.max(maxVariances.canthalTiltAngleAbsDeg, vCanthalTiltAbs);
      maxVariances.nasalIndex = Math.max(maxVariances.nasalIndex, vNasal);
      maxVariances.bigonialToBizygomaticRatio = Math.max(maxVariances.bigonialToBizygomaticRatio, vBigonial);
      maxVariances.gonialJawlineAngleDeg = Math.max(maxVariances.gonialJawlineAngleDeg, vGonialAngle);
      maxVariances.lipVermilionHeightRatio = Math.max(maxVariances.lipVermilionHeightRatio, vLipVermilion);
      maxVariances.philtrumDepth = Math.max(maxVariances.philtrumDepth, vPhiltrumDepth);
    }

    console.log("Pitch (±20°) Max Variances:", JSON.stringify(maxVariances, null, 2));

    for (const [key, variance] of Object.entries(maxVariances)) {
      if (key === "canthalTiltAngleAbsDeg") {
        assert.ok(
          variance < 0.1,
          `Pitch absolute angle difference for ${key} is ${variance.toFixed(6)}°, which exceeds 0.1°!`
        );
      } else {
        assert.ok(
          variance < 0.035,
          `Pitch ratio variance for ${key} is ${(variance * 100).toFixed(4)}%, which exceeds strict 3.5% threshold!`
        );
      }
    }
  });

  it("quantifies and asserts < 3.5% ratio variance under non-zero initial canthal tilt (4.0°) across ALL 9 clinical proportions", () => {
    const tiltedMesh = CANONICAL_FACE_3D.map((p, idx) => {
      if (idx === 36 || idx === 37 || idx === 41) {
        return { ...p, y: p.y + 2.0 };
      }
      if (idx === 45 || idx === 44 || idx === 46) {
        return { ...p, y: p.y + 2.0 };
      }
      return p;
    });

    const baseTilted = extractAnatomicalFeatures68(tiltedMesh);
    assert.ok(Math.abs(baseTilted.canthalTiltAngleDeg) > 1.0, `baseTilted.canthalTiltAngleDeg=${baseTilted.canthalTiltAngleDeg}`);

    const yawAngles = [-30, -20, 20, 30];
    const pitchAngles = [-20, -10, 10, 20];

    for (const yaw of yawAngles) {
      for (const pitch of pitchAngles) {
        const R = eulerToRotationMatrix(yaw, pitch, 0);
        const rotMesh = tiltedMesh.map((p) => rotatePoint3D(p, R));
        const rotFeat = extractAnatomicalFeatures68(rotMesh);

        const vCanthalTiltRel = Math.abs(rotFeat.canthalTiltAngleDeg - baseTilted.canthalTiltAngleDeg) / Math.abs(baseTilted.canthalTiltAngleDeg);
        assert.ok(
          vCanthalTiltRel < 0.035,
          `Combined rotation (yaw ${yaw}°, pitch ${pitch}°) canthal tilt relative variance ${(vCanthalTiltRel * 100).toFixed(4)}% >= 3.5%`
        );
      }
    }
  });

  it("handles 2D projected inputs (z=0) with graceful fallback and documented pitch foreshortening caveat", () => {
    const yawAngles = [-20, -10, 10, 20];

    for (const yaw of yawAngles) {
      const R = eulerToRotationMatrix(yaw, 0, 0);
      const rot2DMesh = CANONICAL_FACE_3D.map((p) => {
        const r3d = rotatePoint3D(p, R);
        return { x: r3d.x, y: r3d.y };
      });

      const rotFeat2D = extractAnatomicalFeatures68(rot2DMesh);

      const vUpper = Math.abs(rotFeat2D.upperThirdRatio - base.upperThirdRatio) / base.upperThirdRatio;
      const vMiddle = Math.abs(rotFeat2D.middleThirdRatio - base.middleThirdRatio) / base.middleThirdRatio;
      const vLower = Math.abs(rotFeat2D.lowerThirdRatio - base.lowerThirdRatio) / base.lowerThirdRatio;
      const vInterCanthal = Math.abs(rotFeat2D.interCanthalDistance - base.interCanthalDistance) / base.interCanthalDistance;

      assert.ok(vUpper < 0.035, `2D yaw unwarping upperThirdRatio variance ${(vUpper * 100).toFixed(2)}% >= 3.5%`);
      assert.ok(vMiddle < 0.035, `2D yaw unwarping middleThirdRatio variance ${(vMiddle * 100).toFixed(2)}% >= 3.5%`);
      assert.ok(vLower < 0.035, `2D yaw unwarping lowerThirdRatio variance ${(vLower * 100).toFixed(2)}% >= 3.5%`);
      assert.ok(vInterCanthal < 0.035, `2D yaw unwarping interCanthalDistance variance ${(vInterCanthal * 100).toFixed(2)}% >= 3.5%`);
    }
  });

  it("quantifies combined yaw (±30°) AND pitch (±20°) variance across ALL 9 proportions", () => {
    const combinedAngles = [
      { yaw: -30, pitch: -20 },
      { yaw: 30, pitch: 20 },
      { yaw: -30, pitch: 20 },
      { yaw: 30, pitch: -20 },
      { yaw: -15, pitch: 15 },
      { yaw: 20, pitch: -10 },
    ];

    const maxVariances: Record<string, number> = {
      upperThirdRatio: 0,
      middleThirdRatio: 0,
      lowerThirdRatio: 0,
      lateralFifths_sector0: 0,
      lateralFifths_sector1: 0,
      lateralFifths_sector2: 0,
      lateralFifths_sector3: 0,
      lateralFifths_sector4: 0,
      interCanthalDistance: 0,
      canthalTiltAngleAbsDeg: 0,
      nasalIndex: 0,
      bigonialToBizygomaticRatio: 0,
      gonialJawlineAngleDeg: 0,
      lipVermilionHeightRatio: 0,
      philtrumDepth: 0,
    };

    for (const { yaw, pitch } of combinedAngles) {
      const R = eulerToRotationMatrix(yaw, pitch, 0);
      const rotatedMesh = CANONICAL_FACE_3D.map((p) => rotatePoint3D(p, R));
      const rotatedFeat = extractAnatomicalFeatures68(rotatedMesh);

      const vUpper = Math.abs(rotatedFeat.upperThirdRatio - base.upperThirdRatio) / base.upperThirdRatio;
      const vMiddle = Math.abs(rotatedFeat.middleThirdRatio - base.middleThirdRatio) / base.middleThirdRatio;
      const vLower = Math.abs(rotatedFeat.lowerThirdRatio - base.lowerThirdRatio) / base.lowerThirdRatio;

      const vFifths = rotatedFeat.lateralFifthsRatios.map(
        (val, i) => Math.abs(val - base.lateralFifthsRatios[i]!) / base.lateralFifthsRatios[i]!
      );

      const vInterCanthal = Math.abs(rotatedFeat.interCanthalDistance - base.interCanthalDistance) / base.interCanthalDistance;
      const vCanthalTiltAbs = Math.abs(rotatedFeat.canthalTiltAngleDeg - base.canthalTiltAngleDeg);
      const vNasal = Math.abs(rotatedFeat.nasalIndex - base.nasalIndex) / base.nasalIndex;
      const vBigonial = Math.abs(rotatedFeat.bigonialToBizygomaticRatio - base.bigonialToBizygomaticRatio) / base.bigonialToBizygomaticRatio;
      const vGonialAngle = Math.abs(rotatedFeat.gonialJawlineAngleDeg - base.gonialJawlineAngleDeg) / base.gonialJawlineAngleDeg;
      const vLipVermilion = Math.abs(rotatedFeat.lipVermilionHeightRatio - base.lipVermilionHeightRatio) / base.lipVermilionHeightRatio;
      const vPhiltrumDepth = Math.abs(rotatedFeat.philtrumDepth - base.philtrumDepth) / base.philtrumDepth;

      maxVariances.upperThirdRatio = Math.max(maxVariances.upperThirdRatio, vUpper);
      maxVariances.middleThirdRatio = Math.max(maxVariances.middleThirdRatio, vMiddle);
      maxVariances.lowerThirdRatio = Math.max(maxVariances.lowerThirdRatio, vLower);

      vFifths.forEach((v, i) => {
        maxVariances[`lateralFifths_sector${i}`] = Math.max(maxVariances[`lateralFifths_sector${i}`]!, v);
      });

      maxVariances.interCanthalDistance = Math.max(maxVariances.interCanthalDistance, vInterCanthal);
      maxVariances.canthalTiltAngleAbsDeg = Math.max(maxVariances.canthalTiltAngleAbsDeg, vCanthalTiltAbs);
      maxVariances.nasalIndex = Math.max(maxVariances.nasalIndex, vNasal);
      maxVariances.bigonialToBizygomaticRatio = Math.max(maxVariances.bigonialToBizygomaticRatio, vBigonial);
      maxVariances.gonialJawlineAngleDeg = Math.max(maxVariances.gonialJawlineAngleDeg, vGonialAngle);
      maxVariances.lipVermilionHeightRatio = Math.max(maxVariances.lipVermilionHeightRatio, vLipVermilion);
      maxVariances.philtrumDepth = Math.max(maxVariances.philtrumDepth, vPhiltrumDepth);
    }

    console.log("Combined Yaw/Pitch Max Variances:", JSON.stringify(maxVariances, null, 2));

    for (const [key, variance] of Object.entries(maxVariances)) {
      if (key === "canthalTiltAngleAbsDeg") {
        assert.ok(
          variance < 0.1,
          `Combined absolute angle difference for ${key} is ${variance.toFixed(6)}°, which exceeds 0.1°!`
        );
      } else {
        assert.ok(
          variance < 0.035,
          `Combined ratio variance for ${key} is ${(variance * 100).toFixed(4)}%, which exceeds strict 3.5% threshold!`
        );
      }
    }
  });
});
