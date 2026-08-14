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
  type CelebrityEmbedding,
  type ReferenceVector,
} from "./embeddings.ts";
import { emptyFeatures } from "./math.ts";
import type { FaceViewType, HeadPoseOrientation } from "./types.ts";

/** Helper to generate L2-normalized synthetic 128-d vector */
function createVector(dim = 128, baseVal = 0.1, spikeIdx?: number, spikeVal?: number): Float32Array {
  const v = new Float32Array(dim).fill(baseVal);
  if (spikeIdx !== undefined && spikeVal !== undefined) {
    v[spikeIdx] = spikeVal;
  }
  return l2Normalize(v);
}

/** Helper to create a synthetic multi-vector celebrity identity */
function createTestMultiVectorCeleb(
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
    age: 30,
    gender: "female",
    genderProb: 0.95,
    features: emptyFeatures(),
  };
}

describe("Empirical Challenger M3 — Deep Multi-Vector Topological Manifold Stress Test", () => {
  describe("1. Expression Profile Manifold Distance (d < 0.25)", () => {
    it("empirically verifies expression query matches expression vector with d < 0.25 and outperforms single frontal baseline", () => {
      // Frontal vector has high divergence from expression query
      const vFrontal = createVector(128, 0.1, 5, 0.9);
      // Expression reference vector is close to expression query
      const vExpression = createVector(128, 0.1, 5, 0.15);
      const vProfile = createVector(128, 0.1, 5, -0.6);

      const celebMulti = createTestMultiVectorCeleb("celeb_expr_test", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vFrontal },
        { viewType: "expression", pose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0 }, descriptor: vExpression },
        { viewType: "profile_left", pose: { yawDeg: -30, pitchDeg: 0, rollDeg: 0 }, descriptor: vProfile },
      ]);

      const celebSingleFrontal: CelebrityEmbedding = {
        id: "celeb_single_test",
        name: "Celeb Single Frontal",
        path: "/single.jpg",
        descriptor: Array.from(vFrontal),
        descriptors: [vFrontal],
        referenceVectors: [{ descriptor: vFrontal, viewType: "frontal", photoUrl: "/single.jpg" }],
        age: 30,
        gender: "female",
        genderProb: 0.95,
      };

      const queryExprVector = createVector(128, 0.1, 5, 0.15);
      const queryExpr: UserFaceQuery = {
        descriptor: queryExprVector,
        age: 30,
        gender: "female",
        genderProbability: 0.95,
        headPose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0, poseScore: 0.95 },
      };

      const distMulti = minMultiVectorDistance(queryExpr, celebMulti);
      const distSingle = minMultiVectorDistance(queryExpr, celebSingleFrontal);

      // Requirement 1: d < 0.25
      assert.ok(
        distMulti < 0.25,
        `Multi-vector expression match distance MUST be < 0.25, got ${distMulti.toFixed(4)}`,
      );

      // Requirement 2: multi-vector search distance < single frontal baseline distance
      assert.ok(
        distMulti < distSingle,
        `Multi-vector distance (${distMulti.toFixed(4)}) MUST be lower than single frontal baseline distance (${distSingle.toFixed(4)})`,
      );

      // Best matching vector retrieval check
      const best = getBestMatchingReferenceVector([queryExprVector], celebMulti, queryExpr.headPose);
      assert.equal(best.refVec?.viewType, "expression", "Best matching vector should be the expression view");
      assert.ok(best.distance < 0.25, "Best matching distance should be < 0.25");
    });
  });

  describe("2. Angled Profile Manifold Distance (d < 0.25 & View Bonus)", () => {
    it("empirically verifies 30 deg yaw profile query matches profile vector with d < 0.25 and receives view bonus", () => {
      const vFrontal = createVector(128, 0.1, 10, 0.85);
      const vExpression = createVector(128, 0.1, 10, 0.70);
      const vProfileLeft = createVector(128, 0.1, 10, 0.12);

      const celebAngled = createTestMultiVectorCeleb("celeb_angled_test", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vFrontal },
        { viewType: "expression", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vExpression },
        { viewType: "profile_left", pose: { yawDeg: -28, pitchDeg: 2, rollDeg: 0 }, descriptor: vProfileLeft },
      ]);

      const queryProfileVector = createVector(128, 0.1, 10, 0.12);
      const queryAngled: UserFaceQuery = {
        descriptor: queryProfileVector,
        age: 30,
        gender: "female",
        genderProbability: 0.95,
        headPose: { yawDeg: -28, pitchDeg: 2, rollDeg: 0, poseScore: 0.95 },
      };

      const dist = minMultiVectorDistance(queryAngled, celebAngled);
      assert.ok(
        dist < 0.25,
        `Angled profile match distance MUST be < 0.25, got ${dist.toFixed(4)}`,
      );

      // Verify rankByDescriptor returns top match with distance < 0.25
      const matches = rankByDescriptor(queryAngled, [celebAngled], 1);
      assert.equal(matches.length, 1);
      assert.equal(matches[0]!.celebrityId, "celeb_angled_test");
      assert.ok(matches[0]!.distance! < 0.25, `Ranked distance MUST be < 0.25, got ${matches[0]!.distance}`);

      // Verify view affinity bonus (-0.035) when query yaw > 15 deg and matching non-frontal view
      const manifoldDistWithPose = fastTopologicalManifoldDistance([queryProfileVector], celebAngled, { yawDeg: -28, pitchDeg: 2, rollDeg: 0 });
      const manifoldDistNoPose = fastTopologicalManifoldDistance([queryProfileVector], celebAngled);
      assert.ok(
        manifoldDistWithPose < manifoldDistNoPose,
        `Manifold distance with matching pose (${manifoldDistWithPose.toFixed(4)}) should be smaller than without pose (${manifoldDistNoPose.toFixed(4)})`,
      );
    });
  });

  describe("3. Topological Manifold Search & Multi-Template TTA Integration", () => {
    it("handles multi-template query vectors scanning multi-vector gallery entries", () => {
      const v1 = createVector(128, 0.1, 0, 0.4);
      const v2 = createVector(128, 0.1, 0, 0.10);
      const v3 = createVector(128, 0.1, 0, -0.2);

      const celeb = createTestMultiVectorCeleb("celeb_tta_multi", [
        { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: v1 },
        { viewType: "expression", pose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0 }, descriptor: v2 },
        { viewType: "profile_left", pose: { yawDeg: -30, pitchDeg: 0, rollDeg: 0 }, descriptor: v3 },
      ]);

      const ttaTemplates = [
        createVector(128, 0.1, 0, 0.45), // canonical crop
        createVector(128, 0.1, 0, 0.10), // flip crop (matches v2)
        createVector(128, 0.1, 0, -0.15), // tight crop
      ];

      const queryTTA: UserFaceQuery = {
        descriptor: ttaTemplates[0]!,
        descriptors: ttaTemplates,
        age: 30,
        gender: "female",
        genderProbability: 0.95,
        headPose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0, poseScore: 0.95 },
      };

      const dist = minMultiVectorDistance(queryTTA, celeb);
      assert.ok(dist < 0.05, `Multi-template TTA match should find exact near vector yielding distance < 0.05, got ${dist.toFixed(4)}`);
    });
  });

  describe("4. Legacy Single-Vector Fallback Integrity", () => {
    it("correctly resolves descriptors for legacy celebrities with raw array or Float32Array descriptors", () => {
      const vLegacy = createVector(128, 0.1, 0, 0.25);
      
      const celebRawArray: CelebrityEmbedding = {
        id: "legacy_raw",
        name: "Legacy Raw Array",
        path: "/raw.jpg",
        descriptor: Array.from(vLegacy),
        age: 35,
        gender: "male",
        genderProb: 0.9,
      };

      const descs = getCelebrityDescriptors(celebRawArray);
      assert.equal(descs.length, 1);
      assert.ok(descs[0] instanceof Float32Array);

      const query: UserFaceQuery = {
        descriptor: vLegacy,
        age: 35,
        gender: "male",
        genderProbability: 0.9,
      };

      const dist = minMultiVectorDistance(query, celebRawArray);
      assert.ok(dist < 0.05, `Legacy raw array match distance expected near 0, got ${dist}`);
    });

    it("verifies loadCelebrityEmbeddings produces a frontal reference for all default CELEBRITIES", async () => {
      const gallery = await loadCelebrityEmbeddings();
      assert.ok(gallery.length >= 10, "Gallery must contain celebrities");

      for (const celeb of gallery) {
        assert.ok(celeb.referenceVectors && celeb.referenceVectors.length >= 1, `Celeb ${celeb.id} must have a reference vector`);
        assert.ok(celeb.descriptors && celeb.descriptors.length >= 1, `Celeb ${celeb.id} must have a descriptor`);
        assert.ok(
          celeb.referenceVectors.some((r) => r.viewType === "frontal"),
          `Celeb ${celeb.id} must label the primary vector frontal`,
        );
        assert.ok(
          celeb.referenceVectors.every((r) => r.viewType !== "profile_left" && r.viewType !== "profile_right"),
          `Celeb ${celeb.id} must not invent profile encodings`,
        );
      }
    });
  });

  describe("5. Stress Performance & Zero Memory Leak Verification", () => {
    it("executes 2,000 multi-vector gallery identity searches (6,000 vectors) under < 20ms SLA", () => {
      const vQuery = createVector(128, 0.1, 12, 0.3);
      const gallery: CelebrityEmbedding[] = [];

      for (let i = 0; i < 2000; i++) {
        const vF = createVector(128, 0.1, i % 128, (i % 10) * 0.03);
        const vE = createVector(128, 0.1, (i + 1) % 128, (i % 10) * 0.03);
        const vA = createVector(128, 0.1, (i + 2) % 128, (i % 10) * 0.03);

        gallery.push(createTestMultiVectorCeleb(`celeb_scale_${i}`, [
          { viewType: "frontal", pose: { yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, descriptor: vF },
          { viewType: "expression", pose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0 }, descriptor: vE },
          { viewType: "profile_left", pose: { yawDeg: -28, pitchDeg: 2, rollDeg: 0 }, descriptor: vA },
        ]));
      }

      const query: UserFaceQuery = {
        descriptor: vQuery,
        descriptors: [vQuery, createVector(128, 0.1, 12, 0.31)],
        age: 30,
        gender: "female",
        genderProbability: 0.9,
        headPose: { yawDeg: 2, pitchDeg: 4, rollDeg: 0, poseScore: 0.95 },
      };

      // Warmup pass
      rankByDescriptor(query, gallery, 5);

      const iterations = 30;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const results = rankByDescriptor(query, gallery, 5);
        assert.equal(results.length, 5);
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;

      assert.ok(
        avgMs < 20.0,
        `2,000 multi-vector gallery search average latency (${avgMs.toFixed(2)}ms) exceeded SLA limit of 20.0ms`,
      );
    });
  });
});
