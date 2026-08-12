import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractGeometryFeatures68,
  geomAffinity,
} from "./geometry.ts";
import { emptyFeatures } from "./math.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";
import type { FaceFeatures } from "./types.ts";
import type { CelebrityEmbedding } from "./embeddings.ts";

/** Helper to generate valid 68-point landmarks. */
function createSynthetic68(scale = 1.0, dx = 0, dy = 0): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 68; i++) {
    pts.push({ x: 100 + dx, y: 100 + dy });
  }
  const set = (idx: number, x: number, y: number) => {
    pts[idx] = { x: 100 + (x - 100) * scale + dx, y: 100 + (y - 100) * scale + dy };
  };

  // Key landmark indices used in extractGeometryFeatures68
  set(0, 40, 60);   // leftCheek
  set(16, 160, 60); // rightCheek
  set(8, 100, 170); // chin
  set(21, 72, 50);  // browMid left
  set(22, 128, 50); // browMid right
  set(4, 60, 140);  // jawLeft
  set(12, 140, 140); // jawRight
  set(27, 100, 56); // noseBridge
  set(30, 100, 100); // noseTip
  set(31, 84, 104); // noseLeft
  set(35, 116, 104); // noseRight
  set(36, 64, 66);  // leftEye outer
  set(39, 88, 66);  // leftEye inner
  set(37, 72, 62);  // leftEye top 1
  set(38, 80, 62);  // leftEye top 2
  set(40, 80, 70);  // leftEye bottom 1
  set(41, 72, 70);  // leftEye bottom 2
  set(42, 112, 66); // rightEye inner
  set(45, 136, 66); // rightEye outer
  set(43, 120, 62); // rightEye top 1
  set(44, 128, 62); // rightEye top 2
  set(46, 128, 70); // rightEye bottom 1
  set(47, 120, 70); // rightEye bottom 2
  set(17, 60, 50);  // leftBrow outer
  set(26, 140, 50); // rightBrow outer
  set(48, 76, 130); // mouthLeft
  set(54, 124, 130); // mouthRight
  set(51, 100, 124); // upperLip
  set(57, 100, 144); // lowerLip
  set(1, 44, 90);   // cheekbone left
  set(15, 156, 90); // cheekbone right

  return pts;
}

