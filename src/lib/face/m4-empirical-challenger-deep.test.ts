import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ETHNIC_CLUSTERS,
  DEMOGRAPHIC_CLUSTER_MAP,
  getEthnicCluster,
  type EthnicCluster,
  type FaceFeatures,
  type CelebrityEmbedding,
} from "./types.ts";
import { crossDemographicMismatchPenalty, morphologicalDistance } from "./geometry.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";
import { distanceToMatchPercent, l2Normalize } from "./embeddings.ts";
import { emptyFeatures } from "./math.ts";
import { evaluateMatchAccuracy } from "../../../scripts/evaluate-match-accuracy.ts";

describe("M4 Empirical Challenger Deep Verification Suite", () => {
  describe("1. Ethnic Cluster Taxonomy & Resolution Logic (getEthnicCluster)", () => {
    it("verifies all 6 required ethnic clusters exist in ETHNIC_CLUSTERS", () => {
      const requiredClusters: EthnicCluster[] = [
        "East Asian",
        "South Asian",
        "African",
        "Caucasian",
        "Hispanic",
        "Middle Eastern",
      ];
      for (const req of requiredClusters) {
        assert.ok(
          ETHNIC_CLUSTERS.includes(req),
          `Missing required ethnic cluster: ${req}`
        );
      }
    });

    it("resolves age-bucketed IDs correctly by stripping trailing digits (e.g. jisoo-28 -> East Asian)", () => {
      const ageBucketTestCases = [
        { id: "jisoo-28", expected: "East Asian" },
        { id: "denzel-washington-55", expected: "African" },
        { id: "pedro-pascal-45", expected: "Hispanic" },
        { id: "priyanka-chopra-36", expected: "South Asian" },
        { id: "brad-pitt-59", expected: "Caucasian" },
        { id: "rami-malek-41", expected: "Middle Eastern" },
      ];

      for (const tc of ageBucketTestCases) {
        const resolved = getEthnicCluster({ id: tc.id });
        assert.equal(
          resolved,
          tc.expected,
          `Failed to resolve age-bucketed ID ${tc.id}: got ${resolved}, expected ${tc.expected}`
        );
      }
    });

    it("respects explicit ethnicCluster property override when provided", () => {
      const overrideObj = {
        id: "brad-pitt-59",
        ethnicCluster: "East Asian" as EthnicCluster,
      };
      assert.equal(getEthnicCluster(overrideObj), "East Asian");
    });

    it("handles canonicalization with uppercase and hyphenated IDs cleanly", () => {
      assert.equal(getEthnicCluster({ id: "JiSoo-28" }), "East Asian");
      assert.equal(getEthnicCluster({ id: "Denzel-Washington-55" }), "African");
      assert.equal(getEthnicCluster({ id: "PEDRO-PASCAL-45" }), "Hispanic");
    });

    it("triggers morphological feature heuristic fallback when ID is not in mapping", () => {
      // East Asian heuristic: eyeSlant > 0.58 && cheekboneProminence > 0.62
      const eastAsianFeat: FaceFeatures = {
        ...emptyFeatures(),
        cheekboneProminence: 0.65,
        eyeSlant: 0.60,
        skinL: 0.65,
        skinA: 0.1,
        skinB: 0.2,
      };
      assert.equal(
        getEthnicCluster({ id: "unknown-celeb-x999", features: eastAsianFeat }),
        "East Asian"
      );

      // African heuristic: skinL < 0.40
      const africanFeat: FaceFeatures = {
        ...eastAsianFeat,
        eyeSlant: 0.3,
        cheekboneProminence: 0.4,
        skinL: 0.30,
      };
      assert.equal(
        getEthnicCluster({ id: "unknown-celeb-x999", features: africanFeat }),
        "African"
      );

      // Caucasian heuristic: skinL > 0.72
      const caucasianFeat: FaceFeatures = {
        ...eastAsianFeat,
        eyeSlant: 0.3,
        cheekboneProminence: 0.4,
        skinL: 0.78,
      };
      assert.equal(
        getEthnicCluster({ id: "unknown-celeb-x999", features: caucasianFeat }),
        "Caucasian"
      );

      // Hispanic heuristic: skinB > 0.56 && skinL in [0.40, 0.68]
      const hispanicFeat: FaceFeatures = {
        ...eastAsianFeat,
        eyeSlant: 0.3,
        cheekboneProminence: 0.4,
        skinL: 0.55,
        skinB: 0.60,
      };
      assert.equal(
        getEthnicCluster({ id: "unknown-celeb-x999", features: hispanicFeat }),
        "Hispanic"
      );
    });

    it("falls back to default Caucasian when ID is unknown and features are missing/neutral", () => {
      assert.equal(getEthnicCluster({ id: "totally-unknown-id-12345" }), "Caucasian");
    });
  });

  describe("2. Cross-Demographic Penalty & Filtering (crossDemographicMismatchPenalty)", () => {
    it("returns 0 penalty when clusters match", () => {
      const p = crossDemographicMismatchPenalty(0.20, null, "East Asian", "East Asian");
      assert.equal(p, 0);
    });

    it("applies penalty floor of >= 0.22 when clusters differ and dMorph or features are present", () => {
      const clusters: EthnicCluster[] = [
        "East Asian",
        "South Asian",
        "African",
        "Caucasian",
        "Hispanic",
        "Middle Eastern",
      ];

      for (const c1 of clusters) {
        for (const c2 of clusters) {
          if (c1 !== c2) {
            const p = crossDemographicMismatchPenalty(0.15, null, c1, c2);
            assert.ok(
              p >= 0.22,
              `Penalty for cross-cluster pair (${c1}, ${c2}) should be >= 0.22, got ${p}`
            );
          }
        }
      }
    });

    it("increases penalty when morphological structural distance D_morph exceeds 0.35", () => {
      const pBase = crossDemographicMismatchPenalty(0.15, null, "Caucasian", "African");
      const pHighMorph = crossDemographicMismatchPenalty(0.82, null, "Caucasian", "African");

      assert.equal(pBase, 0.22, `Base penalty for dMorph=0.15 should be 0.22, got ${pBase}`);
      assert.ok(
        pHighMorph > pBase,
        `Penalty for high dMorph=0.82 (${pHighMorph}) should exceed base penalty (${pBase})`
      );
      assert.equal(pHighMorph, 0.235, `Expected 0.235 for dMorph=0.82, got ${pHighMorph}`);
    });
  });

  describe("3. Candidate Reranking & Lookalike Gate (rankByDescriptor)", () => {
    const dummyFeatures: FaceFeatures = {
      ...emptyFeatures(),
      cheekboneProminence: 0.65,
      eyeSlant: 0.60,
      skinL: 0.65,
      skinA: 0.1,
      skinB: 0.2,
    };

    it("strictly excludes distractor candidates whose fine distance (d + crossPenalty) > 0.40", () => {
      const userVec = l2Normalize(new Float32Array(128).fill(0.1));

      const user: UserFaceQuery = {
        descriptor: userVec,
        age: 30,
        gender: "female",
        genderProbability: 0.9,
        ethnicCluster: "East Asian",
        features: dummyFeatures,
      };

      // Candidate 1: Same cluster with raw distance ~0.15 -> accepted
      const sameClusterVec = new Float32Array(128).fill(0.1);
      sameClusterVec[0] = 0.2;
      const candAccepted: CelebrityEmbedding = {
        id: "cand-1",
        name: "Accepted Candidate",
        path: "/cand1.jpg",
        descriptor: Array.from(l2Normalize(sameClusterVec)),
        age: 30,
        gender: "female",
        genderProb: 0.9,
        ethnicCluster: "East Asian",
        features: dummyFeatures,
      };

      const resAccepted = rankByDescriptor(user, [candAccepted], 5);
      assert.equal(resAccepted.length, 1);

      // Candidate 2: Distinct vector (orthogonal entry) -> raw distance ~0.50 -> fine distance > 0.40 -> rejected as []
      const orthogonalVec = new Float32Array(128);
      orthogonalVec[0] = 1.0;
      const candRejected: CelebrityEmbedding = {
        id: "cand-2",
        name: "Rejected Candidate",
        path: "/cand2.jpg",
        descriptor: Array.from(orthogonalVec),
        age: 30,
        gender: "female",
        genderProb: 0.9,
        ethnicCluster: "Caucasian",
        features: dummyFeatures,
      };

      const resRejected = rankByDescriptor(user, [candRejected], 5);
      assert.equal(
        resRejected.length,
        0,
        "rankByDescriptor must return [] (No Close Match) when fine distance > 0.40"
      );
    });

    it("ensures cross-demographic distractor does not displace same-cluster true match in top-3", () => {
      const userVec = new Float32Array(128);
      userVec[0] = 1.0;

      const sameClusterVec = new Float32Array(128);
      sameClusterVec[0] = 0.98;
      sameClusterVec[1] = 0.20;

      const crossClusterVec = new Float32Array(128);
      crossClusterVec[0] = 0.99;
      crossClusterVec[1] = 0.10; // slightly closer raw, but cross-cluster

      const user: UserFaceQuery = {
        descriptor: l2Normalize(userVec),
        age: 28,
        gender: "female",
        genderProbability: 0.95,
        ethnicCluster: "East Asian",
        features: dummyFeatures,
      };

      const sameClusterCeleb: CelebrityEmbedding = {
        id: "jisoo",
        name: "Jisoo",
        path: "/jisoo.jpg",
        descriptor: Array.from(l2Normalize(sameClusterVec)),
        age: 28,
        gender: "female",
        genderProb: 0.95,
        ethnicCluster: "East Asian",
        features: dummyFeatures,
      };

      const crossClusterCeleb: CelebrityEmbedding = {
        id: "scarlett-johansson",
        name: "Scarlett Johansson",
        path: "/scarlett.jpg",
        descriptor: Array.from(l2Normalize(crossClusterVec)),
        age: 38,
        gender: "female",
        genderProb: 0.95,
        ethnicCluster: "Caucasian",
        features: dummyFeatures,
      };

      const results = rankByDescriptor(user, [crossClusterCeleb, sameClusterCeleb], 5);

      assert.ok(results.length > 0, "Should return at least 1 match");
      assert.equal(
        results[0]?.celebrityId,
        "jisoo",
        `Top match must be same-cluster true match (jisoo), got ${results[0]?.celebrityId}`
      );
    });

    it("attaches ethnicCluster property to returned CelebrityMatch objects", () => {
      const userVec = l2Normalize(new Float32Array(128).fill(0.1));
      const celebVec = l2Normalize(new Float32Array(128).fill(0.11));

      const user: UserFaceQuery = {
        descriptor: userVec,
        age: 30,
        gender: "male",
        genderProbability: 0.9,
      };

      const celeb: CelebrityEmbedding = {
        id: "denzel-washington-55",
        name: "Denzel Washington",
        path: "/denzel.jpg",
        descriptor: Array.from(celebVec),
        age: 55,
        gender: "male",
        genderProb: 0.95,
      };

      const matches = rankByDescriptor(user, [celeb], 5);
      assert.equal(matches.length, 1);
      assert.equal(
        matches[0]?.ethnicCluster,
        "African",
        `Expected ethnicCluster to be African, got ${matches[0]?.ethnicCluster}`
      );
    });
  });

  describe("4. Automated Evaluation Harness & Baseline Telemetry (evaluateMatchAccuracy)", () => {
    it("runs fastMode perturbed-query benchmark with cross-demographic verification", async () => {
      const report = await evaluateMatchAccuracy({
        fastMode: true,
        verbose: false,
        protocol: "perturbed-query",
        targetRank1Pct: 95.0,
        evaluateCrossDemographic: true,
      });

      assert.equal(report.protocol, "perturbed-query");
      assert.ok(
        report.metrics.rank1AccuracyPct >= 95.0,
        `Rank-1 accuracy (${report.metrics.rank1AccuracyPct}%) below 95.0%`
      );
      assert.equal(
        report.metrics.crossDemographicTop3FalseMatches,
        0,
        `crossDemographicTop3FalseMatches must be 0 (got ${report.metrics.crossDemographicTop3FalseMatches})`
      );
      assert.equal(
        report.metrics.crossDemographicPass,
        true,
        "crossDemographicPass must be true"
      );
      assert.ok(
        report.metrics.separationGap >= 0.2309,
        `Separation gap (${report.metrics.separationGap}) below target 0.2309`
      );
      assert.equal(report.passedBenchmark, true, "passedBenchmark must be true");
    });

    it("verifies baseline comparison calculation against baseline reference file", async () => {
      const report = await evaluateMatchAccuracy({
        fastMode: true,
        verbose: false,
        compareBaseline: "public/celebs/baseline.json",
        strict: true,
      });

      assert.ok(report.baselineComparison, "baselineComparison must be populated");
      assert.equal(
        report.baselineComparison.passRank1,
        true,
        "passRank1 in baselineComparison must be true"
      );
      assert.equal(
        report.baselineComparison.passSeparationGap,
        true,
        "passSeparationGap in baselineComparison must be true"
      );
      assert.equal(
        report.baselineComparison.overallPass,
        true,
        "overallPass in baselineComparison must be true"
      );
    });
  });
});
