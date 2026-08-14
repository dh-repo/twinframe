import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rankByDescriptor,
  minMultiVectorDistance,
  type UserFaceQuery,
} from "./match.ts";
import {
  getCelebrityDescriptors,
  fastTopologicalManifoldDistance,
  getBestMatchingReferenceVector,
  l2Normalize,
  mergeExtraReferences,
  combinedDescriptorDistance,
  distanceToMatchPercent,
  type CelebrityEmbedding,
  type ReferenceVector,
  type ExtraReference,
} from "./embeddings.ts";
import { emptyFeatures } from "./math.ts";
import type { FaceViewType, HeadPoseOrientation } from "./types.ts";

/** Helper to generate L2-normalized synthetic 128-d vector */
function createVector(dim = 128, fillVal = 0.1, spikeIdx?: number, spikeVal?: number): Float32Array {
  const v = new Float32Array(dim).fill(fillVal);
  if (spikeIdx !== undefined && spikeVal !== undefined) {
    v[spikeIdx] = spikeVal;
  }
  return l2Normalize(v);
}

/** Helper to create a synthetic multi-vector celebrity entry */
function createMultiVectorCeleb(
  id: string,
  views: Array<{ viewType: FaceViewType; pose: HeadPoseOrientation; descriptor: Float32Array }>,
): CelebrityEmbedding {
  const referenceVectors: ReferenceVector[] = views.map((v) => ({
    descriptor: v.descriptor,
    viewType: v.viewType,
    pose: v.pose,
    photoUrl: `/${id}_${v.viewType}.jpg`,
    features: emptyFeatures(),
  }));

  const descriptors = referenceVectors.map((r) => r.descriptor);
  const primaryArr = Array.from(descriptors[0]!);

  return {
    id,
    name: `Celeb ${id}`,
    path: `/${id}.jpg`,
    descriptor: primaryArr,
    descriptors,
    referenceVectors,
    age: 32,
    gender: "female",
    genderProb: 0.95,
    features: emptyFeatures(),
  };
}

