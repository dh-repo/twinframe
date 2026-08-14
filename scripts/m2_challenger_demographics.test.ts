import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  morphologicalDistance,
  crossDemographicMismatchPenalty,
  morphologicalAffinity,
  MORPH_FEATURE_WEIGHTS,
} from "../src/lib/face/geometry.ts";
import type { FaceFeatures } from "../src/lib/face/types.ts";

describe("Empirical Challenger M2: Synthetic Demographic Profile Vectors Stress Harness", () => {
  // Synthetic demographic profiles
  const profileEastAsian: FaceFeatures = {
    faceAspect: 0.65, jawWidth: 0.45, chinSharpness: 0.40, foreheadHeight: 0.50,
    eyeSpacing: 0.60, eyeOpenness: 0.35, eyeSlant: 0.65, browHeight: 0.45,
    noseLength: 0.38, noseWidth: 0.42, mouthWidth: 0.45, lipFullness: 0.45,
    cheekboneProminence: 0.70, faceRoundness: 0.65,
    skinL: 0.72, skinA: 0.52, skinB: 0.58, hairL: 0.20, hairA: 0.50, hairB: 0.50,
    masculine: 0.35, feminine: 0.65, youthfulness: 0.60,
  };

  const profileCaucasian: FaceFeatures = {
    faceAspect: 0.42, jawWidth: 0.58, chinSharpness: 0.65, foreheadHeight: 0.55,
    eyeSpacing: 0.48, eyeOpenness: 0.62, eyeSlant: 0.48, browHeight: 0.55,
    noseLength: 0.62, noseWidth: 0.38, mouthWidth: 0.50, lipFullness: 0.42,
    cheekboneProminence: 0.45, faceRoundness: 0.42,
    skinL: 0.80, skinA: 0.54, skinB: 0.52, hairL: 0.60, hairA: 0.52, hairB: 0.55,
    masculine: 0.60, feminine: 0.40, youthfulness: 0.45,
  };

  const profileAfrican: FaceFeatures = {
    faceAspect: 0.50, jawWidth: 0.55, chinSharpness: 0.45, foreheadHeight: 0.52,
    eyeSpacing: 0.55, eyeOpenness: 0.55, eyeSlant: 0.50, browHeight: 0.50,
    noseLength: 0.45, noseWidth: 0.68, mouthWidth: 0.62, lipFullness: 0.72,
    cheekboneProminence: 0.58, faceRoundness: 0.55,
    skinL: 0.35, skinA: 0.52, skinB: 0.54, hairL: 0.15, hairA: 0.50, hairB: 0.50,
    masculine: 0.52, feminine: 0.48, youthfulness: 0.50,
  };

  const profileHispanic: FaceFeatures = {
    faceAspect: 0.48, jawWidth: 0.52, chinSharpness: 0.52, foreheadHeight: 0.52,
    eyeSpacing: 0.52, eyeOpenness: 0.56, eyeSlant: 0.50, browHeight: 0.50,
    noseLength: 0.52, noseWidth: 0.50, mouthWidth: 0.55, lipFullness: 0.55,
    cheekboneProminence: 0.55, faceRoundness: 0.52,
    skinL: 0.62, skinA: 0.55, skinB: 0.57, hairL: 0.25, hairA: 0.51, hairB: 0.51,
    masculine: 0.50, feminine: 0.50, youthfulness: 0.52,
  };

  const profileExtremeZeros: FaceFeatures = {
    faceAspect: 0, jawWidth: 0, chinSharpness: 0, foreheadHeight: 0,
    eyeSpacing: 0, eyeOpenness: 0, eyeSlant: 0, browHeight: 0,
    noseLength: 0, noseWidth: 0, mouthWidth: 0, lipFullness: 0,
    cheekboneProminence: 0, faceRoundness: 0, skinL: 0, skinA: 0, skinB: 0,
    hairL: 0, hairA: 0, hairB: 0, masculine: 0, feminine: 0, youthfulness: 0,
  };

  const profileExtremeOnes: FaceFeatures = {
    faceAspect: 1, jawWidth: 1, chinSharpness: 1, foreheadHeight: 1,
    eyeSpacing: 1, eyeOpenness: 1, eyeSlant: 1, browHeight: 1,
    noseLength: 1, noseWidth: 1, mouthWidth: 1, lipFullness: 1,
    cheekboneProminence: 1, faceRoundness: 1, skinL: 1, skinA: 1, skinB: 1,
    hairL: 1, hairA: 1, hairB: 1, masculine: 1, feminine: 1, youthfulness: 1,
  };

  describe("1. Cross-Demographic Profile Verification (D_morph > 0.35)", () => {
    const crossPairs: Array<{ name: string; p1: FaceFeatures; p2: FaceFeatures }> = [
      { name: "East Asian vs Caucasian", p1: profileEastAsian, p2: profileCaucasian },
      { name: "East Asian vs African", p1: profileEastAsian, p2: profileAfrican },
      { name: "East Asian vs Hispanic", p1: profileEastAsian, p2: profileHispanic },
      { name: "Caucasian vs African", p1: profileCaucasian, p2: profileAfrican },
      { name: "Caucasian vs Hispanic", p1: profileCaucasian, p2: profileHispanic },
      { name: "African vs Hispanic", p1: profileAfrican, p2: profileHispanic },
      { name: "East Asian vs Extreme Zeros", p1: profileEastAsian, p2: profileExtremeZeros },
      { name: "East Asian vs Extreme Ones", p1: profileEastAsian, p2: profileExtremeOnes },
      { name: "Caucasian vs Extreme Zeros", p1: profileCaucasian, p2: profileExtremeZeros },
      { name: "Caucasian vs Extreme Ones", p1: profileCaucasian, p2: profileExtremeOnes },
      { name: "African vs Extreme Zeros", p1: profileAfrican, p2: profileExtremeZeros },
      { name: "African vs Extreme Ones", p1: profileAfrican, p2: profileExtremeOnes },
      { name: "Hispanic vs Extreme Zeros", p1: profileHispanic, p2: profileExtremeZeros },
      { name: "Hispanic vs Extreme Ones", p1: profileHispanic, p2: profileExtremeOnes },
      { name: "Extreme Zeros vs Extreme Ones", p1: profileExtremeZeros, p2: profileExtremeOnes },
    ];

    for (const { name, p1, p2 } of crossPairs) {
      test(`Cross-demographic profile pair [${name}] produces D_morph > 0.35`, () => {
        const d = morphologicalDistance(p1, p2);
        assert.ok(
          d > 0.35,
          `Expected ${name} D_morph > 0.35, got ${d.toFixed(4)}`,
        );
      });
    }

    test("Cross-demographic penalty triggers appropriately for all cross pairs", () => {
      for (const { name, p1, p2 } of crossPairs) {
        const d = morphologicalDistance(p1, p2);
        const penalty = crossDemographicMismatchPenalty(p1, p2);
        assert.ok(
          penalty > 0.0,
          `Expected penalty > 0 for ${name} (D_morph=${d.toFixed(4)}), got penalty=${penalty}`,
        );
      }
    });
  });

  describe("2. Intra-Demographic Profile Verification (D_morph <= 0.35)", () => {
    // Generate realistic variants within each demographic cluster
    const profileEastAsianVariant1: FaceFeatures = {
      ...profileEastAsian,
      eyeSpacing: 0.58,
      noseLength: 0.40,
      skinL: 0.70,
    };

    const profileEastAsianVariant2: FaceFeatures = {
      ...profileEastAsian,
      jawWidth: 0.47,
      chinSharpness: 0.42,
      hairL: 0.22,
    };

    const profileCaucasianVariant1: FaceFeatures = {
      ...profileCaucasian,
      eyeOpenness: 0.60,
      noseWidth: 0.40,
      skinL: 0.78,
    };

    const profileCaucasianVariant2: FaceFeatures = {
      ...profileCaucasian,
      foreheadHeight: 0.52,
      cheekboneProminence: 0.48,
      hairL: 0.55,
    };

    const profileAfricanVariant1: FaceFeatures = {
      ...profileAfrican,
      lipFullness: 0.70,
      noseWidth: 0.65,
      skinL: 0.38,
    };

    const profileAfricanVariant2: FaceFeatures = {
      ...profileAfrican,
      jawWidth: 0.52,
      eyeSpacing: 0.53,
      hairL: 0.18,
    };

    const profileHispanicVariant1: FaceFeatures = {
      ...profileHispanic,
      skinL: 0.60,
      noseLength: 0.50,
      eyeOpenness: 0.54,
    };

    const profileHispanicVariant2: FaceFeatures = {
      ...profileHispanic,
      jawWidth: 0.50,
      cheekboneProminence: 0.53,
      hairL: 0.23,
    };

    const intraPairs: Array<{ name: string; p1: FaceFeatures; p2: FaceFeatures }> = [
      { name: "East Asian vs East Asian Variant 1", p1: profileEastAsian, p2: profileEastAsianVariant1 },
      { name: "East Asian vs East Asian Variant 2", p1: profileEastAsian, p2: profileEastAsianVariant2 },
      { name: "Caucasian vs Caucasian Variant 1", p1: profileCaucasian, p2: profileCaucasianVariant1 },
      { name: "Caucasian vs Caucasian Variant 2", p1: profileCaucasian, p2: profileCaucasianVariant2 },
      { name: "African vs African Variant 1", p1: profileAfrican, p2: profileAfricanVariant1 },
      { name: "African vs African Variant 2", p1: profileAfrican, p2: profileAfricanVariant2 },
      { name: "Hispanic vs Hispanic Variant 1", p1: profileHispanic, p2: profileHispanicVariant1 },
      { name: "Hispanic vs Hispanic Variant 2", p1: profileHispanic, p2: profileHispanicVariant2 },
    ];

    for (const { name, p1, p2 } of intraPairs) {
      test(`Intra-demographic profile pair [${name}] produces D_morph <= 0.35`, () => {
        const d = morphologicalDistance(p1, p2);
        assert.ok(
          d <= 0.35,
          `Expected ${name} D_morph <= 0.35, got ${d.toFixed(4)}`,
        );
      });
    }

    test("Intra-demographic penalty is exactly 0.0 for all intra pairs", () => {
      for (const { name, p1, p2 } of intraPairs) {
        const d = morphologicalDistance(p1, p2);
        const penalty = crossDemographicMismatchPenalty(p1, p2);
        assert.equal(
          penalty,
          0.0,
          `Expected penalty === 0 for ${name} (D_morph=${d.toFixed(4)}), got ${penalty}`,
        );
      }
    });
  });

  describe("3. Adversarial & Boundary Stress Tests", () => {
    test("Symmetry property holds for all profile combinations", () => {
      const allProfiles = [
        profileEastAsian,
        profileCaucasian,
        profileAfrican,
        profileHispanic,
        profileExtremeZeros,
        profileExtremeOnes,
      ];

      for (let i = 0; i < allProfiles.length; i++) {
        for (let j = i; j < allProfiles.length; j++) {
          const d1 = morphologicalDistance(allProfiles[i], allProfiles[j]);
          const d2 = morphologicalDistance(allProfiles[j], allProfiles[i]);
          assert.equal(d1, d2, `Symmetry broken between index ${i} and ${j}: ${d1} !== ${d2}`);
        }
      }
    });

    test("Triangle inequality / Distance sanity check across demographics", () => {
      // D(EastAsian, African) vs D(EastAsian, Caucasian) + D(Caucasian, African)
      const dEA = morphologicalDistance(profileEastAsian, profileAfrican);
      const dEC = morphologicalDistance(profileEastAsian, profileCaucasian);
      const dCA = morphologicalDistance(profileCaucasian, profileAfrican);

      assert.ok(
        dEA <= dEC + dCA + 1e-9,
        `Triangle inequality violation: D(EA,A)=${dEA} > D(EA,C)=${dEC} + D(C,A)=${dCA}`,
      );
    });

    test("Clamped values: out-of-range feature inputs (> 1 or < 0) are handled gracefully", () => {
      const corruptFeatures1: FaceFeatures = {
        ...profileEastAsian,
        skinL: 2.5, // out of range
        eyeSlant: -1.0,
      };

      const corruptFeatures2: FaceFeatures = {
        ...profileCaucasian,
        skinL: -0.5,
        eyeSlant: 3.0,
      };

      const d = morphologicalDistance(corruptFeatures1, corruptFeatures2);
      assert.ok(Number.isFinite(d), `Distance with out-of-range features must be finite: ${d}`);
      assert.ok(d >= 0.0 && d <= 1.0, `Distance must stay bounded in [0, 1], got ${d}`);
    });

    test("MorphologicalAffinity matches clamp(1.0 - D_morph, 0, 1) exactly across demographic matrix", () => {
      const profiles = [profileEastAsian, profileCaucasian, profileAfrican, profileHispanic];
      for (const p1 of profiles) {
        for (const p2 of profiles) {
          const d = morphologicalDistance(p1, p2);
          const aff = morphologicalAffinity(p1, p2);
          const expectedAff = Math.min(1.0, Math.max(0.0, 1.0 - d));
          assert.equal(aff, expectedAff, `Affinity mismatch for distance ${d}: ${aff} !== ${expectedAff}`);
        }
      }
    });
  });
});