describe("M3 Empirical Stress Suite - Landmark Geometric Fusion", () => {

  describe("1. Scale & Translation Invariance Verification", () => {
    it("scaling landmarks by 0.5x, 2.0x, and 5.0x yields identical geometric feature ratios", () => {
      const baseLms = createSynthetic68(1.0, 0, 0);
      const fBase = extractGeometryFeatures68(baseLms);

      const scales = [0.5, 2.0, 5.0, 10.0];
      const offsets = [
        { dx: -50, dy: 100 },
        { dx: 300, dy: -200 },
        { dx: 0, dy: 0 },
      ];

      for (const s of scales) {
        for (const off of offsets) {
          const scaledLms = createSynthetic68(s, off.dx, off.dy);
          const fScaled = extractGeometryFeatures68(scaledLms);

          const keys = Object.keys(fBase) as Array<keyof FaceFeatures>;
          for (const key of keys) {
            const valBase = fBase[key];
            const valScaled = fScaled[key];
            if (typeof valBase === "number" && typeof valScaled === "number") {
              const diff = Math.abs(valBase - valScaled);
              assert.ok(
                diff < 1e-4,
                `Scale invariance failed for '${key}' at scale ${s}x (dx=${off.dx}, dy=${off.dy}): base=${valBase}, scaled=${valScaled}, diff=${diff}`,
              );
            }
          }
        }
      }
    });

    it("geomAffinity is scale-invariant when user and celeb landmark sets are scaled independently", () => {
      const lmsUserBase = createSynthetic68(1.0, 0, 0);
      const lmsCelebBase = createSynthetic68(1.2, 10, -10);

      const fUserBase = extractGeometryFeatures68(lmsUserBase);
      const fCelebBase = extractGeometryFeatures68(lmsCelebBase);
      const baseAffinity = geomAffinity(fUserBase, fCelebBase);

      const fUserScaled = extractGeometryFeatures68(createSynthetic68(0.5, -100, 50));
      const fCelebScaled = extractGeometryFeatures68(createSynthetic68(5.0, 200, 300));
      const scaledAffinity = geomAffinity(fUserScaled, fCelebScaled);

      assert.ok(
        Math.abs(baseAffinity - scaledAffinity) < 1e-4,
        `geomAffinity changed under independent scaling: base=${baseAffinity}, scaled=${scaledAffinity}`,
      );
    });
  });

  describe("2. Robustness to Empty, Null, Incomplete, and Malformed Landmark Inputs", () => {
    it("handles null, undefined, or empty arrays without throwing", () => {
      const fNull = extractGeometryFeatures68(null as any);
      const fUndef = extractGeometryFeatures68(undefined as any);
      const fEmpty = extractGeometryFeatures68([]);

      assert.deepEqual(fNull, emptyFeatures());
      assert.deepEqual(fUndef, emptyFeatures());
      assert.deepEqual(fEmpty, emptyFeatures());
    });

    it("handles incomplete landmark arrays (< 68 points: 1, 10, 67 points)", () => {
      const baseLms = createSynthetic68(1.0);
      for (const count of [1, 10, 34, 67]) {
        const partial = baseLms.slice(0, count);
        const f = extractGeometryFeatures68(partial);
        assert.deepEqual(
          f,
          emptyFeatures(),
          `Incomplete landmark array of length ${count} did not return emptyFeatures default`,
        );
      }
    });

    it("handles arrays with >= 68 points correctly", () => {
      const lms68 = createSynthetic68(1.0);
      const extraLms = [...lms68, ...Array.from({ length: 410 }, () => ({ x: 0.5, y: 0.5 }))];
      const f68 = extractGeometryFeatures68(lms68);
      const f478 = extractGeometryFeatures68(extraLms);
      assert.deepEqual(f68, f478, "Extra landmark points beyond 68 should not corrupt feature extraction");
    });

    it("evaluates behavior on negative landmark coordinates", () => {
      const lmsNeg = createSynthetic68(1.0, -1000, -2000);
      const fNeg = extractGeometryFeatures68(lmsNeg);
      for (const [k, v] of Object.entries(fNeg)) {
        assert.ok(
          Number.isFinite(v) && v >= 0 && v <= 1,
          `Extracted trait '${k}'=${v} is invalid for negative landmark coords`,
        );
      }
    });

    it("handles degenerate landmark points where all 68 points are at identical coordinates", () => {
      const degenerate: Array<{ x: number; y: number }> = Array.from({ length: 68 }, () => ({ x: 0.5, y: 0.5 }));
      const f = extractGeometryFeatures68(degenerate);
      for (const [k, v] of Object.entries(f)) {
        assert.ok(
          Number.isFinite(v) && v >= 0 && v <= 1,
          `Trait '${k}'=${v} failed range check on degenerate input`,
        );
      }
    });
  });

  describe("3. Candidate Tie-Breaking Under Equal or Close Descriptor Distances (|d1 - d2| <= 0.02)", () => {
    const userFeat = extractGeometryFeatures68(createSynthetic68(1.0));
    const descBase = new Float32Array(128).fill(0.1);

    const userQuery: UserFaceQuery = {
      descriptor: descBase,
      age: 30,
      gender: "male",
      genderProbability: 0.9,
      features: userFeat,
    };

    it("breaks EXACT descriptor distance ties (distA === distB) using landmark geometric affinity", () => {
      const candA: CelebrityEmbedding = {
        id: "cand-high-geom",
        name: "Cand High Geom",
        path: "/a.jpg",
        descriptor: Array.from(descBase),
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: userFeat, // exact geometric match -> geomAffinity ~ 1.0
      };

      const candB: CelebrityEmbedding = {
        id: "cand-low-geom",
        name: "Cand Low Geom",
        path: "/b.jpg",
        descriptor: Array.from(descBase),
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: {
          ...emptyFeatures(),
          jawWidth: 0.1,
          faceAspect: 0.1,
          eyeSpacing: 0.1,
          noseLength: 0.1,
        },
      };

      const matches = rankByDescriptor(userQuery, [candB, candA], 2);
      assert.equal(matches[0]!.celebrityId, "cand-high-geom", "Exact tie must rank high geometric affinity candidate first");
    });

    it("breaks CLOSE descriptor distance ties (|d1 - d2| <= 0.015 at dist ~ 0.35) using landmark geometric affinity", () => {
      // Set baseline descriptors to have raw distance around 0.35 (typical FaceNet candidate distance)
      const d1 = new Float32Array(128).fill(0.1);
      const d2 = new Float32Array(128).fill(0.1);
      d1[0] = 0.45; // Raw dist ~ 0.350
      d2[0] = 0.435; // Raw dist ~ 0.335 (delta = 0.015 <= 0.02)

      const query: UserFaceQuery = {
        descriptor: d1,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
        features: userFeat,
      };

      const candA: CelebrityEmbedding = {
        id: "cand-a-high-geom",
        name: "Cand A",
        path: "/a.jpg",
        descriptor: Array.from(d1), // raw distance ~ 0.350
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: userFeat, // geomAffinity = 1.0 -> denominator = 1.00 -> adjusted = 0.350
      };

      const candB: CelebrityEmbedding = {
        id: "cand-b-low-geom",
        name: "Cand B",
        path: "/b.jpg",
        descriptor: Array.from(d2), // raw distance ~ 0.335 (closer raw descriptor!)
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: {
          ...emptyFeatures(),
          jawWidth: 0.05,
          faceAspect: 0.05,
          eyeSpacing: 0.05,
        }, // low geomAffinity ~ 0.47 -> denominator = 0.947 -> adjusted = 0.3537
      };

      const matches = rankByDescriptor(query, [candB, candA], 2);
      assert.equal(
        matches[0]!.celebrityId,
        "cand-a-high-geom",
        "Candidate A with high geometric affinity should rank #1 over Candidate B despite Candidate B having slightly lower raw descriptor distance",
      );
    });

    it("preserves strong descriptor separation when descriptor distance difference > 0.05", () => {
      const descFar = new Float32Array(128).fill(0.1);
      descFar[0] = 0.80; // Significantly higher descriptor distance

      const candA: CelebrityEmbedding = {
        id: "cand-good-descriptor",
        name: "Cand Good Desc",
        path: "/a.jpg",
        descriptor: Array.from(descBase),
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: emptyFeatures(), // low geom match
      };

      const candB: CelebrityEmbedding = {
        id: "cand-poor-descriptor-good-geom",
        name: "Cand Poor Desc Good Geom",
        path: "/b.jpg",
        descriptor: Array.from(descFar),
        age: 30,
        gender: "male",
        genderProb: 0.9,
        features: userFeat, // perfect geom match
      };

      const matches = rankByDescriptor(userQuery, [candB, candA], 2);
      assert.equal(
        matches[0]!.celebrityId,
        "cand-good-descriptor",
        "Strong descriptor distance separation (> 0.05) must override landmark geometric affinity",
      );
    });

    it("handles tie-breaking safely when user or candidate features are missing/undefined", () => {
      const queryNoFeat: UserFaceQuery = {
        descriptor: descBase,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
        features: undefined,
      };

      const cand1: CelebrityEmbedding = {
        id: "c1",
        name: "C1",
        path: "/1.jpg",
        descriptor: Array.from(descBase),
        age: 30,
        gender: "male",
        genderProb: 0.9,
      };

      const cand2: CelebrityEmbedding = {
        id: "c2",
        name: "C2",
        path: "/2.jpg",
        descriptor: Array.from(descBase),
        age: 30,
        gender: "male",
        genderProb: 0.9,
      };

      const matches = rankByDescriptor(queryNoFeat, [cand1, cand2], 2);
      assert.equal(matches.length, 2);
      assert.ok(Number.isFinite(matches[0]!.matchPercent));
      assert.ok(Number.isFinite(matches[1]!.matchPercent));
    });
  });
});