describe("Empirical Challenger M3_2 — Milestone M3_MultiVector Stress & Edge Suite", () => {
  describe("1. SLA Latency Benchmark (< 20ms for 1,000 Celebs / 3,000–5,000 Vectors)", () => {
    it("ranks multi-template TTA query against 1,000 celebs with 3-5 reference vectors each in < 20ms", () => {
      const vPrimary = createVector(128, 0.1, 0, 0.2);
      const vFlip = createVector(128, 0.1, 1, 0.22);
      const vTight = createVector(128, 0.1, 2, 0.18);

      const gallery: CelebrityEmbedding[] = [];
      for (let i = 0; i < 1000; i++) {
        const numViews = (i % 3) + 3; // 3, 4, or 5 views
        const views: Array<{ viewType: FaceViewType; pose: HeadPoseOrientation; descriptor: Float32Array }> = [];
        for (let k = 0; k < numViews; k++) {
          const v = createVector(128, 0.1, (i + k) % 128, (i % 10) * 0.05 + k * 0.01);
          const viewType: FaceViewType = k === 0 ? "frontal" : k === 1 ? "expression" : k === 2 ? "profile_left" : "profile_right";
          views.push({
            viewType,
            pose: { yawDeg: (k - 1) * 15, pitchDeg: 0, rollDeg: 0 },
            descriptor: v,
          });
        }
        gallery.push(createMultiVectorCeleb(`celeb_scale_${i}`, views));
      }

      const query: UserFaceQuery = {
        descriptor: vPrimary,
        descriptors: [vPrimary, vFlip, vTight], // Multi-template TTA (3 micro-crops)
        age: 32,
        gender: "female",
        genderProbability: 0.95,
        headPose: { yawDeg: 5, pitchDeg: 2, rollDeg: 0, poseScore: 0.95 },
      };

      // Warmup pass
      rankByDescriptor(query, gallery, 5);

      const iterations = 30;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const matches = rankByDescriptor(query, gallery, 5);
        assert.equal(matches.length, 5);
      }
      const totalMs = performance.now() - start;
      const avgMs = totalMs / iterations;

      assert.ok(
        avgMs < 20.0,
        `SLA Latency requirement violated: 1,000 multi-vector celeb search took ${avgMs.toFixed(2)}ms (must be < 20.0ms)`,
      );
    });
  });

  describe("2. Memory & Tensor Allocation Pressure", () => {
    it("executes 500 query matches continuously with zero memory leak / stable heap allocation", () => {
      const vQuery = createVector(128, 0.1);
      const gallery: CelebrityEmbedding[] = [];
      for (let i = 0; i < 200; i++) {
        gallery.push(createMultiVectorCeleb(`celeb_mem_${i}`, [
          { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: createVector(128, 0.1, i % 128, 0.3) },
          { viewType: "expression", pose: { yawDeg: 2, pitchDeg: 0, rollDeg: 0 }, descriptor: createVector(128, 0.1, (i + 1) % 128, 0.35) },
          { viewType: "profile_left", pose: { yawDeg: -25, pitchDeg: 0, rollDeg: 0 }, descriptor: createVector(128, 0.1, (i + 2) % 128, 0.4) },
        ]));
      }

      const query: UserFaceQuery = {
        descriptor: vQuery,
        descriptors: [vQuery, createVector(128, 0.1, 5, 0.15)],
        age: 30,
        gender: "female",
        genderProbability: 0.9,
      };

      const gcFn = (globalThis as any).gc || (global as any).gc;
      if (gcFn) gcFn();
      const initialMem = process.memoryUsage().heapUsed;

      for (let i = 0; i < 500; i++) {
        const matches = rankByDescriptor(query, gallery, 5);
        assert.ok(matches.length <= 5);
      }

      if (gcFn) gcFn();
      const finalMem = process.memoryUsage().heapUsed;
      const heapDiffMB = (finalMem - initialMem) / (1024 * 1024);

      // Verify no retained heap memory leak (< 15 MB without explicit GC, or < 2 MB with GC)
      const maxAllowedMB = gcFn ? 2.0 : 15.0;
      assert.ok(
        heapDiffMB < maxAllowedMB,
        `Memory pressure check failed: heap grew by ${heapDiffMB.toFixed(2)} MB over 500 iterations (allowed < ${maxAllowedMB} MB)`,
      );
    });
  });

  describe("3. Pathological Edge Cases (NaN, Infinity, Empty Vectors, Clone Dedupe)", () => {
    it("handles query or gallery descriptors containing NaN or Infinity gracefully", () => {
      const nanVec = new Float32Array(128).fill(NaN);
      const infVec = new Float32Array(128).fill(Infinity);
      const normalVec = createVector(128, 0.1);

      const NaNQuery: UserFaceQuery = {
        descriptor: nanVec,
        descriptors: [nanVec, infVec],
        age: 30,
        gender: "female",
        genderProbability: 0.9,
      };

      const celebWithNaN: CelebrityEmbedding = {
        id: "celeb_nan",
        name: "Celeb NaN",
        path: "/nan.jpg",
        descriptor: Array.from(nanVec),
        descriptors: [nanVec, infVec],
        referenceVectors: [
          { descriptor: nanVec, photoUrl: "/nan.jpg" },
          { descriptor: infVec, photoUrl: "/inf.jpg" },
        ],
        age: 30,
        gender: "female",
        genderProb: 0.9,
      };

      const celebNormal: CelebrityEmbedding = {
        id: "celeb_normal",
        name: "Celeb Normal",
        path: "/normal.jpg",
        descriptor: Array.from(normalVec),
        descriptors: [normalVec],
        referenceVectors: [{ descriptor: normalVec, photoUrl: "/normal.jpg" }],
        age: 30,
        gender: "female",
        genderProb: 0.9,
      };

      // 1. NaN Query against normal gallery
      const matchesNaNQuery = rankByDescriptor(NaNQuery, [celebNormal], 5);
      assert.ok(Array.isArray(matchesNaNQuery), "NaN query should return array without throwing");

      // 2. Normal query against gallery containing NaN/Infinity celeb
      const normalQuery: UserFaceQuery = {
        descriptor: normalVec,
        age: 30,
        gender: "female",
        genderProbability: 0.9,
      };
      const matchesNaNGallery = rankByDescriptor(normalQuery, [celebWithNaN, celebNormal], 5);
      assert.ok(Array.isArray(matchesNaNGallery), "Normal query against NaN gallery should return array without throwing");

      // 3. distanceToMatchPercent with NaN / Infinity
      assert.equal(distanceToMatchPercent(NaN), 15.0);
      assert.equal(distanceToMatchPercent(Infinity), 15.0);
      assert.equal(distanceToMatchPercent(-Infinity), 100.0);
    });

    it("handles empty vector arrays without throwing or returning undefined", () => {
      const emptyDescQuery: UserFaceQuery = {
        descriptor: new Float32Array(0),
        descriptors: [],
        age: 30,
        gender: "male",
        genderProbability: 0.8,
      };

      const emptyCeleb: CelebrityEmbedding = {
        id: "celeb_empty",
        name: "Celeb Empty",
        path: "/empty.jpg",
        descriptor: [],
        descriptors: [],
        referenceVectors: [],
        age: 30,
        gender: "male",
        genderProb: 0.8,
      };

      const normalCeleb = createMultiVectorCeleb("celeb_norm", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: createVector(128, 0.1) },
      ]);

      const res1 = rankByDescriptor(emptyDescQuery, [normalCeleb], 5);
      assert.deepEqual(res1, [], "Empty descriptor query must return []");

      const normalQuery: UserFaceQuery = {
        descriptor: createVector(128, 0.1),
        age: 30,
        gender: "male",
        genderProbability: 0.8,
      };
      const res2 = minMultiVectorDistance(normalQuery, emptyCeleb);
      assert.equal(res2, 1.0, "Empty celebrity distance must fallback to 1.0");

      const bestMatch = getBestMatchingReferenceVector([createVector(128, 0.1)], emptyCeleb);
      assert.equal(bestMatch.distance, 1.0);
      assert.equal(bestMatch.index, -1);
    });

    it("deduplicates identical/clone reference vectors during mergeExtraReferences", () => {
      const vBase = createVector(128, 0.1);
      const celebBase = createMultiVectorCeleb("celeb_dedupe", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vBase },
      ]);

      const extras: ExtraReference[] = [
        { id: "celeb_dedupe", descriptor: Array.from(vBase), photoUrl: "/clone.jpg" }, // Exact clone (< 1e-4 eps)
        { id: "celeb_dedupe", descriptor: Array.from(createVector(128, 0.1, 0, 0.4)), photoUrl: "/new_view.jpg" }, // Distinct view
      ];

      const merged = mergeExtraReferences([celebBase], extras);
      assert.ok(merged[0]?.descriptors);
      assert.ok(merged[0]?.referenceVectors);
      assert.equal(merged[0]!.descriptors!.length, 2, "Exact clone must be filtered out, leaving only 1 new reference");
      assert.equal(merged[0]!.referenceVectors!.length, 2);
    });
  });

  describe("4. Fallback Safety & Legacy Compatibility", () => {
    it("correctly matches legacy single-vector celebrity entries missing referenceVectors", () => {
      const vLegacy = createVector(128, 0.1, 5, 0.3);
      const legacyCeleb: CelebrityEmbedding = {
        id: "legacy_celeb",
        name: "Legacy Celeb",
        path: "/legacy.jpg",
        descriptor: Array.from(vLegacy), // No descriptors or referenceVectors
        age: 45,
        gender: "male",
        genderProb: 0.88,
      };

      const descs = getCelebrityDescriptors(legacyCeleb);
      assert.equal(descs.length, 1);
      assert.ok(descs[0] instanceof Float32Array);

      const query: UserFaceQuery = {
        descriptor: vLegacy,
        age: 45,
        gender: "male",
        genderProbability: 0.88,
      };

      const matches = rankByDescriptor(query, [legacyCeleb], 1);
      assert.equal(matches.length, 1);
      assert.equal(matches[0]!.celebrityId, "legacy_celeb");
      assert.ok(matches[0]!.distance! < 0.01);
    });

    it("handles missing pose annotations or missing feature metadata gracefully", () => {
      const vNoPose = createVector(128, 0.1);
      const celebNoPose: CelebrityEmbedding = {
        id: "no_pose_celeb",
        name: "No Pose Celeb",
        path: "/nopose.jpg",
        descriptor: Array.from(vNoPose),
        referenceVectors: [
          { descriptor: vNoPose, photoUrl: "/nopose.jpg" }, // missing viewType and pose
        ],
        age: 25,
        gender: "female",
        genderProb: 0.9,
      };

      const queryWithPose: UserFaceQuery = {
        descriptor: vNoPose,
        headPose: { yawDeg: 45, pitchDeg: 10, rollDeg: 0, poseScore: 0.95 },
        age: 25,
        gender: "female",
        genderProbability: 0.9,
      };

      const dist = fastTopologicalManifoldDistance([vNoPose], celebNoPose, queryWithPose.headPose);
      assert.ok(Number.isFinite(dist));
      assert.ok(dist < 0.05);

      const best = getBestMatchingReferenceVector([vNoPose], celebNoPose, queryWithPose.headPose);
      assert.equal(best.index, 0);
      assert.ok(best.descriptor instanceof Float32Array);
    });
  });
});
