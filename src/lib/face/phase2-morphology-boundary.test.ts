import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isValidHumanFaceLandmarks68 } from "./geometry";

/**
 * Options for generating synthetic 68-point facial landmarks.
 */
export interface SyntheticFaceOptions {
  boundsWidth?: number;
  boundsHeight?: number;
  cx?: number;
  cy?: number;
  faceWidth?: number;
  faceHeight?: number;
  iod?: number;
  eyeTilt?: number;
  emd?: number;
  noseYOffset?: number;
  mouthYOffset?: number;
  chinYOffset?: number;
  inverted?: boolean;
}

/**
 * Generates a synthetic array of 68 2D landmark points.
 * Defaults to a canonical valid human face in 320x320 crop space.
 */
export function generateSyntheticFace68(options: SyntheticFaceOptions = {}): Array<{ x: number; y: number }> {
  const bw = options.boundsWidth ?? 320;
  const bh = options.boundsHeight ?? 320;
  const cx = options.cx ?? bw * 0.5;
  const cy = options.cy ?? bh * 0.5;
  const fw = options.faceWidth ?? bw * 0.5;
  const fh = options.faceHeight ?? bh * 0.5625;

  const iod = options.iod ?? fw * 0.6; // 96 for fw=160
  const tilt = options.eyeTilt ?? 0;

  const eyeMidX = cx;
  const eyeMidY = options.cy !== undefined ? options.cy - fh * 0.24 : 112;

  const lEyeX = eyeMidX - iod / 2;
  const rEyeX = eyeMidX + iod / 2;
  const lEyeY = eyeMidY - tilt / 2;
  const rEyeY = eyeMidY + tilt / 2;

  const emd = options.emd ?? iod * 1.0; // 96 for iod=96

  const pts: Array<{ x: number; y: number }> = new Array(68);

  // Left Eye (points 36..41)
  pts[36] = { x: lEyeX - iod * 0.15, y: lEyeY };
  pts[37] = { x: lEyeX - iod * 0.05, y: lEyeY - iod * 0.05 };
  pts[38] = { x: lEyeX + iod * 0.05, y: lEyeY - iod * 0.05 };
  pts[39] = { x: lEyeX + iod * 0.15, y: lEyeY };
  pts[40] = { x: lEyeX + iod * 0.05, y: lEyeY + iod * 0.05 };
  pts[41] = { x: lEyeX - iod * 0.05, y: lEyeY + iod * 0.05 };

  // Right Eye (points 42..47)
  pts[42] = { x: rEyeX - iod * 0.15, y: rEyeY };
  pts[43] = { x: rEyeX - iod * 0.05, y: rEyeY - iod * 0.05 };
  pts[44] = { x: rEyeX + iod * 0.05, y: rEyeY - iod * 0.05 };
  pts[45] = { x: rEyeX + iod * 0.15, y: rEyeY };
  pts[46] = { x: rEyeX + iod * 0.05, y: rEyeY + iod * 0.05 };
  pts[47] = { x: rEyeX - iod * 0.05, y: rEyeY + iod * 0.05 };

  // Nose (points 27..35)
  const noseY = options.noseYOffset !== undefined
    ? eyeMidY + options.noseYOffset
    : eyeMidY + emd * 0.5;
  pts[27] = { x: cx, y: eyeMidY + (noseY - eyeMidY) * 0.2 };
  pts[28] = { x: cx, y: eyeMidY + (noseY - eyeMidY) * 0.5 };
  pts[29] = { x: cx, y: eyeMidY + (noseY - eyeMidY) * 0.8 };
  pts[30] = { x: cx, y: noseY };
  pts[31] = { x: cx - iod * 0.15, y: noseY + iod * 0.05 };
  pts[32] = { x: cx - iod * 0.08, y: noseY + iod * 0.08 };
  pts[33] = { x: cx, y: noseY + iod * 0.08 };
  pts[34] = { x: cx + iod * 0.08, y: noseY + iod * 0.08 };
  pts[35] = { x: cx + iod * 0.15, y: noseY + iod * 0.05 };

  // Mouth (points 48..67)
  const mouthY = options.mouthYOffset !== undefined
    ? eyeMidY + options.mouthYOffset
    : eyeMidY + emd;
  const mouthW = iod * 0.6;
  for (let i = 48; i <= 67; i++) {
    const step = (i - 48) / 19;
    pts[i] = { x: cx - mouthW / 2 + step * mouthW, y: mouthY };
  }
  pts[48] = { x: cx - mouthW / 2, y: mouthY };
  pts[54] = { x: cx + mouthW / 2, y: mouthY };

  // Eyebrows (points 17..26)
  for (let i = 17; i <= 21; i++) {
    const t = (i - 17) / 4;
    pts[i] = { x: lEyeX - iod * 0.2 + t * (iod * 0.4), y: lEyeY - iod * 0.15 };
  }
  for (let i = 22; i <= 26; i++) {
    const t = (i - 22) / 4;
    pts[i] = { x: rEyeX - iod * 0.2 + t * (iod * 0.4), y: rEyeY - iod * 0.15 };
  }

  // Jawline & Chin (points 0..16)
  const chinY = options.chinYOffset !== undefined
    ? options.chinYOffset
    : mouthY + Math.max(20, emd * 0.5);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const angle = Math.PI * (0.1 + t * 0.8);
    const jx = cx - (fw / 2) * Math.cos(angle);
    const jy = cy + (fh / 2) * Math.sin(angle);
    pts[i] = { x: jx, y: jy };
  }
  pts[0] = { x: cx - fw / 2, y: eyeMidY };
  pts[16] = { x: cx + fw / 2, y: eyeMidY };
  pts[8] = { x: cx, y: chinY };

  if (options.inverted) {
    for (let i = 0; i < 68; i++) {
      pts[i] = { x: pts[i].x, y: bh - pts[i].y };
    }
  }

  return pts;
}

