import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
  l2Normalize,
  distanceToMatchPercent,
  rankPercentsFromDistances,
  ageAffinity,
  genderAffinity,
  computeMatchConfidence,
  type CelebrityEmbedding,
} from "./embeddings.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";

describe("M4 Challenger Empirical Stress Suite - Calibration & Matching Math", () => {
  describe("1. distanceToMatchPercent Mathematical Properties", () => {
    it("returns exactly 100.0 at distance d = 0", () => {
      const res = distanceToMatchPercent(0);
      assert.equal(res, 100.0, `Expected 100.0 at d=0, got ${res}`);
    });

    it("evaluates Hill Equation exact value at half-saturation threshold d = 0.38", () => {
      // P(0.38) = 100.0 / (1 + (0.38/0.38)^4.5) = 100.0 / 2 = 50.0
      const res = distanceToMatchPercent(0.38);
      assert.equal(res, 50.0, `Expected 50.0 at d=0.38, got ${res}`);
    });

    it("verifies strict monotonicity for fine distance steps across [0, 3.0]", () => {
      let prev = distanceToMatchPercent(0);
      for (let d = 0.001; d <= 3.0; d += 0.001) {
        const curr = distanceToMatchPercent(d);
        assert.ok(
          curr <= prev,
          `Monotonicity violation at d=${d}: p(${d - 0.001})=${prev} < p(${d})=${curr}`,
        );
        prev = curr;
      }
    });

    it("verifies unrounded Hill curve continuous derivative is strictly negative for d > 0", () => {
      // hill(d) = 100 / (1 + (d/0.38)^4.5)
      for (let d = 0.01; d <= 2.0; d += 0.05) {
        const hill1 = 100.0 / (1 + Math.pow(d / 0.38, 4.5));
        const hill2 = 100.0 / (1 + Math.pow((d + 1e-5) / 0.38, 4.5));
        assert.ok(hill2 < hill1, `Hill curve derivative not strictly negative at d=${d}`);
      }
    });

    it("enforces strict lower and upper percentage boundaries [0.0, 100.0]", () => {
      const distancesToTest = [
        0, 1e-10, 0.1, 0.3, 0.38, 0.58, 0.8, 1.0, 1.5, 2.0, 5.0, 100.0, 1e6, Infinity,
      ];
      for (const d of distancesToTest) {
        const pct = distanceToMatchPercent(d);
        assert.ok(!Number.isNaN(pct), `Returned NaN for d=${d}`);
        assert.ok(Number.isFinite(pct), `Returned non-finite for d=${d}`);
        assert.ok(pct >= 0.0, `Percentage ${pct} below 0.0 minimum boundary for d=${d}`);
        assert.ok(pct <= 100.0, `Percentage ${pct} above 100.0 maximum boundary for d=${d}`);
      }
    });

    it("handles negative and extreme input distances gracefully", () => {
      assert.equal(distanceToMatchPercent(-1.0), 100.0);
      assert.equal(distanceToMatchPercent(-Infinity), 100.0);
      assert.equal(distanceToMatchPercent(Infinity), 0.0);
      assert.equal(distanceToMatchPercent(Number.MAX_VALUE), 0.0);
      assert.equal(distanceToMatchPercent(Number.MIN_VALUE), 100.0);
    });

    it("checks NaN input behavior", () => {
      const res = distanceToMatchPercent(NaN);
      // Documenting empirical behavior for NaN
      const isNaNRes = Number.isNaN(res);
      console.log(`[EMPIRICAL TEST] distanceToMatchPercent(NaN) = ${res} (isNaN: ${isNaNRes})`);
    });
  });

  describe("2. computeMatchConfidence Quality & Prior Weighting", () => {
    it("returns minimum rating 10.0 for worst possible quality metrics (0, 0, 0, 0)", () => {
      const res = computeMatchConfidence(0, 0, 0, 0);
      assert.equal(res, 10.0, `Expected 10.0, got ${res}`);
    });

    it("returns maximum rating 100.0 for ideal quality metrics (1.0, 1.0, 0.25, 1.0)", () => {
      const res = computeMatchConfidence(1.0, 1.0, 0.25, 1.0);
      assert.equal(res, 100.0, `Expected 100.0, got ${res}`);
    });

    it("correctly handles percentage scale inputs (0..100) vs normalized inputs (0..1)", () => {
      const resNorm = computeMatchConfidence(0.92, 0.80, 0.20, 0.95);
      const resPct = computeMatchConfidence(92, 80, 0.20, 95);
      assert.equal(resNorm, resPct, `Expected percentage and decimal inputs to match: ${resNorm} vs ${resPct}`);
    });

    it("strictly clamps output score to range [10.0, 100.0]", () => {
      const overSaturated = computeMatchConfidence(500, 500, 100, 500);
      assert.equal(overSaturated, 100.0);

      const underSaturated = computeMatchConfidence(-100, -100, -50, -100);
      assert.equal(underSaturated, 10.0);
    });

    it("verifies linear weight contributions of detConfidence, sharpness, faceCoverage, and genderProb", () => {
      // Base: (0.5, 0.5, 0.125, 0.5)
      // weight formula: 0.35 * det + 0.25 * sharp + 0.20 * cov + 0.20 * gProb
      // cov = faceCoverage / 0.25 => for faceCoverage=0.125, cov=0.5
      const base = computeMatchConfidence(0.5, 0.5, 0.125, 0.5);
      const higherDet = computeMatchConfidence(0.9, 0.5, 0.125, 0.5);
      const higherSharp = computeMatchConfidence(0.5, 0.9, 0.125, 0.5);
      const higherCov = computeMatchConfidence(0.5, 0.5, 0.225, 0.5);
      const higherGProb = computeMatchConfidence(0.5, 0.5, 0.125, 0.9);

      assert.ok(higherDet > base, "higher detConfidence should increase confidence score");
      assert.ok(higherSharp > base, "higher sharpness should increase confidence score");
      assert.ok(higherCov > base, "higher faceCoverage should increase confidence score");
      assert.ok(higherGProb > base, "higher genderProb should increase confidence score");

      // Verify relative weighting: detConfidence (0.35) > sharpness (0.25) > faceCoverage (0.20) = genderProb (0.20)
      assert.ok(higherDet > higherSharp, "detConfidence weight (0.35) > sharpness weight (0.25)");
      assert.ok(higherSharp > higherCov, "sharpness weight (0.25) > faceCoverage weight (0.20)");
      assert.equal(higherCov, higherGProb, "faceCoverage weight (0.20) == genderProb weight (0.20)");
    });

    it("checks NaN input behavior in computeMatchConfidence", () => {
      const res = computeMatchConfidence(NaN, 0.8, 0.2, 0.9);
      console.log(`[EMPIRICAL TEST] computeMatchConfidence(NaN, 0.8, 0.2, 0.9) = ${res}`);
    });
  });

  describe("3. Continuous Gaussian Age Affinity", () => {
    it("returns 1.0 when userAge === celebAge", () => {
      assert.equal(ageAffinity(20, 20), 1.0);
      assert.equal(ageAffinity(45, 45), 1.0);
      assert.equal(ageAffinity(80, 80), 1.0);
    });

    it("is strictly symmetric with respect to age order", () => {
      for (let u = 18; u <= 70; u += 5) {
        for (let c = 18; c <= 70; c += 5) {
          assert.equal(
            ageAffinity(u, c),
            ageAffinity(c, u),
            `Symmetry failure for ages (${u}, ${c})`,
          );
        }
      }
    });

    it("decays smoothly as Gaussian exp(-(|delta|/28)^2)", () => {
      const a0 = ageAffinity(30, 30);
      const a5 = ageAffinity(30, 35);
      const a10 = ageAffinity(30, 40);
      const a20 = ageAffinity(30, 50);
      const a28 = ageAffinity(30, 58); // delta = 28 -> exp(-1) ≈ 0.367879
      const a56 = ageAffinity(30, 86); // delta = 56 -> exp(-4) ≈ 0.018315

      assert.equal(a0, 1.0);
      assert.ok(a0 > a5);
      assert.ok(a5 > a10);
      assert.ok(a10 > a20);
      assert.ok(a20 > a28);
      assert.ok(a28 > a56);

      assert.ok(Math.abs(a28 - Math.exp(-1)) < 1e-6, `Expected ~exp(-1) at delta=28, got ${a28}`);
      assert.ok(Math.abs(a56 - Math.exp(-4)) < 1e-6, `Expected ~exp(-4) at delta=56, got ${a56}`);
    });

    it("remains bounded in (0.0, 1.0] even for extreme age differences", () => {
      const extreme1 = ageAffinity(0, 120);
      const extreme2 = ageAffinity(-50, 500);
      assert.ok(extreme1 > 0 && extreme1 <= 1.0, `Extreme age affinity out of bounds: ${extreme1}`);
      assert.ok(extreme2 > 0 && extreme2 <= 1.0, `Extreme age affinity out of bounds: ${extreme2}`);
    });
  });

  describe("4. Gender Prior Weighting & Gender Affinity", () => {
    const mockMaleCeleb: CelebrityEmbedding = {
      id: "male-celeb",
      name: "Male Celeb",
      path: "/male.webp",
      descriptor: new Array(128).fill(0),
      age: 30,
      gender: "male",
      genderProb: 0.99,
    };
    const mockFemaleCeleb: CelebrityEmbedding = {
      id: "female-celeb",
      name: "Female Celeb",
      path: "/female.webp",
      descriptor: new Array(128).fill(0),
      age: 30,
      gender: "female",
      genderProb: 0.99,
    };

    it("returns 1.0 when userGender is unknown", () => {
      assert.equal(genderAffinity("unknown", 0.99, mockMaleCeleb), 1.0);
      assert.equal(genderAffinity("unknown", 0.10, mockFemaleCeleb), 1.0);
    });

    it("returns 1.0 when userGender matches celeb.gender", () => {
      assert.equal(genderAffinity("male", 0.95, mockMaleCeleb), 1.0);
      assert.equal(genderAffinity("female", 0.95, mockFemaleCeleb), 1.0);
    });

    it("applies smooth linear penalty 1 - 0.22*prob bounded in [0.75, 1.0] when genders differ", () => {
      const gLowConf = genderAffinity("female", 0.50, mockMaleCeleb); // 1 - 0.22*0.5 = 0.89
      const gHighConf = genderAffinity("female", 1.00, mockMaleCeleb); // 1 - 0.22*1.0 = 0.78

      assert.equal(gLowConf, 0.89);
      assert.equal(gHighConf, 0.78);
      assert.ok(gLowConf > gHighConf, "Higher gender probability on cross-gender should result in lower affinity factor");
    });

    it("clamps out-of-range userProb values for cross-gender affinity", () => {
      const gOver = genderAffinity("female", 1.5, mockMaleCeleb);
      const gUnder = genderAffinity("female", -0.5, mockMaleCeleb);

      assert.equal(gOver, 0.78);
      assert.equal(gUnder, 1.0);
    });
  });

  describe("5. rankPercentsFromDistances Ordering & Distances", () => {
    it("handles empty distance array", () => {
      assert.deepEqual(rankPercentsFromDistances([]), []);
    });

    it("preserves strict ranking order for distinct distances", () => {
      const dists = [0.7, 0.35, 0.55];
      const pcts = rankPercentsFromDistances(dists);

      // dists[1] = 0.35 is smallest distance -> highest percent
      // dists[2] = 0.55 is middle -> middle percent
      // dists[0] = 0.70 is largest distance -> lowest percent
      assert.ok(pcts[1]! > pcts[2]!, `Expected p[1] (${pcts[1]}) > p[2] (${pcts[2]})`);
      assert.ok(pcts[2]! > pcts[0]!, `Expected p[2] (${pcts[2]}) > p[0] (${pcts[0]})`);
    });

    it("ensures no percentage is below 0.0 or above 100.0", () => {
      const dists = [0.0, 0.2, 0.5, 1.0, 2.0, 10.0];
      const pcts = rankPercentsFromDistances(dists);
      for (const p of pcts) {
        assert.ok(p >= 0.0 && p <= 100.0, `Percent out of bounds: ${p}`);
      }
    });
  });

  describe("6. Vector Distance Metrics (Euclidean, Cosine, Ensemble, L2Norm)", () => {
    it("normalizes zero-vector without throwing or producing NaNs", () => {
      const zeroVec = new Float32Array(128).fill(0);
      const norm = l2Normalize(zeroVec);
      assert.equal(norm.length, 128);
      for (const val of norm) {
        assert.equal(val, 0);
        assert.ok(!Number.isNaN(val));
      }
    });

    it("computes euclideanDistance correctly for identical and distinct vectors", () => {
      const v1 = [1, 2, 3];
      const v2 = [1, 2, 3];
      const v3 = [4, 6, 3];
      assert.equal(euclideanDistance(v1, v2), 0);
      assert.equal(euclideanDistance(v1, v3), 5); // sqrt((4-1)^2 + (6-2)^2 + 0) = 5
    });

    it("computes cosineDistance correctly in [0, 2]", () => {
      const v1 = [1, 0, 0];
      const v2 = [1, 0, 0];
      const v3 = [0, 1, 0];
      const v4 = [-1, 0, 0];

      assert.equal(cosineDistance(v1, v2), 0); // Identical
      assert.equal(cosineDistance(v1, v3), 1); // Orthogonal
      assert.equal(cosineDistance(v1, v4), 2); // Opposite
    });

    it("computes ensembleDistance as weighted sum 0.72*euc + 0.28*cos*0.85", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];
      const euc = Math.sqrt(2); // ≈ 1.41421356
      const cos = 1.0;
      const expected = 0.72 * euc + 0.28 * (cos * 0.85);

      const actual = ensembleDistance(v1, v2);
      assert.ok(Math.abs(actual - expected) < 1e-6, `Expected ${expected}, got ${actual}`);
    });
  });

  describe("7. End-to-End Pipeline Stress Test with rankByDescriptor", () => {
    it("executes rankByDescriptor without error and returns valid MatchResult properties", () => {
      const userVec = Float32Array.from(l2Normalize(new Array(128).fill(0.1)));
      const celebVec1 = Float32Array.from(l2Normalize(new Array(128).fill(0.12)));
      const celebVec2 = Float32Array.from(l2Normalize(new Array(128).fill(0.40)));

      const query: UserFaceQuery = {
        descriptor: userVec,
        age: 28,
        gender: "female",
        genderProbability: 0.95,
        detConfidence: 0.98,
        sharpness: 85,
        faceCoverage: 0.22,
      };

      const gallery: CelebrityEmbedding[] = [
        {
          id: "celeb-1",
          name: "Celeb One",
          path: "/celeb1.webp",
          descriptor: Array.from(celebVec1),
          age: 27,
          gender: "female",
          genderProb: 0.99,
        },
        {
          id: "celeb-2",
          name: "Celeb Two",
          path: "/celeb2.webp",
          descriptor: Array.from(celebVec2),
          age: 45,
          gender: "male",
          genderProb: 0.90,
        },
      ];

      const results = rankByDescriptor(query, gallery, 2);
      assert.equal(results.length, 2);

      for (const res of results) {
        assert.ok(!Number.isNaN(res.matchPercent), `matchPercent is NaN for ${res.name}`);
        assert.ok(res.matchPercent >= 15.0 && res.matchPercent <= 100.0, `matchPercent out of bounds: ${res.matchPercent}`);
        assert.ok(res.confidenceScore !== undefined && !Number.isNaN(res.confidenceScore), `confidenceScore is NaN or undefined for ${res.name}`);
        assert.ok(res.confidenceScore! >= 10.0 && res.confidenceScore! <= 100.0, `confidenceScore out of bounds: ${res.confidenceScore}`);
        assert.equal(res.traits.length, 4);

        for (const trait of res.traits) {
          assert.ok(!Number.isNaN(trait.similarity), `Trait ${trait.label} similarity is NaN`);
          assert.ok(trait.similarity >= 0 && trait.similarity <= 1, `Trait ${trait.label} similarity out of range [0,1]: ${trait.similarity}`);
        }
      }

      // Top result should be celeb-1 due to lower vector distance + age/gender affinity
      assert.equal(results[0]?.celebrityId, "celeb-1");
    });
  });
});
