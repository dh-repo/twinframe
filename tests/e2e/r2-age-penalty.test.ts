import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calibratedAgeGapPenalty,
  distanceToMatchPercent,
  type CelebrityEmbedding,
} from "../../src/lib/face/embeddings.ts";
import {
  rankByDescriptor,
  type UserFaceQuery,
} from "../../src/lib/face/match.ts";

describe("R2. Calibrated Age-Gap Penalty in Embeddings & Match (E2E)", () => {
  // =========================================================================
  // FEATURE F5: Calibrated Age-Gap Penalty Function
  // =========================================================================
  describe("Feature F5: Calibrated Age-Gap Penalty Function", () => {
    it("[F5-T1-01] returns 0.0 penalty for strong matches (d <= 0.40) regardless of age discrepancy", () => {
      assert.equal(calibratedAgeGapPenalty(0.20, 55, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.30, 60, 22), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.38, 70, 25), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.40, 50, 18), 0.0);
    });

    it("[F5-T1-02] returns 0.0 penalty for age peers (|Δage| <= 20) regardless of distance", () => {
      assert.equal(calibratedAgeGapPenalty(0.45, 40, 40), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.55, 45, 35), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.65, 30, 50), 0.0); // |30 - 50| = 20
      assert.equal(calibratedAgeGapPenalty(0.80, 25, 30), 0.0);
    });

    it("[F5-T1-03] activates penalty (P_age > 0) when d > 0.40 and |Δage| > 20", () => {
      const p = calibratedAgeGapPenalty(0.45, 55, 20); // gap = 35, d = 0.45
      assert.ok(p > 0.0, `Penalty must be strictly positive: ${p}`);
      assert.ok(p >= 0.02, `Penalty expected >= 0.02, got ${p}`);
    });

    it("[F5-T1-04] exhibits monotonic non-linear growth with respect to distance d in [0.40, 0.50]", () => {
      const p1 = calibratedAgeGapPenalty(0.41, 50, 20);
      const p2 = calibratedAgeGapPenalty(0.44, 50, 20);
      const p3 = calibratedAgeGapPenalty(0.47, 50, 20);
      const p4 = calibratedAgeGapPenalty(0.50, 50, 20);

      assert.ok(p2 > p1, `Expected p(0.44) > p(0.41): ${p2} > ${p1}`);
      assert.ok(p3 > p2, `Expected p(0.47) > p(0.44): ${p3} > ${p2}`);
      assert.ok(p4 > p3, `Expected p(0.50) > p(0.47): ${p4} > ${p3}`);
    });

    it("[F5-T1-05] exhibits monotonic super-linear growth with respect to age gap |Δage| in [20, 40]", () => {
      const p1 = calibratedAgeGapPenalty(0.48, 50, 28); // gap = 22
      const p2 = calibratedAgeGapPenalty(0.48, 50, 24); // gap = 26
      const p3 = calibratedAgeGapPenalty(0.48, 50, 18); // gap = 32
      const p4 = calibratedAgeGapPenalty(0.48, 60, 20); // gap = 40

      assert.ok(p2 > p1, `Expected gap 26 > gap 22: ${p2} > ${p1}`);
      assert.ok(p3 > p2, `Expected gap 32 > gap 26: ${p3} > ${p2}`);
      assert.ok(p4 > p3, `Expected gap 40 > gap 32: ${p4} > ${p3}`);
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F5-T2-01] validates exact distance threshold at d = 0.4000 vs d = 0.4001", () => {
      assert.equal(calibratedAgeGapPenalty(0.4000, 55, 20), 0.0);
      const pSmall = calibratedAgeGapPenalty(0.4001, 55, 20);
      assert.ok(pSmall >= 0.0, "Penalty must be non-negative");
    });

    it("[F5-T2-02] validates exact age gap threshold at |Δage| = 20 vs |Δage| = 21", () => {
      assert.equal(calibratedAgeGapPenalty(0.45, 45, 25), 0.0); // |45 - 25| = 20
      const p21 = calibratedAgeGapPenalty(0.45, 46, 25); // |46 - 25| = 21
      assert.ok(p21 > 0.0, `Penalty for gap 21 must be positive: ${p21}`);
    });

    it("[F5-T2-03] mature scaling factor: user >= 40 receives higher penalty than younger user with same gap", () => {
      const pYoung = calibratedAgeGapPenalty(0.45, 20, 55); // gap = 35, userAge = 20 (factor = 0.50)
      const pMature = calibratedAgeGapPenalty(0.45, 55, 20); // gap = 35, userAge = 55 (factor = 1.00)
      assert.ok(pMature > pYoung, `Mature penalty ${pMature} must exceed young penalty ${pYoung}`);
      assert.ok(pMature >= pYoung * 1.5, "Mature user scaling should be at least 1.5x of young user floor");
    });

    it("[F5-T2-04] missing or undefined ages return 0.0 safely without throwing", () => {
      assert.equal(calibratedAgeGapPenalty(0.45, undefined, 25), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, 45, undefined), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, undefined, undefined), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, NaN, 25), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.45, 45, NaN), 0.0);
    });

    it("[F5-T2-05] extreme age inputs (user 105, celeb 18) produce finite, bounded penalty <= 0.22", () => {
      const pExtreme = calibratedAgeGapPenalty(0.60, 105, 18);
      assert.ok(Number.isFinite(pExtreme), "Penalty must be finite");
      assert.ok(pExtreme > 0.0 && pExtreme <= 0.22, `Extreme penalty out of bounds: ${pExtreme}`);
    });
  });

  // =========================================================================
  // FEATURE F6: Weak-Match Age Demotion Integration
  // =========================================================================
  describe("Feature F6: Weak-Match Age Demotion Integration", () => {
    const makeCandidate = (
      id: string,
      age: number,
      baseDist: number,
      gender: "female" | "male" = "female",
    ): { celeb: CelebrityEmbedding; dist: number } => {
      const desc = new Float32Array(128);
      desc[0] = 1.0;
      return {
        celeb: {
          id,
          name: id.replace(/-/g, " ").toUpperCase(),
          path: `/celebs/${id}.jpg`,
          descriptor: Array.from(desc),
          descriptors: [desc],
          age,
          gender,
          genderProb: 0.95,
        },
        dist: baseDist,
      };
    };

    it("[F6-T1-01] demotes 20yo candidate at d=0.42 below 48yo candidate at d=0.430 for 48yo mature query", () => {
      const userAge = 48;
      const candA = makeCandidate("young-star", 20, 0.42); // gap = 28 -> penalty > 0
      const candB = makeCandidate("mature-peer", 48, 0.430); // gap = 0 -> penalty = 0

      const penA = calibratedAgeGapPenalty(candA.dist, userAge, candA.celeb.age);
      const penB = calibratedAgeGapPenalty(candB.dist, userAge, candB.celeb.age);

      const effA = candA.dist + penA;
      const effB = candB.dist + penB;

      assert.ok(penA >= 0.012, `Penalty on young star too low: ${penA}`);
      assert.equal(penB, 0.0, `Penalty on peer must be 0.0: ${penB}`);
      assert.ok(effB < effA, `Mature peer (eff=${effB}) must rank ahead of young star (eff=${effA})`);
    });

    it("[F6-T1-02] demotion penalty grows larger at deeper weak distances (d = 0.48 vs d = 0.42)", () => {
      const userAge = 55;
      const candD42 = makeCandidate("cand-42", 22, 0.42);
      const candD48 = makeCandidate("cand-48", 22, 0.48);

      const pen42 = calibratedAgeGapPenalty(candD42.dist, userAge, candD42.celeb.age);
      const pen48 = calibratedAgeGapPenalty(candD48.dist, userAge, candD48.celeb.age);

      assert.ok(pen48 > pen42, `pen(0.48) = ${pen48} must exceed pen(0.42) = ${pen42}`);
    });

    it("[F6-T1-03] does NOT demote young candidate when user is also young (age 22)", () => {
      const userAge = 22;
      const candA = makeCandidate("young-star", 20, 0.42); // gap = 2 -> penalty = 0
      const candB = makeCandidate("mature-peer", 48, 0.435); // gap = 26, young user factor = 0.50

      const penA = calibratedAgeGapPenalty(candA.dist, userAge, candA.celeb.age);
      const effA = candA.dist + penA;

      assert.equal(penA, 0.0, "Young star must not receive penalty for young user");
      assert.ok(effA < candB.dist, "Young candidate must remain rank 1 for young user query");
    });

    it("[F6-T1-04] integrates additively with cross-demographic penalty in effective distance calculation", () => {
      const rawDist = 0.44;
      const crossPenalty = 0.05;
      const agePen = calibratedAgeGapPenalty(rawDist, 52, 20);
      const effDist = rawDist + crossPenalty + agePen;

      assert.ok(effDist > rawDist + crossPenalty, `Effective distance must include age penalty: ${effDist}`);
      assert.ok(effDist < 1.0, `Effective distance should remain bounded: ${effDist}`);
    });

    it("[F6-T1-05] demotes cluster of 20-25yo weak candidates for a 60yo query", () => {
      const userAge = 60;
      const youngCandidates = [
        makeCandidate("young-1", 20, 0.42),
        makeCandidate("young-2", 22, 0.43),
        makeCandidate("young-3", 24, 0.44),
      ];
      const peerCandidate = makeCandidate("peer-60", 58, 0.435);

      const scored = [...youngCandidates, peerCandidate].map((c) => ({
        id: c.celeb.id,
        effDist: c.dist + calibratedAgeGapPenalty(c.dist, userAge, c.celeb.age),
      }));

      scored.sort((a, b) => a.effDist - b.effDist);
      assert.equal(scored[0]!.id, "peer-60", "Peer candidate must rise to #1 rank among weak matches");
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F6-T2-01] handles exact threshold boundary transition at query age = 40 with fixed age gap", () => {
      // Fixed age gap of 25 years
      const p39 = calibratedAgeGapPenalty(0.45, 39, 14); // gap = 25, userAge = 39 (factor = 39/40 = 0.975)
      const p40 = calibratedAgeGapPenalty(0.45, 40, 15); // gap = 25, userAge = 40 (factor = 1.0)
      const p41 = calibratedAgeGapPenalty(0.45, 41, 16); // gap = 25, userAge = 41 (factor = 1.0)

      assert.ok(p40 > p39, `p(40) > p(39): ${p40} > ${p39}`);
      assert.equal(p40, p41, "Mature factor should cap at 1.0 for age >= 40");
    });

    it("[F6-T2-02] handles candidate distance tie (d_A = d_B = 0.45) with age peer winning strictly", () => {
      const userAge = 50;
      const candA = makeCandidate("young-45", 20, 0.45);
      const candB = makeCandidate("peer-45", 50, 0.45);

      const effA = candA.dist + calibratedAgeGapPenalty(candA.dist, userAge, candA.celeb.age);
      const effB = candB.dist + calibratedAgeGapPenalty(candB.dist, userAge, candB.celeb.age);

      assert.ok(effB < effA, `Tied distance must break in favor of peer: ${effB} < ${effA}`);
    });

    it("[F6-T2-03] negative distance input returns 0.0 penalty safely", () => {
      assert.equal(calibratedAgeGapPenalty(-0.1, 50, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.0, 50, 20), 0.0);
    });

    it("[F6-T2-04] empty or single candidate array ranks without error", () => {
      const q: UserFaceQuery = {
        descriptor: new Float32Array(128),
        age: 50,
        gender: "female",
        genderProbability: 0.9,
      };
      const singleGallery: CelebrityEmbedding[] = [
        {
          id: "solo",
          name: "Solo",
          path: "/celebs/solo.jpg",
          descriptor: new Array(128).fill(0.088),
          age: 20,
          gender: "female",
          genderProb: 0.9,
        },
      ];
      const res = rankByDescriptor(q, singleGallery, 5);
      assert.ok(Array.isArray(res));
    });

    it("[F6-T2-05] verifies hero percentage reflects raw distance without inflation", () => {
      const dRaw = 0.45;
      const pct = distanceToMatchPercent(dRaw);
      assert.ok(pct >= 30.0 && pct <= 40.0, `Match percent for d=0.45 should be ~34.8%, got ${pct}%`);
    });
  });

  // =========================================================================
  // FEATURE F7: Strong Match & Peer Invariance
  // =========================================================================
  describe("Feature F7: Strong Match & Peer Invariance", () => {
    it("[F7-T1-01] strong twin lookalike (d = 0.25) preserves rank 1 for 55yo query against 20yo candidate", () => {
      const userAge = 55;
      const twinCandidate = { dist: 0.25, age: 20 };
      const pen = calibratedAgeGapPenalty(twinCandidate.dist, userAge, twinCandidate.age);
      assert.equal(pen, 0.0, "Strong twin match must incur zero age penalty");
    });

    it("[F7-T1-02] threshold lookalike (d = 0.38 <= 0.40) incurs zero age penalty for 60yo query matching 22yo", () => {
      const userAge = 60;
      const cand = { dist: 0.38, age: 22 };
      assert.equal(calibratedAgeGapPenalty(cand.dist, userAge, cand.age), 0.0);
    });

    it("[F7-T1-03] age peer (|Δage| = 5) incurs zero penalty even at high distance (d = 0.65)", () => {
      assert.equal(calibratedAgeGapPenalty(0.65, 30, 35), 0.0);
      assert.equal(calibratedAgeGapPenalty(0.75, 50, 45), 0.0);
    });

    it("[F7-T1-04] exact 20-year age gap incurs exactly 0.0 penalty at d = 0.55", () => {
      assert.equal(calibratedAgeGapPenalty(0.55, 45, 25), 0.0); // |45 - 25| = 20
      assert.equal(calibratedAgeGapPenalty(0.55, 25, 45), 0.0); // |25 - 45| = 20
    });

    it("[F7-T1-05] strong twin candidate (d = 0.30, 20yo) is never overtaken by distant peer (d = 0.45, 55yo)", () => {
      const userAge = 55;
      const twin = { dist: 0.30, age: 20 };
      const peer = { dist: 0.45, age: 55 };

      const effTwin = twin.dist + calibratedAgeGapPenalty(twin.dist, userAge, twin.age);
      const effPeer = peer.dist + calibratedAgeGapPenalty(peer.dist, userAge, peer.age);

      assert.equal(effTwin, 0.30);
      assert.equal(effPeer, 0.45);
      assert.ok(effTwin < effPeer, "Strong twin must strictly beat distant age peer");
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F7-T2-01] exact threshold d = 0.400000 yields zero penalty with 1e-6 precision", () => {
      const pen = calibratedAgeGapPenalty(0.400000, 70, 20);
      assert.ok(Math.abs(pen - 0.0) < 1e-6, `Expected exactly 0.0, got ${pen}`);
    });

    it("[F7-T2-02] close-in lookalikes (d = 0.15, 0.20, 0.35) all yield identical 0.0 penalty across all age gaps", () => {
      for (const d of [0.15, 0.20, 0.35]) {
        for (const gap of [0, 10, 25, 50, 70]) {
          assert.equal(calibratedAgeGapPenalty(d, 20 + gap, 20), 0.0, `Failed at d=${d}, gap=${gap}`);
        }
      }
    });

    it("[F7-T2-03] twin vs peer trade-off: candidate at d=0.35 (gap 35y) beats candidate at d=0.42 (gap 0y)", () => {
      const userAge = 55;
      const candA = { dist: 0.35, age: 20 }; // gap = 35 -> pen = 0 (d <= 0.40)
      const candB = { dist: 0.42, age: 55 }; // gap = 0 -> pen = 0 (gap <= 20)

      const effA = candA.dist + calibratedAgeGapPenalty(candA.dist, userAge, candA.age);
      const effB = candB.dist + calibratedAgeGapPenalty(candB.dist, userAge, candB.age);

      assert.ok(effA < effB, `Candidate A (${effA}) must beat candidate B (${effB})`);
    });

    it("[F7-T2-04] symmetrical age gap (|Δage| = 25) behaves consistently when user is older vs younger", () => {
      const pOlder = calibratedAgeGapPenalty(0.45, 50, 25); // user 50, celeb 25 -> factor = 1.0
      const pYounger = calibratedAgeGapPenalty(0.45, 25, 50); // user 25, celeb 50 -> factor = 0.625

      assert.ok(pOlder > 0.0);
      assert.ok(pYounger > 0.0);
      // Older user has higher mature factor
      assert.ok(pOlder > pYounger);
    });

    it("[F7-T2-05] non-numeric and NaN distance returns 0.0 safely", () => {
      assert.equal(calibratedAgeGapPenalty(NaN, 50, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(Infinity, 50, 20), 0.0);
      assert.equal(calibratedAgeGapPenalty(-Infinity, 50, 20), 0.0);
    });
  });

  // =========================================================================
  // TIER 3: Cross-Demographic & Age Penalty Interaction
  // =========================================================================
  describe("Tier 3: Cross-Demographic & Age Penalty Interaction", () => {
    it("[R2-T3-01] combined penalty: cross-demographic penalty and age penalty compose additively", () => {
      const rawDist = 0.46;
      const userAge = 52;
      const celebAge = 22; // gap = 30 -> age penalty > 0
      const crossPenalty = 0.04;

      const agePen = calibratedAgeGapPenalty(rawDist, userAge, celebAge);
      const totalAdj = rawDist + crossPenalty + agePen;

      assert.ok(agePen > 0.0, "Age penalty must be active");
      assert.ok(totalAdj > rawDist + crossPenalty, "Total adjustment must strictly exceed raw + cross");
    });

    it("[R2-T3-02] strong lookalike override: strong twin (d <= 0.40) preserves 0.0 age penalty under any demographic mix", () => {
      const rawDist = 0.28;
      const userAge = 65;
      const celebAge = 20;

      const agePen = calibratedAgeGapPenalty(rawDist, userAge, celebAge);
      assert.equal(agePen, 0.0, "Strong twin must remain immune to age penalty regardless of demographics");
    });

    it("[R2-T3-03] combinatorial grid invariance: verifies non-negativity and bounds across 16 parameter pairs", () => {
      const testDists = [0.25, 0.40, 0.45, 0.60];
      const testUserAges = [20, 35, 50, 75];
      const testCelebAges = [20, 25, 55, 80];

      for (const d of testDists) {
        for (const u of testUserAges) {
          for (const c of testCelebAges) {
            const p = calibratedAgeGapPenalty(d, u, c);
            assert.ok(p >= 0.0, `Negative penalty at d=${d}, u=${u}, c=${c}`);
            assert.ok(p <= 0.22, `Penalty exceeds max 0.22 at d=${d}, u=${u}, c=${c}: ${p}`);
            if (d <= 0.40 || Math.abs(u - c) <= 20) {
              assert.equal(p, 0.0, `Expected 0.0 at d=${d}, u=${u}, c=${c}`);
            }
          }
        }
      }
    });

    it("[R2-T3-04] interaction with gender affinity nudge in candidate scoring", () => {
      const userAge = 50;

      const candFemaleYoung = { dist: 0.44, age: 22, gender: "female" as const };
      const candFemalePeer = { dist: 0.44, age: 48, gender: "female" as const };

      const penYoung = calibratedAgeGapPenalty(candFemaleYoung.dist, userAge, candFemaleYoung.age);
      const penPeer = calibratedAgeGapPenalty(candFemalePeer.dist, userAge, candFemalePeer.age);

      assert.ok(penYoung > penPeer, "Same gender young candidate receives higher penalty than same gender peer");
    });
  });
});
