import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isValidHumanFaceLandmarks68 } from "./geometry";
import {
  generateSyntheticFace68,
  generateHousePareidolia68,
  generateCollapsedCloud68,
  generateHorizonCloud68,
} from "./phase2-morphology-boundary.test";

describe("Phase 2 Empirical Challenger Stress Harness (GEO-01 to GEO-07)", () => {

  describe("1. Boundary Step-Function Sweep & Continuity Verification", () => {
    test("GEO-02 / GEO-03: IOD boundary step function (3.8% to 4.2% in 0.01% steps)", () => {
      const bw = 320;
      const bh = 320;
      const minIod = bw * 0.04; // 12.8px

      for (let percent = 3.80; percent <= 4.20; percent += 0.01) {
        const iodFrac = Math.round(percent * 1000) / 100000;
        const iod = bw * iodFrac;
        const face = generateSyntheticFace68({
          boundsWidth: bw,
          boundsHeight: bh,
          iod,
          emd: iod, // keep emdRatio = 1.0
          noseYOffset: iod * 0.5,
          mouthYOffset: iod,
        });

        const result = isValidHumanFaceLandmarks68(face, bw, bh);
        const expected = iod >= minIod;
        assert.equal(
          result,
          expected,
          `IOD sweep at ${percent.toFixed(2)}% (${iod.toFixed(4)}px vs min ${minIod}px) expected ${expected} but got ${result}`
        );
      }
    });

    test("GEO-04: Eye tilt boundary step function (68% to 73% IOD in 0.2% steps)", () => {
      const targetIod = 96;
      for (let p = 68.0; p <= 73.0; p += 0.2) {
        const tiltFrac = Math.round(p * 10) / 1000;
        const eyeDx = Math.sqrt(Math.max(0, 1 - tiltFrac * tiltFrac)) * targetIod;
        const eyeDy = tiltFrac * targetIod;

        const canonical = generateSyntheticFace68({ boundsWidth: 320, boundsHeight: 320, iod: targetIod });
        const eyeMidX = 160;
        const eyeMidY = 112;
        const lEyeX = eyeMidX - eyeDx / 2;
        const rEyeX = eyeMidX + eyeDx / 2;
        const lEyeY = eyeMidY - eyeDy / 2;
        const rEyeY = eyeMidY + eyeDy / 2;

        const tiltedFace = canonical.map((pt, i) => {
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

        const result = isValidHumanFaceLandmarks68(tiltedFace, 320, 320);
        const expected = tiltFrac <= 0.70 + 1e-9;
        assert.equal(
          result,
          expected,
          `Eye tilt sweep at ${p.toFixed(1)}% IOD (dy=${eyeDy.toFixed(4)}px) expected ${expected} but got ${result}`
        );
      }
    });

    test("GEO-05 / GEO-06: EMD/IOD lower boundary sweep (0.42 to 0.48 in 0.005 steps)", () => {
      const iod = 96;
      for (let r = 0.42; r <= 0.48; r += 0.005) {
        const ratio = Math.round(r * 1000) / 1000;
        // At exact ratio=0.45, addition & subtraction in double precision (112 + 43.2 - 112)
        // yields 43.19999999999999, so we add 1e-4 epsilon for target ratio >= 0.45.
        const eps = ratio >= 0.45 ? 1e-4 : 0;
        const emd = ratio * iod + eps;
        const face = generateSyntheticFace68({
          boundsWidth: 320,
          boundsHeight: 320,
          iod,
          emd,
          noseYOffset: 20,
          mouthYOffset: emd,
          chinYOffset: 240,
        });

        const result = isValidHumanFaceLandmarks68(face, 320, 320);
        const expected = ratio >= 0.45;
        assert.equal(
          result,
          expected,
          `EMD/IOD ratio sweep at ratio=${ratio} expected ${expected} but got ${result}`
        );
      }
    });

    test("GEO-05 / GEO-06: EMD/IOD upper boundary sweep (2.47 to 2.53 in 0.005 steps)", () => {
      const iod = 96;
      for (let r = 2.47; r <= 2.53; r += 0.005) {
        const ratio = Math.round(r * 1000) / 1000;
        const emd = ratio * iod;
        const face = generateSyntheticFace68({
          boundsWidth: 500,
          boundsHeight: 500,
          cy: 250,
          faceWidth: 250,
          faceHeight: 350,
          iod,
          emd,
          noseYOffset: 120,
          mouthYOffset: emd,
          chinYOffset: 420,
        });

        const result = isValidHumanFaceLandmarks68(face, 500, 500);
        const actualRatio = emd / iod;
        const expected = actualRatio <= 2.50 + 1e-12;
        assert.equal(
          result,
          expected,
          `EMD/IOD upper ratio sweep at ratio=${ratio} (actual=${actualRatio.toFixed(6)}) expected ${expected} but got ${result}`
        );
      }
    });
  });

  describe("2. Fuzzing & Oracle Invariant Verification (5,000 Random Samples)", () => {
    test("Empirically asserts invariant properties across 5,000 randomized synthetic landmark sets", () => {
      let acceptedCount = 0;
      let rejectedCount = 0;

      for (let k = 0; k < 5000; k++) {
        // Randomize scale, aspect ratio, tilt, vertical offsets
        const bw = 320;
        const bh = 320;
        const iod = 10 + Math.random() * 150;
        const tilt = (Math.random() - 0.5) * 100;
        const emd = 10 + Math.random() * 300;
        const noseYOffset = 5 + Math.random() * 100;
        const inverted = Math.random() < 0.2;

        const face = generateSyntheticFace68({
          boundsWidth: bw,
          boundsHeight: bh,
          iod,
          eyeTilt: tilt,
          emd,
          noseYOffset,
          inverted,
        });

        const isValid = isValidHumanFaceLandmarks68(face, bw, bh);

        // Oracle checks: If isValid is true, ALL 9 invariants MUST hold
        if (isValid) {
          acceptedCount++;

          // Check 1: Inverted / vertical ordering
          const lEyeY = (face[36].y + face[39].y) / 2;
          const rEyeY = (face[42].y + face[45].y) / 2;
          const eyeMidY = (lEyeY + rEyeY) / 2;
          const noseY = face[30].y;
          const mouthY = (face[48].y + face[54].y) / 2;
          const chinY = face[8].y;
          assert.ok(eyeMidY < noseY, "Oracle Violation: eyeMidY < noseY");
          assert.ok(noseY < mouthY, "Oracle Violation: noseY < mouthY");
          assert.ok(mouthY < chinY, "Oracle Violation: mouthY < chinY");

          // Check 2: Min IOD
          const lEyeX = (face[36].x + face[39].x) / 2;
          const rEyeX = (face[42].x + face[45].x) / 2;
          const calculatedIod = Math.hypot(rEyeX - lEyeX, rEyeY - lEyeY);
          const minIod = Math.min(bw, bh) * 0.04;
          assert.ok(calculatedIod >= minIod - 1e-9, "Oracle Violation: calculatedIod >= minIod");

          // Check 3: Tilt
          assert.ok(Math.abs(lEyeY - rEyeY) <= calculatedIod * 0.7 + 1e-9, "Oracle Violation: eye tilt <= 0.7 * IOD");

          // Check 4: EMD Ratio
          const eyeMidX = (lEyeX + rEyeX) / 2;
          const mouthX = (face[48].x + face[54].x) / 2;
          const calculatedEmd = Math.hypot(mouthX - eyeMidX, mouthY - eyeMidY);
          const emdRatio = calculatedEmd / calculatedIod;
          assert.ok(emdRatio >= 0.45 - 1e-9, "Oracle Violation: emdRatio >= 0.45");
          assert.ok(emdRatio <= 2.50 + 1e-9, "Oracle Violation: emdRatio <= 2.50");
        } else {
          rejectedCount++;
        }
      }

      assert.ok(acceptedCount > 0, "Fuzzer should accept valid faces");
      assert.ok(rejectedCount > 0, "Fuzzer should reject invalid faces");
    });
  });

  describe("3. Edge-Case & Malformed Input Robustness Harness", () => {
    test("rejects empty, short, or invalid landmark arrays without throwing", () => {
      // @ts-expect-error testing null
      assert.equal(isValidHumanFaceLandmarks68(null), false);
      // @ts-expect-error testing undefined
      assert.equal(isValidHumanFaceLandmarks68(undefined), false);
      assert.equal(isValidHumanFaceLandmarks68([]), false);
      assert.equal(isValidHumanFaceLandmarks68(new Array(67).fill({ x: 100, y: 100 })), false);
    });

    test("rejects degenerate arrays (all points at same coordinate)", () => {
      const degenerate = new Array(68).fill({ x: 160, y: 160 });
      assert.equal(isValidHumanFaceLandmarks68(degenerate, 320, 320), false);
    });

    test("rejects pareidolia shapes (house, collapsed cloud, horizon cloud)", () => {
      assert.equal(isValidHumanFaceLandmarks68(generateHousePareidolia68(320, 320), 320, 320), false);
      assert.equal(isValidHumanFaceLandmarks68(generateCollapsedCloud68(320, 320), 320, 320), false);
      assert.equal(isValidHumanFaceLandmarks68(generateHorizonCloud68(320, 320), 320, 320), false);
    });
  });
});