/**
 * Generates synthetic house shape pareidolia landmarks (windows as eyes, door knob as nose, threshold as mouth).
 */
export function generateHousePareidolia68(bw = 320, bh = 320): Array<{ x: number; y: number }> {
  const pts = new Array(68).fill(null).map(() => ({ x: bw / 2, y: bh / 2 }));
  // Windows as eyes (wide IOD = 200)
  pts[36] = { x: 60, y: 120 }; pts[39] = { x: 100, y: 120 };
  pts[42] = { x: 220, y: 120 }; pts[45] = { x: 260, y: 120 };
  // Door knob as nose tip
  pts[30] = { x: 160, y: 150 };
  // Door threshold as mouth
  pts[48] = { x: 140, y: 170 }; pts[54] = { x: 180, y: 170 };
  // Foundation as chin
  pts[8] = { x: 160, y: 300 };
  return pts;
}

/**
 * Generates synthetic collapsed cloud pareidolia landmarks (small 4px cluster).
 */
export function generateCollapsedCloud68(bw = 320, bh = 320): Array<{ x: number; y: number }> {
  return new Array(68).fill(null).map(() => ({
    x: bw * 0.5 + (Math.random() - 0.5) * 4,
    y: bh * 0.5 + (Math.random() - 0.5) * 4,
  }));
}

/**
 * Generates synthetic horizon cloud pareidolia landmarks (flat horizontal band).
 */
export function generateHorizonCloud68(bw = 320, bh = 320): Array<{ x: number; y: number }> {
  return new Array(68).fill(null).map((_, i) => ({
    x: (i / 68) * bw,
    y: bh * 0.5 + Math.sin(i) * 2,
  }));
}

