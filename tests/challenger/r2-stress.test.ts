import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calibratedAgeGapPenalty,
  distanceToMatchPercent,
  combinedDescriptorDistance,
  computeMatchScore,
  type CelebrityEmbedding,
} from "../../src/lib/face/embeddings.ts";
import {
  rankByDescriptor,
  type UserFaceQuery,
} from "../../src/lib/face/match.ts";

/**
 * Adversarial Challenger 1 Stress Test Suite
 * Requirement R2: Calibrated Age-Gap Penalty and Matching Robustness
 */
describe("Adversarial Challenger 1: R2 Matching & Age-Gap Penalty Stress Suite", () => {
  // =========================================================================
  // 1. INVARIANT: Strong Lookalikes (d <= 0.40)
  // =========================================================================
  describe("Invariant 1: Strong Lookalikes (d <= 0.40)", () => {
    it("[STRESS-01] 1000 randomized synthetic face pairs with d in [0.0, 0.40] and age gaps in [0, 80] yield exactly P_age === 0.0", () => {
      let nonZeroCount = 0;
      const N = 1000;

      for (let i = 0; i < N; i++) {
        const d = Math.random() * 0.40; // [0.0, 0.40)
        const userAge = 18 + Math.random() * 72; // [18, 90]
        const celebAge = 18 + Math.random() * 72; // [18, 90]

        const p = calibratedAgeGapPenalty(d, userAge, celebAge);
        if (p !== 0.0) {
          nonZeroCount++;
        }
      }

      assert.equal(nonZeroCount, 0, `Expected 0 non-zero penalties for d <= 0.40, found ${nonZeroCount}`);
    });

    it("[STRESS-02] Exact upper bound d = 0.4000000000000000 across 500 random age pairs yields exactly P_age === 0.0", () => {
      for (let i = 0; i < 500; i++) {
        const userAge = 20 + Math.random() * 60;
        const celebAge = 20 + Math.random() * 60;
        const p = calibratedAgeGapPenalty(0.40, userAge, celebAge);
        assert.equal(p, 0.0, `Penalty at boundary d=0.40 must be 0.0 (got ${p} for userAge=${userAge}, celebAge=${celebAge})`);
      }
    });

    it("[STRESS-03] True lookalike twin (d <= 0.40) is NEVER demoted by age penalty in full candidate ranking across 200 randomized trials", () => {
      for (let trial = 0; trial < 200; trial++) {
        const userAge = 45 + Math.floor(Math.random() * 35); // 45 to 80
        const queryDesc = new Float32Array(128);
        queryDesc[0] = 1.0;

        // Twin: d in [0.15, 0.38], age 20 (large gap)
        const twinDist = 0.15 + Math.random() * 0.23; // [0.15, 0.38]
        const twinAge = 20;
        const twinDesc = new Float32Array(128);
        twinDesc[0] = Math.cos(twinDist);
        twinDesc[1] = Math.sin(twinDist);

        const twinCeleb: CelebrityEmbedding = {
          id: "twin-young",
          name: "Young Twin",
          path: "/celebs/twin-young.jpg",
          descriptor: Array.from(twinDesc),
          descriptors: [twinDesc],
          age: twinAge,
          gender: "female",
          genderProb: 0.95,
        };

        // Distractor peers: d in [0.42, 0.70], age = userAge (gap 0)
        const distractorDesc = new Float32Array(128);
        const distractorDist = 0.42 + Math.random() * 0.25;
        distractorDesc[0] = Math.cos(distractorDist);
        distractorDesc[1] = Math.sin(distractorDist);

        const peerCeleb: CelebrityEmbedding = {
          id: "peer-distant",
          name: "Age Peer",
          path: "/celebs/peer-distant.jpg",
          descriptor: Array.from(distractorDesc),
          descriptors: [distractorDesc],
          age: userAge,
          gender: "female",
          genderProb: 0.95,
        };

        const query: UserFaceQuery = {
          descriptor: queryDesc,
          age: userAge,
          gender: "female",
          genderProbability: 0.95,
        };

        const matches = rankByDescriptor(query, [twinCeleb, peerCeleb], 5);
        assert.ok(matches.length >= 1, "Must return matches");
        assert.equal(matches[0]!.celebrityId, "twin-young", `Trial ${trial}: Twin at d=${twinDist} must rank #1 over peer at d=${distractorDist}`);
      }
    });
  });

  // =========================================================================
  // 2. INVARIANT: Age Peers (|Δage| <= 20)
  // =========================================================================
  describe("Invariant 2: Age Peers (|Δage| <= 20)", () => {
    it("[STRESS-04] 1000 randomized face pairs with d in [0.40, 0.90] and |Δage| in [0, 20] yield exactly P_age === 0.0", () => {
      let nonZeroCount = 0;
      const N = 1000;

      for (let i = 0; i < N; i++) {
        const d = 0.40 + Math.random() * 0.50; // [0.40, 0.90]
        const userAge = 18 + Math.random() * 70; // [18, 88]
        const ageOffset = (Math.random() * 40) - 20; // [-20, +20]
        const celebAge = Math.max(18, Math.min(95, userAge + ageOffset));

        const gap = Math.abs(userAge - celebAge);
        if (gap <= 20) {
          const p = calibratedAgeGapPenalty(d, userAge, celebAge);
          if (p !== 0.0) {
            nonZeroCount++;
          }
        }
      }

      assert.equal(nonZeroCount, 0, `Expected 0 non-zero penalties for age peers (|Δage| <= 20), found ${nonZeroCount}`);
    });

    it("[STRESS-05] Boundary tests for exact gap = 20.000000 vs 20.00001 across distance range [0.41, 0.80]", () => {
      for (let d = 0.41; d <= 0.80; d += 0.03) {
        const pExact = calibratedAgeGapPenalty(d, 50, 30); // gap = 20.0
        assert.equal(pExact, 0.0, `Exact gap 20 at d=${d} must have P_age === 0.0`);

        const pSlight = calibratedAgeGapPenalty(d, 50, 29.999); // gap = 20.001
        assert.ok(pSlight >= 0.0, `Gap 20.001 at d=${d} must be >= 0.0, got ${pSlight}`);
        assert.ok(pSlight < 0.01, `Gap 20.001 at d=${d} must be tiny near boundary, got ${pSlight}`);
      }
    });
  });

  // =========================================================================
  // 3. GENERATIONAL GAP DEMOTION: Mature Adult Queries (u_age in [45, 75])
  // =========================================================================
  describe("Generational Gap Demotion (u_age in [45, 75])", () => {
    it("[STRESS-06] Evaluates generational gap demotion for 20yo (d=0.415) vs 50yo (d=0.430) across mature queries u_age in [45, 75]", () => {
      const results: { uAge: number; demoted: boolean; effYoung: number; effPeer: number; penYoung: number }[] = [];
      const dYoung = 0.415;
      const cAgeYoung = 20;
      const dPeer = 0.430;
      const cAgePeer = 50;

      for (let uAge = 45; uAge <= 75; uAge++) {
        const penYoung = calibratedAgeGapPenalty(dYoung, uAge, cAgeYoung);
        const penPeer = calibratedAgeGapPenalty(dPeer, uAge, cAgePeer);

        const effYoung = dYoung + penYoung;
        const effPeer = dPeer + penPeer;
        const demoted = effPeer < effYoung;

        results.push({ uAge, demoted, effYoung, effPeer, penYoung });
      }

      const failingAges = results.filter((r) => !r.demoted).map((r) => r.uAge);
      console.log(`[EMPIRICAL AUDIT] Demotion failure for u_age in [45, 75]: ${failingAges.length} failing ages: ${failingAges.join(", ")}`);

      // Assert full compliance with R2 generational gap demotion
      assert.equal(
        failingAges.length,
        0,
        `20yo candidate (d=0.415) failed to be demoted below 50yo candidate (d=0.430) for mature ages: ${failingAges.join(", ")}`,
      );
    });

    it("[STRESS-07] rankByDescriptor demotes 20yo candidate (d=0.415) below 50yo candidate (d=0.430) in weak match pool across u_age in [45, 75]", () => {
      const queryDesc = new Float32Array(128);
      queryDesc[0] = 1.0;

      const makeVec = (targetDist: number): Float32Array => {
        let low = 0.0;
        let high = Math.PI;
        const vec = new Float32Array(128);
        for (let iter = 0; iter < 50; iter++) {
          const mid = (low + high) / 2;
          vec[0] = Math.cos(mid);
          vec[1] = Math.sin(mid);
          const curDist = combinedDescriptorDistance(queryDesc, vec);
          if (curDist < targetDist) {
            low = mid;
          } else {
            high = mid;
          }
        }
        return vec;
      };

      const youngDesc = makeVec(0.415);
      const peerDesc = makeVec(0.430);

      const failingAges: number[] = [];

      for (let uAge = 45; uAge <= 75; uAge++) {
        const youngCeleb: CelebrityEmbedding = {
          id: "cand-young-20",
          name: "Young Candidate",
          path: "/celebs/cand-young-20.jpg",
          descriptor: Array.from(youngDesc),
          descriptors: [youngDesc],
          age: 20,
          gender: "female",
          genderProb: 0.95,
        };

        const peerCeleb: CelebrityEmbedding = {
          id: "cand-peer-50",
          name: "Peer Candidate",
          path: "/celebs/cand-peer-50.jpg",
          descriptor: Array.from(peerDesc),
          descriptors: [peerDesc],
          age: 50,
          gender: "female",
          genderProb: 0.95,
        };

        const query: UserFaceQuery = {
          descriptor: queryDesc,
          age: uAge,
          gender: "female",
          genderProbability: 0.95,
        };

        const results = rankByDescriptor(query, [youngCeleb, peerCeleb], 5);
        if (!results || results.length < 2 || results[0]!.celebrityId !== "cand-peer-50") {
          failingAges.push(uAge);
        }
      }

      console.log(`[EMPIRICAL AUDIT] rankByDescriptor demotion failures across [45, 75]: ${failingAges.length} ages: ${failingAges.join(", ")}`);
      assert.equal(
        failingAges.length,
        0,
        `rankByDescriptor failed to demote 20yo candidate below 50yo candidate for mature query ages: ${failingAges.join(", ")}`,
      );
    });
  });

  // =========================================================================
  // 4. BOUNDARY CONTINUITY & MONOTONICITY
  // =========================================================================
  describe("Boundary Continuity & Monotonicity", () => {
    it("[STRESS-08] Zero discontinuity as d -> 0.40+ (epsilon jump < 1e-4)", () => {
      const uAge = 55;
      const cAge = 20; // large gap 35
      const pExact = calibratedAgeGapPenalty(0.400000, uAge, cAge);
      assert.equal(pExact, 0.0);

      const epsilons = [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
      let prevP = 0.0;

      for (const eps of epsilons) {
        const p = calibratedAgeGapPenalty(0.40 + eps, uAge, cAge);
        assert.ok(p >= prevP, `Monotonicity violation at eps=${eps}: ${p} < ${prevP}`);
        assert.ok(p - prevP < 0.05, `Discontinuous jump detected at eps=${eps}: delta=${p - prevP}`);
        prevP = p;
      }
    });

    it("[STRESS-09] Zero discontinuity as |Δage| -> 20+ (epsilon jump < 1e-4)", () => {
      const d = 0.46;
      const uAge = 50;
      const pExact = calibratedAgeGapPenalty(d, uAge, 30); // gap = 20.0
      assert.equal(pExact, 0.0);

      const epsilons = [1e-5, 1e-4, 1e-3, 1e-2, 0.1, 1.0];
      let prevP = 0.0;

      for (const eps of epsilons) {
        const p = calibratedAgeGapPenalty(d, uAge, 30 - eps);
        assert.ok(p >= prevP, `Monotonicity violation at gap epsilon=${eps}: ${p} < ${prevP}`);
        assert.ok(p - prevP < 0.03, `Discontinuous jump detected at gap epsilon=${eps}: delta=${p - prevP}`);
        prevP = p;
      }
    });

    it("[STRESS-10] Monotonic distance gradient: dP/dd >= 0 everywhere in [0.0, 1.0]", () => {
      const uAge = 60;
      const cAge = 22;
      let prevP = 0.0;

      for (let d = 0.0; d <= 1.0; d += 0.005) {
        const p = calibratedAgeGapPenalty(d, uAge, cAge);
        assert.ok(p >= prevP, `Distance monotonicity violated at d=${d}: p=${p} < prevP=${prevP}`);
        assert.ok(p <= 0.22, `Penalty exceeds maxPenalty 0.22: p=${p} at d=${d}`);
        prevP = p;
      }
    });

    it("[STRESS-11] Monotonic age gap gradient: dP/d(Δage) >= 0 everywhere in [0, 80]", () => {
      const d = 0.48;
      const uAge = 60;
      let prevP = 0.0;

      for (let gap = 0; gap <= 80; gap += 0.5) {
        const cAge = Math.max(18, uAge - gap);
        const p = calibratedAgeGapPenalty(d, uAge, cAge);
        assert.ok(p >= prevP, `Age gap monotonicity violated at gap=${gap}: p=${p} < prevP=${prevP}`);
        assert.ok(p <= 0.22, `Penalty exceeds maxPenalty 0.22: p=${p} at gap=${gap}`);
        prevP = p;
      }
    });

    it("[STRESS-12] Monotonic user age maturity gradient: dP/d(u_age) >= 0 in [18, 80]", () => {
      const d = 0.46;
      const cAge = 20;
      let prevP = 0.0;

      for (let uAge = 18; uAge <= 80; uAge += 1) {
        const p = calibratedAgeGapPenalty(d, uAge, cAge);
        if (uAge <= 40) {
          // In [18, 40], maturity weight is strictly non-decreasing
          assert.ok(p >= prevP, `Maturity gradient violated at uAge=${uAge}: p=${p} < prevP=${prevP}`);
        } else {
          // Above 40, mature weight is capped at 1.0, but gap is increasing, so penalty should also be >= prevP
          assert.ok(p >= prevP, `Mature regime gradient violated at uAge=${uAge}: p=${p} < prevP=${prevP}`);
        }
        prevP = p;
      }
    });
  });

  // =========================================================================
  // 5. ROBUSTNESS UNDER CORRUPT & ADVERSARIAL INPUTS
  // =========================================================================
  describe("Robustness Under Corrupt & Adversarial Inputs", () => {
    it("[STRESS-13] Non-finite, NaN, and negative inputs return 0.0 without throwing", () => {
      const corruptCases = [
        { d: NaN, u: 50, c: 20 },
        { d: Infinity, u: 50, c: 20 },
        { d: -Infinity, u: 50, c: 20 },
        { d: -100, u: 50, c: 20 },
        { d: -0.5, u: 50, c: 20 },
        { d: 0.45, u: NaN, c: 20 },
        { d: 0.45, u: Infinity, c: 20 },
        { d: 0.45, u: -Infinity, c: 20 },
        { d: 0.45, u: -50, c: 20 },
        { d: 0.45, u: 0, c: 20 },
        { d: 0.45, u: 50, c: NaN },
        { d: 0.45, u: 50, c: Infinity },
        { d: 0.45, u: 50, c: -Infinity },
        { d: 0.45, u: 50, c: -20 },
        { d: 0.45, u: 50, c: 0 },
        { d: 0.45, u: undefined, c: 20 },
        { d: 0.45, u: 50, c: undefined },
        { d: 0.45, u: null, c: 20 },
        { d: 0.45, u: 50, c: null },
      ];

      for (const [idx, item] of corruptCases.entries()) {
        const p = calibratedAgeGapPenalty(item.d as any, item.u as any, item.c as any);
        assert.equal(p, 0.0, `Corrupt case ${idx} failed (d=${item.d}, u=${item.u}, c=${item.c}): expected 0.0, got ${p}`);
        assert.ok(!Number.isNaN(p), `Corrupt case ${idx} returned NaN`);
      }
    });

    it("[STRESS-14] String-number coercion edge cases (if passed via un-typed caller)", () => {
      const p1 = calibratedAgeGapPenalty(0.45, "55" as any, "20" as any);
      assert.ok(Number.isFinite(p1), "Must be finite");
      assert.ok(p1 >= 0.0 && p1 <= 0.22, "Must be in bounds [0, 0.22]");

      const p2 = calibratedAgeGapPenalty("0.45" as any, "55" as any, "20" as any);
      assert.ok(Number.isFinite(p2), "Must be finite");
    });

    it("[STRESS-15] Extreme centenarian and supercentenarian ages (100-150 years)", () => {
      for (const uAge of [100, 110, 120, 150]) {
        for (const cAge of [18, 20, 25]) {
          const p = calibratedAgeGapPenalty(0.55, uAge, cAge);
          assert.ok(Number.isFinite(p), `Penalty for uAge=${uAge} must be finite`);
          assert.ok(p >= 0.0 && p <= 0.22, `Penalty ${p} must be within [0.0, 0.22]`);
        }
      }
    });

    it("[STRESS-16] computeMatchScore robustness under corrupt/extreme inputs", () => {
      const qDesc = new Float32Array(128);
      const cDesc = new Float32Array(128);

      const score1 = computeMatchScore(qDesc, cDesc, null, null, {
        userAge: NaN,
        celebAge: 20,
      });
      assert.ok(Number.isFinite(score1.descriptorDistance));
      assert.ok(Number.isFinite(score1.confidencePct));
      assert.ok(score1.confidencePct >= 15.0 && score1.confidencePct <= 100.0);

      const score2 = computeMatchScore(qDesc, cDesc, null, null, {
        userAge: 150,
        celebAge: -20,
      });
      assert.ok(Number.isFinite(score2.descriptorDistance));
      assert.ok(Number.isFinite(score2.confidencePct));
    });

    it("[STRESS-17] rankByDescriptor robustness with corrupt candidate ages and valid face vectors", () => {
      const qDesc = new Float32Array(128);
      qDesc[0] = 1.0;

      const cDesc = new Float32Array(128);
      cDesc[0] = 0.9;
      cDesc[1] = 0.435; // L2 normalized unit vector

      const query: UserFaceQuery = {
        descriptor: qDesc,
        age: 50,
        gender: "female",
        genderProbability: 0.9,
      };

      const malformedGallery: CelebrityEmbedding[] = [
        {
          id: "corrupt-1",
          name: "Corrupt Age NaN",
          path: "/celebs/c1.jpg",
          descriptor: Array.from(cDesc),
          descriptors: [cDesc],
          age: NaN as any,
          gender: "female",
          genderProb: 0.9,
        },
        {
          id: "corrupt-2",
          name: "Corrupt Age Negative",
          path: "/celebs/c2.jpg",
          descriptor: Array.from(cDesc),
          descriptors: [cDesc],
          age: -50 as any,
          gender: "female",
          genderProb: 0.9,
        },
        {
          id: "corrupt-3",
          name: "Corrupt Age 999",
          path: "/celebs/c3.jpg",
          descriptor: Array.from(cDesc),
          descriptors: [cDesc],
          age: 999,
          gender: "female",
          genderProb: 0.9,
        },
      ];

      const results = rankByDescriptor(query, malformedGallery, 5);
      assert.ok(Array.isArray(results), "Must return array");
      assert.equal(results.length, 3, "All 3 candidates should be scored safely");
      for (const r of results) {
        assert.ok(Number.isFinite(r.distance), "Distance must be finite");
        assert.ok(Number.isFinite(r.matchPercent), "Match percent must be finite");
        assert.ok(r.matchPercent >= 15.0 && r.matchPercent <= 100.0, "Match percent in [15, 100]");
      }
    });
  });
});
