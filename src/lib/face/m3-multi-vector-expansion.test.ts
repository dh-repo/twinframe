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
  loadCelebrityEmbeddings,
  l2Normalize,
  mergeExtraReferences,
  hydrateFaceFeatures,
  type CelebrityEmbedding,
  type ExtraReference,
  type ReferenceVector,
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

describe("Milestone M3_MultiVector — Gallery Multi-Vector Expansion Pipeline", () => {
  describe("1. Multi-View Vector Retrieval (d < 0.25)", () => {
    it("retrieves expression view vector with d < 0.25 when query has dynamic expression", () => {
      const vFrontal = createVector(128, 0.1, 0, 0.5);
      const vExpression = createVector(128, 0.1, 0, 0.12); // Close to expression query
      const vProfile = createVector(128, 0.1, 0, 0.9);

      const celeb = createMultiVectorCeleb("test_expression", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vFrontal },
        { viewType: "expression", pose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0 }, descriptor: vExpression },
        { viewType: "profile_left", pose: { yawDeg: -30, pitchDeg: 0, rollDeg: 0 }, descriptor: vProfile },
      ]);

      const queryExpr = createVector(128, 0.1, 0, 0.12);
      const userQuery: UserFaceQuery = {
        descriptor: queryExpr,
        age: 32,
        gender: "female",
        genderProbability: 0.95,
        headPose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0, poseScore: 0.95 },
      };

      const dist = minMultiVectorDistance(userQuery, celeb);
      assert.ok(
        dist < 0.25,
        `Expression match distance expected < 0.25, got ${dist.toFixed(4)}`,
      );

      const bestMatch = getBestMatchingReferenceVector([queryExpr], celeb, userQuery.headPose);
      assert.equal(bestMatch.refVec?.viewType, "expression");
    });

    it("retrieves angled profile view vector with d < 0.25 when query has 30 deg yaw pose", () => {
      const vFrontal = createVector(128, 0.1, 0, 0.8);
      const vExpression = createVector(128, 0.1, 0, 0.7);
      const vProfile = createVector(128, 0.1, 0, 0.15); // Close to angled query

      const celeb = createMultiVectorCeleb("test_angled", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vFrontal },
        { viewType: "expression", pose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0 }, descriptor: vExpression },
        { viewType: "angled_30", pose: { yawDeg: 30, pitchDeg: 2, rollDeg: 0 }, descriptor: vProfile },
      ]);

      const queryAngled = createVector(128, 0.1, 0, 0.15);
      const userQuery: UserFaceQuery = {
        descriptor: queryAngled,
        age: 30,
        gender: "female",
        genderProbability: 0.95,
        headPose: { yawDeg: 30, pitchDeg: 2, rollDeg: 0, poseScore: 0.95 },
      };

      const dist = minMultiVectorDistance(userQuery, celeb);
      assert.ok(
        dist < 0.25,
        `Angled profile match distance expected < 0.25, got ${dist.toFixed(4)}`,
      );

      const matches = rankByDescriptor(userQuery, [celeb], 1);
      assert.equal(matches.length, 1);
      assert.equal(matches[0]!.celebrityId, "test_angled");
      assert.ok(matches[0]!.distance! < 0.25);
    });
  });

  describe("2. Single-Vector Baseline Fallback & Backward Compatibility", () => {
    it("handles legacy single-vector celebrity entries seamlessly via getCelebrityDescriptors", () => {
      const vSingle = createVector(128, 0.1, 0, 0.2);
      const singleCeleb: CelebrityEmbedding = {
        id: "single_legacy",
        name: "Single Legacy",
        path: "/single.jpg",
        descriptor: Array.from(vSingle),
        age: 40,
        gender: "male",
        genderProb: 0.9,
      };

      const descs = getCelebrityDescriptors(singleCeleb);
      assert.equal(descs.length, 1);
      assert.ok(descs[0] instanceof Float32Array);

      const userQuery: UserFaceQuery = {
        descriptor: vSingle,
        age: 40,
        gender: "male",
        genderProbability: 0.9,
      };

      const dist = minMultiVectorDistance(userQuery, singleCeleb);
      assert.ok(dist < 0.05, `Single-vector identity exact match distance expected near 0, got ${dist}`);
    });

    it("evaluates loadCelebrityEmbeddings node fallback as a single frontal vector", async () => {
      const gallery = await loadCelebrityEmbeddings();
      assert.ok(gallery.length > 0, "Gallery must load celebrities");

      const first = gallery[0]!;
      assert.ok(first.referenceVectors && first.referenceVectors.length >= 1);
      const viewTypes = first.referenceVectors.map((r) => r.viewType);
      assert.ok(viewTypes.includes("frontal"), "Reference vectors should contain frontal view");
      assert.ok(
        !viewTypes.includes("profile_left") && !viewTypes.includes("profile_right"),
        "Node fallback must not invent profile encodings",
      );
      assert.ok(first.features?.anatomical, "Gallery load must hydrate anatomical ratios for R5");
    });

    it("mergeExtraReferences honors explicit viewType and defaults extras to expression", () => {
      const frontal = createVector(128, 0.1, 0, 0.5);
      const celeb = createMultiVectorCeleb("label_test", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: frontal },
      ]);
      const extras: ExtraReference[] = [
        {
          id: "label_test",
          descriptor: Array.from(createVector(128, 0.1, 3, 0.8)),
          photoUrl: "/smile.jpg",
        },
        {
          id: "label_test",
          descriptor: Array.from(createVector(128, 0.1, 7, 0.9)),
          photoUrl: "/left.jpg",
          viewType: "profile_left",
          pose: { yawDeg: -28, pitchDeg: 2, rollDeg: 0 },
        },
      ];
      const merged = mergeExtraReferences([celeb], extras);
      const views = merged[0]!.referenceVectors!.map((r) => r.viewType);
      assert.ok(views.includes("frontal"));
      assert.ok(views.includes("expression"));
      assert.ok(views.includes("profile_left"));
    });

    it("invalidates cached getCelebrityDescriptors after mergeExtraReferences", () => {
      const frontal = createVector(128, 0.1, 0, 0.5);
      const celeb = createMultiVectorCeleb("cache_test", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: frontal },
      ]);
      const before = getCelebrityDescriptors(celeb);
      assert.equal(before.length, 1);
      mergeExtraReferences([celeb], [
        { id: "cache_test", descriptor: Array.from(createVector(128, 0.1, 4, 0.85)), photoUrl: "/smile.jpg" },
      ]);
      const after = getCelebrityDescriptors(celeb);
      assert.equal(after.length, 2, "Stale _f32Descriptors cache must not hide the new extra");
    });

    it("hydrateFaceFeatures derives anatomical ratios from 23-d gallery features", () => {
      const feat = hydrateFaceFeatures(emptyFeatures());
      assert.ok(feat.anatomical);
      assert.ok(feat.anatomical.upperThirdRatio > 0);
      assert.ok(feat.anatomical.nasalIndex > 0);
    });
  });

  describe("3. Zero Memory / Tensor Leaks Verification", () => {
    it("executes 100 iterations of multi-vector matching without memory degradation or leak", () => {
      const vQuery = createVector(128, 0.1);
      const v1 = createVector(128, 0.1, 0, 0.2);
      const v2 = createVector(128, 0.1, 1, 0.3);
      const v3 = createVector(128, 0.1, 2, 0.4);

      const celeb = createMultiVectorCeleb("leak_check", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: v1 },
        { viewType: "expression", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: v2 },
        { viewType: "profile_left", pose: { yawDeg: -25, pitchDeg: 0, rollDeg: 0 }, descriptor: v3 },
      ]);

      const query: UserFaceQuery = {
        descriptor: vQuery,
        age: 30,
        gender: "female",
        genderProbability: 0.9,
        headPose: { yawDeg: -25, pitchDeg: 0, rollDeg: 0, poseScore: 0.95 },
      };

      for (let i = 0; i < 100; i++) {
        const matches = rankByDescriptor(query, [celeb], 1);
        assert.equal(matches.length, 1);
      }
    });
  });

  describe("4. Execution Latency Budget & SLA Compliance (< 20ms)", () => {
    it("ranks a query against 1,000 multi-vector celebrities (3,000 vectors) in under 20ms SLA limit", () => {
      const vQuery = createVector(128, 0.1);
      const gallery: CelebrityEmbedding[] = [];

      for (let i = 0; i < 1000; i++) {
        const vFrontal = createVector(128, 0.1, i % 128, (i % 10) * 0.04);
        const vExpr = createVector(128, 0.1, (i + 1) % 128, (i % 10) * 0.04);
        const vAngled = createVector(128, 0.1, (i + 2) % 128, (i % 10) * 0.04);

        gallery.push(createMultiVectorCeleb(`celeb_${i}`, [
          { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vFrontal },
          { viewType: "expression", pose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0 }, descriptor: vExpr },
          { viewType: "profile_left", pose: { yawDeg: -28, pitchDeg: 2, rollDeg: 0 }, descriptor: vAngled },
        ]));
      }

      const query: UserFaceQuery = {
        descriptor: vQuery,
        age: 30,
        gender: "female",
        genderProbability: 0.9,
        headPose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0, poseScore: 0.95 },
      };

      // Warmup pass
      rankByDescriptor(query, gallery, 5);

      const start = performance.now();
      const iterations = 20;
      for (let i = 0; i < iterations; i++) {
        rankByDescriptor(query, gallery, 5);
      }
      const totalMs = performance.now() - start;
      const avgMs = totalMs / iterations;

      assert.ok(
        avgMs < 20.0,
        `Multi-vector ranking average latency (${avgMs.toFixed(2)}ms) exceeded SLA limit of 20.0ms for 1,000 multi-vector celebrities`,
      );
    });
  });

  describe("5. Topological Manifold Distance & Pose Penalty Behavior", () => {
    it("applies view bonus and pose alignment to select matching manifold vector", () => {
      const vFrontal = createVector(128, 0.1, 0, 0.3);
      const vProfile = createVector(128, 0.1, 0, 0.31);

      const celeb = createMultiVectorCeleb("manifold_test", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vFrontal },
        { viewType: "profile_left", pose: { yawDeg: -30, pitchDeg: 0, rollDeg: 0 }, descriptor: vProfile },
      ]);

      const qDescs = [vProfile];
      const queryPoseFrontal: HeadPoseOrientation = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
      const queryPoseProfile: HeadPoseOrientation = { yawDeg: -30, pitchDeg: 0, rollDeg: 0 };

      const distFrontal = fastTopologicalManifoldDistance(qDescs, celeb, queryPoseFrontal);
      const distProfile = fastTopologicalManifoldDistance(qDescs, celeb, queryPoseProfile);

      assert.ok(
        distProfile < distFrontal,
        `Matching query pose (-30 yaw) to profile view vector should yield lower distance (${distProfile.toFixed(4)}) than mismatched frontal query pose (${distFrontal.toFixed(4)})`,
      );
    });
  });
});