describe("Phase 2: Morphological Validation Boundary Test Suite (GEO-01 to GEO-07)", () => {

  describe("GEO-01: Inverted Landmark Ordering Rejection", () => {
    test("returns true for standard canonical face landmark ordering", () => {
      const canonical = generateSyntheticFace68({ boundsWidth: 320, boundsHeight: 320 });
      assert.equal(isValidHumanFaceLandmarks68(canonical, 320, 320), true);
    });

    test("GEO-01: returns false when vertical landmark ordering is inverted (chin at top, eyes at bottom)", () => {
      const inverted = generateSyntheticFace68({ boundsWidth: 320, boundsHeight: 320, inverted: true });
      assert.equal(isValidHumanFaceLandmarks68(inverted, 320, 320), false);
    });
  });

  describe("GEO-02 & GEO-03: Inter-Ocular Distance (IOD) Threshold (3.9% vs 4.0%)", () => {
    test("GEO-02: rejects face with IOD at 3.9% of crop width (below 4.0% threshold)", () => {
      const face39 = generateSyntheticFace68({
        boundsWidth: 320,
        boundsHeight: 320,
        iod: 320 * 0.039, // 12.48px < 12.80px (4.0% minIod)
        emd: 320 * 0.039, // keep emdRatio = 1.0
        noseYOffset: (320 * 0.039) * 0.5,
        mouthYOffset: 320 * 0.039,
      });
      assert.equal(isValidHumanFaceLandmarks68(face39, 320, 320), false);
    });

    test("GEO-03: accepts face with IOD at 4.0% of crop width (meets 4.0% threshold)", () => {
      const face40 = generateSyntheticFace68({
        boundsWidth: 320,
        boundsHeight: 320,
        iod: 320 * 0.040, // 12.80px >= 12.80px (4.0% minIod)
        emd: 320 * 0.040, // keep emdRatio = 1.0
        noseYOffset: (320 * 0.040) * 0.5,
        mouthYOffset: 320 * 0.040,
      });
      assert.equal(isValidHumanFaceLandmarks68(face40, 320, 320), true);
    });
  });

  describe("GEO-04: Eye Level Tilt Threshold (71% IOD)", () => {
    test("accepts face with eye level tilt at 70% IOD threshold (valid boundary)", () => {
      const targetIod = 96;
      const tiltFrac = 0.70;
      const eyeDx = Math.sqrt(1 - tiltFrac * tiltFrac) * targetIod; // sqrt(0.51) * 96
      const eyeDy = tiltFrac * targetIod; // 67.2px

      // Construct landmarks where rEyeX - lEyeX = eyeDx and rEyeY - lEyeY = eyeDy
      // so overall hypot(dx, dy) === targetIod (96) and dy / iod === 0.70.
      const canonical = generateSyntheticFace68({ boundsWidth: 320, boundsHeight: 320, iod: targetIod });
      const eyeMidX = 160;
      const eyeMidY = 112;
      const lEyeX = eyeMidX - eyeDx / 2;
      const rEyeX = eyeMidX + eyeDx / 2;
      const lEyeY = eyeMidY - eyeDy / 2;
      const rEyeY = eyeMidY + eyeDy / 2;

      // Adjust eye point coordinates
      const faceTilt70 = canonical.map((pt, i) => {
        if (i >= 36 && i <= 41) {
          const relX = pt.x - 112;
          const relY = pt.y - 112;
          return { x: lEyeX + relX, y: lEyeY + relY };
        }
        if (i >= 42 && i <= 47) {
          const relX = pt.x - 208;
          const relY = pt.y - 112;
          return { x: rEyeX + relX, y: rEyeY + relY };
        }
        return pt;
      });

      assert.equal(isValidHumanFaceLandmarks68(faceTilt70, 320, 320), true);
    });

    test("GEO-04: rejects face with eye level tilt at 71% IOD threshold (> 70% IOD limit)", () => {
      const targetIod = 96;
      const tiltFrac = 0.71;
      const eyeDx = Math.sqrt(1 - tiltFrac * tiltFrac) * targetIod; // sqrt(0.4959) * 96
      const eyeDy = tiltFrac * targetIod; // 68.16px

      // Construct landmarks where rEyeX - lEyeX = eyeDx and rEyeY - lEyeY = eyeDy
      // so overall hypot(dx, dy) === targetIod (96) and dy / iod === 0.71 (> 0.70 limit).
      const canonical = generateSyntheticFace68({ boundsWidth: 320, boundsHeight: 320, iod: targetIod });
      const eyeMidX = 160;
      const eyeMidY = 112;
      const lEyeX = eyeMidX - eyeDx / 2;
      const rEyeX = eyeMidX + eyeDx / 2;
      const lEyeY = eyeMidY - eyeDy / 2;
      const rEyeY = eyeMidY + eyeDy / 2;

      const faceTilt71 = canonical.map((pt, i) => {
        if (i >= 36 && i <= 41) {
          const relX = pt.x - 112;
          const relY = pt.y - 112;
          return { x: lEyeX + relX, y: lEyeY + relY };
        }
        if (i >= 42 && i <= 47) {
          const relX = pt.x - 208;
          const relY = pt.y - 112;
          return { x: rEyeX + relX, y: rEyeY + relY };
        }
        return pt;
      });

      assert.equal(isValidHumanFaceLandmarks68(faceTilt71, 320, 320), false);
    });
  });

  describe("GEO-05 & GEO-06: Eye-to-Mouth Ratio (EMD/IOD) Boundaries (0.44 vs 2.51)", () => {
    test("GEO-05: rejects face with EMD/IOD ratio at 0.44 (below 0.45 minimum)", () => {
      const iod = 96;
      const emd = 42.24; // 0.44 * 96 exactly
      const faceEmd044 = generateSyntheticFace68({
        boundsWidth: 320,
        boundsHeight: 320,
        iod,
        emd,
        noseYOffset: 20, // goldenRatio = 20 / 22.24 = 0.899 (valid)
        mouthYOffset: emd,
        chinYOffset: 240, // vertical order 112 < 132 < 154.24 < 240 (valid)
      });
      assert.equal(isValidHumanFaceLandmarks68(faceEmd044, 320, 320), false);
    });

    test("accepts face with EMD/IOD ratio at 0.45 (valid minimum boundary)", () => {
      const iod = 96;
      const emd = 43.2001; // 0.45 * 96 (with epsilon so emd / 96 >= 0.45 in IEEE 754)
      const faceEmd045 = generateSyntheticFace68({
        boundsWidth: 320,
        boundsHeight: 320,
        iod,
        emd,
        noseYOffset: 20,
        mouthYOffset: emd,
        chinYOffset: 240,
      });
      assert.equal(isValidHumanFaceLandmarks68(faceEmd045, 320, 320), true);
    });

    test("accepts face with EMD/IOD ratio at 2.50 (valid maximum boundary)", () => {
      const iod = 96;
      const emd = iod * 2.50; // 240.0px
      const faceEmd250 = generateSyntheticFace68({
        boundsWidth: 500,
        boundsHeight: 500,
        cy: 250,
        faceWidth: 250,
        faceHeight: 350,
        iod,
        emd,
        noseYOffset: 120, // goldenRatio = 120 / 120 = 1.0 (valid)
        mouthYOffset: emd,
        chinYOffset: 420,
      });
      assert.equal(isValidHumanFaceLandmarks68(faceEmd250, 500, 500), true);
    });

    test("GEO-06: rejects face with EMD/IOD ratio at 2.51 (above 2.50 maximum)", () => {
      const iod = 96;
      const emd = iod * 2.51; // 240.96px
      const faceEmd251 = generateSyntheticFace68({
        boundsWidth: 500,
        boundsHeight: 500,
        cy: 250,
        faceWidth: 250,
        faceHeight: 350,
        iod,
        emd,
        noseYOffset: 120, // goldenRatio = 120 / 120.96 = 0.992 (valid)
        mouthYOffset: emd,
        chinYOffset: 420,
      });
      assert.equal(isValidHumanFaceLandmarks68(faceEmd251, 500, 500), false);
    });
  });

  describe("GEO-07: Non-Face Pareidolia Rejection", () => {
    test("GEO-07: rejects house shape pareidolia (windows as eyes, door as nose/mouth)", () => {
      const house = generateHousePareidolia68(320, 320);
      assert.equal(isValidHumanFaceLandmarks68(house, 320, 320), false);
    });

    test("GEO-07: rejects collapsed cloud pareidolia (small 4px cluster)", () => {
      const cloudCollapsed = generateCollapsedCloud68(320, 320);
      assert.equal(isValidHumanFaceLandmarks68(cloudCollapsed, 320, 320), false);
    });

    test("GEO-07: rejects horizon cloud pareidolia (flat horizontal band across sunset)", () => {
      const cloudHorizon = generateHorizonCloud68(320, 320);
      assert.equal(isValidHumanFaceLandmarks68(cloudHorizon, 320, 320), false);
    });
  });
});
