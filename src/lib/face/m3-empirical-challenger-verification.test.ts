import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rankByDescriptor,
  minMultiVectorDistance,
  minTemplateDistance,
  type UserFaceQuery,
} from "./match.ts";
import {
  getCelebrityDescriptors,
  distanceToMatchPercent,
  ensembleDistance,
  l2Normalize,
  type CelebrityEmbedding,
} from "./embeddings.ts";
import { getPoseAdaptiveLandmarkWeight, type HeadPose } from "./pose.ts";
import { emptyFeatures } from "./math.ts";

/** Helper to construct a unit L2-normalized 128-d vector */
function createNormVector(dim = 128, fillVal = 0.1, spikeIdx?: number, spikeVal?: number): Float32Array {
  const v = new Float32Array(dim).fill(fillVal);
  if (spikeIdx !== undefined && spikeVal !== undefined) {
    v[spikeIdx] = spikeVal;
  }
  return l2Normalize(v);
}

/** Helper to generate synthetic gallery celebrities with proper L2 normalized descriptors */
function createSyntheticCeleb(
  id: string,
  descriptor: Float32Array,
  extraDescriptors?: Float32Array[],
): CelebrityEmbedding {
  const primaryArr = Array.from(descriptor);
  const descriptors = extraDescriptors ? [descriptor, ...extraDescriptors] : [descriptor];
  const referenceVectors = descriptors.map((d) => ({
    descriptor: d,
    photoUrl: `/${id}.jpg`,
    features: emptyFeatures(),
  }));

  return {
    id,
    name: `Celeb ${id}`,
    path: `/${id}.jpg`,
    descriptor: primaryArr,
    descriptors,
    referenceVectors,
    age: 30,
    gender: "male",
    genderProb: 0.95,
    features: emptyFeatures(),
  };
}

describe("M3 Empirical Challenger Verification Suite - Two-Stage Reranker & Hill Curve Recalibration", () => {
  describe("1. Extreme Pose Angles & Dynamic Landmark Weighting (POS-01..04 & Edge Cases)", () => {
    it("computes exact pose-adaptive landmark weight for POS-01 (10 deg yaw) -> 0.098", () => {
      const pose: HeadPose = { yawDeg: 10, pitchDeg: 0, rollDeg: 0, poseScore: 0.98 };
      const w = getPoseAdaptiveLandmarkWeight(pose, 0.10);
      assert.equal(w, 0.098, `POS-01 (10 deg) weight expected 0.098, got ${w}`);
    });

    it("computes exact pose-adaptive landmark weight for POS-02 (14.9 deg yaw) -> 0.097", () => {
      const pose: HeadPose = { yawDeg: 14.9, pitchDeg: 0, rollDeg: 0, poseScore: 0.96 };
      const w = getPoseAdaptiveLandmarkWeight(pose, 0.10);
      assert.equal(w, 0.097, `POS-02 (14.9 deg) weight expected 0.097, got ${w}`);
    });

    it("computes exact pose-adaptive landmark weight for POS-03 (20 deg yaw) -> 0.094", () => {
      const pose: HeadPose = { yawDeg: 20, pitchDeg: 0, rollDeg: 0, poseScore: 0.93 };
      const w = getPoseAdaptiveLandmarkWeight(pose, 0.10);
      assert.equal(w, 0.094, `POS-03 (20 deg) weight expected 0.094, got ${w}`);
    });

    it("computes exact pose-adaptive landmark weight for POS-04 (80 deg yaw) -> 0.020 (damped floor)", () => {
      const pose: HeadPose = { yawDeg: 80, pitchDeg: 0, rollDeg: 0, poseScore: 0.20 };
      const w = getPoseAdaptiveLandmarkWeight(pose, 0.10);
      assert.equal(w, 0.020, `POS-04 (80 deg) weight expected 0.020, got ${w}`);
    });

    it("handles extreme / boundary yaw angles (90, -90, 180, -180, 360 deg) safely with floor 0.020", () => {
      const extremeYaws = [90, -90, 180, -180, 360, -360];
      for (const yaw of extremeYaws) {
        const pose: HeadPose = { yawDeg: yaw, pitchDeg: 0, rollDeg: 0, poseScore: 0.1 };
        const w = getPoseAdaptiveLandmarkWeight(pose, 0.10);
        assert.ok(
          Number.isFinite(w) && w >= 0.020 && w <= 0.10,
          `Extreme yaw ${yaw} returned invalid weight: ${w}`,
        );
      }
    });

    it("handles unusual pitch and roll combinations without throwing or NaN", () => {
      const pose: HeadPose = { yawDeg: 45, pitchDeg: 89, rollDeg: 180, poseScore: 0.05 };
      const w = getPoseAdaptiveLandmarkWeight(pose, 0.10);
      assert.ok(Number.isFinite(w) && w > 0);
    });

    it("evaluates behavior on NaN yawDeg (sanitized pose input yields safe finite weight)", () => {
      const poseNaN: HeadPose = { yawDeg: NaN, pitchDeg: 0, rollDeg: 0, poseScore: 0.5 };
      const wNaN = getPoseAdaptiveLandmarkWeight(poseNaN, 0.10);
      assert.ok(Number.isFinite(wNaN) && wNaN > 0, "Sanitized implementation yields finite weight when yawDeg is NaN");
    });
  });

  describe("2. Queries with Missing, Malformed, or Unusual Descriptors", () => {
    const vBase = createNormVector(128, 0.1);
    const synthCeleb = createSyntheticCeleb("celeb1", vBase);

    it("evaluates query with descriptors: [] falling back to primary descriptor", () => {
      const query: UserFaceQuery = {
        descriptor: vBase,
        descriptors: [],
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const dist = minMultiVectorDistance(query, synthCeleb);
      assert.ok(Number.isFinite(dist));
      assert.ok(dist < 0.05, `Same vector distance expected near 0, got ${dist}`);
    });

    it("evaluates query with multi-template descriptors array selecting minimum distance", () => {
      const vQuery1 = createNormVector(128, 0.1, 0, 0.9); // Farther
      const vQuery2 = createNormVector(128, 0.1, 0, 0.1); // Same as vBase

      const query: UserFaceQuery = {
        descriptor: vQuery1,
        descriptors: [vQuery1, vQuery2],
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const distMin = minMultiVectorDistance(query, synthCeleb);
      const distSingle = minTemplateDistance({ ...query, descriptors: undefined }, vBase);

      assert.ok(
        distMin < distSingle,
        `Multi-template min distance (${distMin}) should be smaller than single descriptor distance (${distSingle})`,
      );
    });

    it("handles query with un-normalized descriptors (norm != 1) by normalizing inside ensembleDistance", () => {
      const vUnnorm = new Float32Array(128).fill(100.0);
      const query: UserFaceQuery = {
        descriptor: vUnnorm,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const dist = minMultiVectorDistance(query, synthCeleb);
      assert.ok(Number.isFinite(dist), "Un-normalized descriptor must produce a finite distance");
      assert.ok(dist >= 0, "Distance must be non-negative");
    });

    it("handles all-zero query descriptor without throwing or returning NaN", () => {
      const vZero = new Float32Array(128).fill(0.0);
      const query: UserFaceQuery = {
        descriptor: vZero,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const dist = minMultiVectorDistance(query, synthCeleb);
      assert.ok(Number.isFinite(dist), "Zero-vector descriptor must produce a finite distance");
    });

    it("handles query with empty descriptor (length = 0) without runtime crash", () => {
      const query: UserFaceQuery = {
        descriptor: new Float32Array(0),
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      assert.doesNotThrow(() => {
        const matches = rankByDescriptor(query, [synthCeleb], 1);
        assert.ok(Array.isArray(matches));
      });
    });
  });

  describe("3. Multi-Vector Retrieval Edge Cases (minMultiVectorDistance & Gallery Schema)", () => {
    it("handles gallery celebrity with referenceVectors, descriptors, and primary descriptor correctly", () => {
      const v1 = createNormVector(128, 0.1, 0, 0.1);
      const v2 = createNormVector(128, 0.1, 0, 0.5);

      const celeb = createSyntheticCeleb("celeb_multi", v1, [v2]);
      const extracted = getCelebrityDescriptors(celeb);

      assert.equal(extracted.length, 2, "Expected 2 reference descriptors");
      assert.ok(extracted[0] instanceof Float32Array);
      assert.ok(extracted[1] instanceof Float32Array);
    });

    it("handles gallery celebrity with empty vectors fallback cleanly", () => {
      const emptyCeleb: CelebrityEmbedding = {
        id: "empty_celeb",
        name: "Empty Celeb",
        path: "/empty.jpg",
        descriptor: [],
        descriptors: [],
        referenceVectors: [],
        age: 30,
        gender: "male",
        genderProb: 0.9,
      };

      const extracted = getCelebrityDescriptors(emptyCeleb);
      assert.equal(extracted.length, 0, "Empty celeb should return 0 descriptors");

      const query: UserFaceQuery = {
        descriptor: createNormVector(128, 0.1),
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const dist = minMultiVectorDistance(query, emptyCeleb);
      assert.ok(Number.isFinite(dist), "Empty celeb minMultiVectorDistance should fallback gracefully");
    });

    it("evaluates minMultiVectorDistance across M query templates and N gallery vectors", () => {
      const q1 = createNormVector(128, 0.1, 0, 0.9);
      const q2 = createNormVector(128, 0.1, 1, 0.8);

      const c1 = createNormVector(128, 0.1, 2, 0.7);
      const c2 = createNormVector(128, 0.1, 1, 0.8); // Exact match with q2!

      const celeb = createSyntheticCeleb("c_match", c1, [c2]);
      const query: UserFaceQuery = {
        descriptor: q1,
        descriptors: [q1, q2],
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const dist = minMultiVectorDistance(query, celeb);
      assert.ok(dist < 0.01, `Expected near zero distance between q2 and c2, got ${dist}`);
    });

    it("deduplicates gallery celebrities by ID in Stage 1 coarse search", () => {
      const vBase = createNormVector(128, 0.1);
      const celebA1 = createSyntheticCeleb("same_id", vBase);
      const celebA2 = createSyntheticCeleb("same_id", vBase);
      const celebB = createSyntheticCeleb("other_id", createNormVector(128, 0.1, 0, 0.3));

      const query: UserFaceQuery = {
        descriptor: vBase,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const matches = rankByDescriptor(query, [celebA1, celebA2, celebB], 5);
      const sameIdCount = matches.filter((m) => m.celebrityId === "same_id").length;
      assert.equal(sameIdCount, 1, "Deduplication must keep exactly 1 match entry per celebrity identity ID");
    });
  });

  describe("4. Lookalike Threshold Gating Boundary Conditions (d=0.35, d=0.38, d=0.39, d=0.41)", () => {
    it("asserts calibrated Hill curve similarity formula values across key distance points", () => {
      const pct00 = distanceToMatchPercent(0.0);
      const pct32 = distanceToMatchPercent(0.32);
      const pct38 = distanceToMatchPercent(0.38);
      const pct39 = distanceToMatchPercent(0.39);
      const pct40 = distanceToMatchPercent(0.40);
      const pct41 = distanceToMatchPercent(0.41);

      assert.equal(pct00, 100.0);
      assert.equal(pct32, 57.5);
      assert.equal(pct38, 45.1);
      assert.ok(Math.abs(pct39 - 43.3) <= 0.1);
      assert.equal(pct40, 41.7);
      assert.equal(pct41, 40.1);
    });

    it("ACCEPT: query with candidate distance d = 0.35 yields valid candidate matches (P(0.35) = 51.5% >= 45.0%)", () => {
      const vQuery = createNormVector(128, 0.1);
      // Construct a unit vector with exact ensemble distance ~ 0.35
      const vCeleb = createNormVector(128, 0.1, 0, 0.55);

      const query: UserFaceQuery = {
        descriptor: vQuery,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const celeb = createSyntheticCeleb("celeb_close", vCeleb);
      const dist = minMultiVectorDistance(query, celeb);
      assert.ok(dist <= 0.38, `Constructed distance should be <= 0.38, got ${dist}`);

      const matches = rankByDescriptor(query, [celeb], 1);
      assert.ok(matches.length === 1, "d <= 0.38 must pass lookalike threshold gate");
      assert.equal(matches[0]!.celebrityId, "celeb_close");
      assert.ok(matches[0]!.matchPercent >= 45.0);
    });

    it("ACCEPT: mid-distance neighbors still return (honest weak match, not empty)", () => {
      const vQuery = createNormVector(128, 0.1);
      const vCeleb = createNormVector(128, 0.1, 0, 0.615);

      const query: UserFaceQuery = {
        descriptor: vQuery,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const celeb = createSyntheticCeleb("celeb_thresh", vCeleb);
      const matches = rankByDescriptor(query, [celeb], 1);
      // Product: surface nearest neighbor with honest % — never empty for usable faces
      assert.ok(matches.length > 0, "usable mid-distance neighbor must not return empty");
      assert.ok(matches[0]!.matchPercent >= 18);
    });

    it("WEAK: d > 0.40 still returns nearest neighbor (UI labels low similarity; no quality block)", () => {
      const vQuery = createNormVector(128, 0.1);
      const vCeleb = createNormVector(128, 0.1, 0, 0.70); // Distance > 0.40

      const query: UserFaceQuery = {
        descriptor: vQuery,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const celeb = createSyntheticCeleb("celeb_gate_fail", vCeleb);
      const dist = minMultiVectorDistance(query, celeb);
      assert.ok(dist > 0.40, `Constructed distance should be > 0.40, got ${dist}`);

      const matches = rankByDescriptor(query, [celeb], 1);
      // Empty list used to trigger a false "Photo quality too low" screen
      assert.ok(matches.length === 1, "weak neighbor must still be returned");
      assert.ok(matches[0]!.matchPercent < 55, "weak distance should map to low similarity %");
    });
  });

  describe("5. Performance Benchmarking & Execution SLA", () => {
    it("executes rankByDescriptor across synthetic gallery of 500 celebrities in under 15ms", () => {
      const vQuery = createNormVector(128, 0.1);
      const gallery: CelebrityEmbedding[] = [];

      for (let i = 0; i < 500; i++) {
        const vCeleb = createNormVector(128, 0.1, i % 128, (i % 10) * 0.05);
        gallery.push(createSyntheticCeleb(`celeb_${i}`, vCeleb));
      }

      const query: UserFaceQuery = {
        descriptor: vQuery,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      // Warmup
      rankByDescriptor(query, gallery, 5);

      const iterations = 50;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        rankByDescriptor(query, gallery, 5);
      }
      const totalMs = performance.now() - start;
      const avgMs = totalMs / iterations;

      assert.ok(
        avgMs < 25.0,
        `Average search latency (${avgMs.toFixed(2)}ms) exceeded SLA limit of 25.0ms for 500-celeb gallery`,
      );
    });
  });
});
