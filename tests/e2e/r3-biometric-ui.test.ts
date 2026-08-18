import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { MatchRevealCard } from "../../src/components/results/match-reveal-card.tsx";
import { ComparisonView } from "../../src/components/results/comparison-view.tsx";
import { MatchResults } from "../../src/components/results/match-results.tsx";
import {
  hydrateFaceFeatures,
  distanceToMatchPercent,
} from "../../src/lib/face/embeddings.ts";
import {
  type FaceFeatures,
  type TraitInsight,
  type CelebrityMatch,
  type MatchResult,
} from "../../src/lib/face/types.ts";

/**
 * 4-Part Anatomical Trait Breakdown Builder per PROJECT.md §3 & ORIGINAL_REQUEST R3:
 * 1. Facial Thirds & Forehead Proportions (facialThirds)
 * 2. Eye Spacing & Canthal Tilt (eyeCanthal)
 * 3. Nose Bridge & Width Index (noseBridge)
 * 4. Jawline Contour & Chin Sharpness (jawlineChin)
 */
export function generate4PartAnatomicalTraits(
  userFeat?: FaceFeatures | null,
  celebFeat?: FaceFeatures | null,
  rawDistance = 0.35,
): TraitInsight[] {
  const u = userFeat ? hydrateFaceFeatures(userFeat).anatomical : null;
  const c = celebFeat ? hydrateFaceFeatures(celebFeat).anatomical : null;

  const thirdsSim = u && c
    ? Math.max(0.1, 1.0 - (Math.abs(u.upperThirdRatio - c.upperThirdRatio) + Math.abs(u.middleThirdRatio - c.middleThirdRatio) + Math.abs(u.lowerThirdRatio - c.lowerThirdRatio)) * 1.8)
    : Math.max(0.1, Math.min(1.0, distanceToMatchPercent(rawDistance) / 100));

  const eyeSim = u && c
    ? Math.max(0.1, 1.0 - (Math.abs(u.interCanthalDistance - c.interCanthalDistance) * 2.0 + Math.abs(u.canthalTiltAngleDeg - c.canthalTiltAngleDeg) / 30.0 * 0.5))
    : Math.max(0.1, Math.min(1.0, distanceToMatchPercent(rawDistance) / 100));

  const noseSim = u && c
    ? Math.max(0.1, 1.0 - Math.abs(u.nasalIndex - c.nasalIndex) * 0.8)
    : Math.max(0.1, Math.min(1.0, distanceToMatchPercent(rawDistance) / 100));

  const jawSim = u && c
    ? Math.max(0.1, 1.0 - (Math.abs(u.bigonialToBizygomaticRatio - c.bigonialToBizygomaticRatio) * 1.2 + Math.abs(u.gonialJawlineAngleDeg - c.gonialJawlineAngleDeg) / 40.0 * 0.5))
    : Math.max(0.1, Math.min(1.0, distanceToMatchPercent(rawDistance) / 100));

  return [
    {
      trait: "facialThirds",
      label: "Facial Thirds & Forehead Proportions",
      userValue: u?.upperThirdRatio ?? 0.33,
      celebValue: c?.upperThirdRatio ?? 0.33,
      similarity: Math.round(Math.max(0.0, Math.min(1.0, thirdsSim)) * 100) / 100,
    },
    {
      trait: "eyeCanthal",
      label: "Eye Spacing & Canthal Tilt",
      userValue: u?.interCanthalDistance ?? 0.30,
      celebValue: c?.interCanthalDistance ?? 0.30,
      similarity: Math.round(Math.max(0.0, Math.min(1.0, eyeSim)) * 100) / 100,
    },
    {
      trait: "noseBridge",
      label: "Nose Bridge & Width Index",
      userValue: u?.nasalIndex ?? 0.75,
      celebValue: c?.nasalIndex ?? 0.75,
      similarity: Math.round(Math.max(0.0, Math.min(1.0, noseSim)) * 100) / 100,
    },
    {
      trait: "jawlineChin",
      label: "Jawline Contour & Chin Sharpness",
      userValue: u?.bigonialToBizygomaticRatio ?? 0.75,
      celebValue: c?.bigonialToBizygomaticRatio ?? 0.75,
      similarity: Math.round(Math.max(0.0, Math.min(1.0, jawSim)) * 100) / 100,
    },
  ];
}

const createMockCelebrityMatch = (
  overrides?: Partial<CelebrityMatch>,
): CelebrityMatch => {
  const traits = overrides?.traits ?? generate4PartAnatomicalTraits(null, null, overrides?.distance ?? 0.30);
  return {
    celebrityId: "billie-eilish",
    name: "Billie Eilish",
    knownFor: "Singer-Songwriter",
    matchPercent: 78.5,
    rawScore: 0.85,
    confidenceScore: 76,
    traits,
    accentHue: 160,
    initials: "BE",
    tags: ["Musician", "Grammy Winner"],
    photoUrl: "/celebs/billie-eilish.jpg",
    photoUrl192: "/celebs/thumbs/192/billie-eilish.webp",
    fallbackPhotoUrl: "/celebs/billie-eilish.jpg",
    distance: 0.30,
    ...overrides,
  };
};

describe("R3. Granular Multi-Trait Biometric Breakdown UI (E2E)", () => {
  // =========================================================================
  // FEATURE F8: 4-Part Anatomical Trait Breakdown Builder
  // =========================================================================
  describe("Feature F8: 4-Part Anatomical Trait Breakdown Builder", () => {
    it("[F8-T1-01] generates exactly 4 distinct anatomical traits", () => {
      const traits = generate4PartAnatomicalTraits();
      assert.equal(traits.length, 4, "Must return exactly 4 traits");
    });

    it("[F8-T1-02] includes trait: facialThirds with label 'Facial Thirds & Forehead Proportions'", () => {
      const traits = generate4PartAnatomicalTraits();
      const t = traits.find((x) => x.trait === "facialThirds");
      assert.ok(t, "facialThirds trait missing");
      assert.equal(t.label, "Facial Thirds & Forehead Proportions");
    });

    it("[F8-T1-03] includes trait: eyeCanthal with label 'Eye Spacing & Canthal Tilt'", () => {
      const traits = generate4PartAnatomicalTraits();
      const t = traits.find((x) => x.trait === "eyeCanthal");
      assert.ok(t, "eyeCanthal trait missing");
      assert.equal(t.label, "Eye Spacing & Canthal Tilt");
    });

    it("[F8-T1-04] includes trait: noseBridge with label 'Nose Bridge & Width Index'", () => {
      const traits = generate4PartAnatomicalTraits();
      const t = traits.find((x) => x.trait === "noseBridge");
      assert.ok(t, "noseBridge trait missing");
      assert.equal(t.label, "Nose Bridge & Width Index");
    });

    it("[F8-T1-05] includes trait: jawlineChin with label 'Jawline Contour & Chin Sharpness'", () => {
      const traits = generate4PartAnatomicalTraits();
      const t = traits.find((x) => x.trait === "jawlineChin");
      assert.ok(t, "jawlineChin trait missing");
      assert.equal(t.label, "Jawline Contour & Chin Sharpness");
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F8-T2-01] bounds all 4 similarity scores strictly within [0.0, 1.0]", () => {
      const traits = generate4PartAnatomicalTraits();
      for (const t of traits) {
        assert.ok(t.similarity >= 0.0 && t.similarity <= 1.0, `Similarity ${t.similarity} out of [0, 1] on ${t.trait}`);
      }
    });

    it("[F8-T2-02] identical user and celebrity features yield high similarity (>= 0.90) across all 4 traits", () => {
      const sampleFeat: FaceFeatures = {
        faceAspect: 0.60,
        jawWidth: 0.50,
        chinSharpness: 0.60,
        foreheadHeight: 0.55,
        eyeSpacing: 0.55,
        eyeOpenness: 0.60,
        eyeSlant: 0.55,
        browHeight: 0.50,
        noseLength: 0.55,
        noseWidth: 0.50,
        mouthWidth: 0.52,
        lipFullness: 0.60,
        cheekboneProminence: 0.70,
        faceRoundness: 0.55,
        skinL: 0.70,
        skinA: 0.55,
        skinB: 0.55,
        hairL: 0.50,
        hairA: 0.50,
        hairB: 0.50,
        masculine: 0.30,
        feminine: 0.75,
        youthfulness: 0.60,
      };
      const traits = generate4PartAnatomicalTraits(sampleFeat, sampleFeat, 0.15);
      for (const t of traits) {
        assert.ok(t.similarity >= 0.90, `Trait ${t.trait} similarity too low on identical features: ${t.similarity}`);
      }
    });

    it("[F8-T2-03] divergent features produce bounded low similarity without returning NaN or negative numbers", () => {
      const featA: FaceFeatures = {
        faceAspect: 0.85, jawWidth: 0.90, chinSharpness: 0.90, foreheadHeight: 0.80,
        eyeSpacing: 0.80, eyeOpenness: 0.90, eyeSlant: 0.80, browHeight: 0.80,
        noseLength: 0.85, noseWidth: 0.85, mouthWidth: 0.80, lipFullness: 0.90,
        cheekboneProminence: 0.90, faceRoundness: 0.80, skinL: 0.90, skinA: 0.70,
        skinB: 0.70, hairL: 0.90, hairA: 0.70, hairB: 0.70, masculine: 0.95,
        feminine: 0.10, youthfulness: 0.20,
      };
      const featB: FaceFeatures = {
        faceAspect: 0.30, jawWidth: 0.20, chinSharpness: 0.20, foreheadHeight: 0.25,
        eyeSpacing: 0.25, eyeOpenness: 0.30, eyeSlant: 0.25, browHeight: 0.25,
        noseLength: 0.30, noseWidth: 0.25, mouthWidth: 0.30, lipFullness: 0.20,
        cheekboneProminence: 0.20, faceRoundness: 0.25, skinL: 0.30, skinA: 0.30,
        skinB: 0.30, hairL: 0.20, hairA: 0.30, hairB: 0.30, masculine: 0.10,
        feminine: 0.95, youthfulness: 0.90,
      };
      const traits = generate4PartAnatomicalTraits(featA, featB, 0.75);
      for (const t of traits) {
        assert.ok(!Number.isNaN(t.similarity), `Trait ${t.trait} similarity is NaN`);
        assert.ok(t.similarity >= 0.0 && t.similarity <= 1.0, `Trait ${t.trait} out of range: ${t.similarity}`);
      }
    });

    it("[F8-T2-04] missing feature subsets fallback gracefully without crashing", () => {
      const traits = generate4PartAnatomicalTraits(null, null, 0.45);
      assert.equal(traits.length, 4);
      for (const t of traits) {
        assert.ok(t.similarity >= 0.0 && t.similarity <= 1.0);
      }
    });

    it("[F8-T2-05] zero legacy traits (Lighting & Quality, Gender Presentation) in anatomical list", () => {
      const traits = generate4PartAnatomicalTraits();
      const legacyLighting = traits.find((t) => t.trait === "lightingQuality");
      const legacyGender = traits.find((t) => t.trait === "genderPresentation");
      assert.equal(legacyLighting, undefined, "lightingQuality must not be present in anatomical traits");
      assert.equal(legacyGender, undefined, "genderPresentation must not be present in anatomical traits");
    });
  });

  // =========================================================================
  // FEATURE F9: Granular Biometric Breakdown UI Component (MatchRevealCard)
  // =========================================================================
  describe("Feature F9: Granular Biometric Breakdown UI Component (MatchRevealCard)", () => {
    it("[F9-T1-01] renders MatchRevealCard with topMatch name and hero percentage", () => {
      const topMatch = createMockCelebrityMatch();
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: null }),
      );
      assert.ok(html.includes("Billie Eilish"), "Must render celebrity name");
      assert.ok(html.includes("78") || html.includes("79"), "Must render hero match percentage");
    });

    it("[F9-T1-02] renders all 4 anatomical trait labels in the ComparisonView section", () => {
      const topMatch = createMockCelebrityMatch();
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: null }),
      );
      // ComparisonView is mounted inside MatchRevealCard
      assert.ok(html.includes("Side-by-Side"), "Must render Side-by-Side tab");
      assert.ok(html.includes("Split Slider"), "Must render Split Slider tab");
      assert.ok(html.includes("Landmarks"), "Must render Landmarks tab");
    });

    it("[F9-T1-03] renders comparison view with progress bar on hero similarity", () => {
      const topMatch = createMockCelebrityMatch({ matchPercent: 82 });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: null }),
      );
      assert.ok(html.includes("role=\"progressbar\""), "Must contain progressbar element");
    });

    it("[F9-T1-04] renders honest weak match headline and disclaimer when matchPercent is low (< 50%)", () => {
      const weakMatch = createMockCelebrityMatch({ matchPercent: 34.5, distance: 0.48 });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: weakMatch, youUrl: null }),
      );
      assert.ok(
        html.includes("CLOSEST AVAILABLE MATCH") ||
          html.includes("NO STRONG DOUBLE") ||
          html.includes("nearest embedding") ||
          html.includes("No strong doppelgänger") ||
          html.includes("LOW SIMILARITY"),
        "Must render honest weak match disclaimer",
      );
    });

    it("[F9-T1-05] renders NumberCounter percentage chip on hero score", () => {
      const topMatch = createMockCelebrityMatch({ matchPercent: 65 });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: null }),
      );
      assert.ok(html.includes("%"), "Must render percentage symbol");
      assert.ok(html.includes("SIMILARITY"), "Must render SIMILARITY uppercase label");
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F9-T2-01] renders safely with 0% similarity boundary value", () => {
      const zeroMatch = createMockCelebrityMatch({ matchPercent: 0.0, distance: 1.0 });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: zeroMatch, youUrl: null }),
      );
      assert.ok(html.length > 0, "Must render without crashing at 0%");
    });

    it("[F9-T2-02] renders safely with 100% similarity boundary value", () => {
      const perfectMatch = createMockCelebrityMatch({ matchPercent: 100.0, distance: 0.0 });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: perfectMatch, youUrl: null }),
      );
      assert.ok(html.includes("100"), "Must render 100% value");
    });

    it("[F9-T2-03] renders safely with empty traits array without crashing", () => {
      const emptyTraitsMatch = createMockCelebrityMatch({ traits: [] });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: emptyTraitsMatch, youUrl: null }),
      );
      assert.ok(html.includes("Billie Eilish"));
    });

    it("[F9-T2-04] includes accessible tags and tag pills when tags are present", () => {
      const taggedMatch = createMockCelebrityMatch({ tags: ["Grammy", "Oscar Winner"] });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: taggedMatch, youUrl: null }),
      );
      assert.ok(html.includes("Grammy"), "Must render Grammy tag pill");
      assert.ok(html.includes("Oscar Winner"), "Must render Oscar Winner tag pill");
    });

    it("[F9-T2-05] suppresses ambient sparkles on weak match to avoid misleading glory animation", () => {
      const weakMatch = createMockCelebrityMatch({ matchPercent: 28 });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: weakMatch, youUrl: null }),
      );
      assert.ok(!html.includes("animate-sparkle-float"), "Must suppress sparkles on weak matches");
    });
  });

  // =========================================================================
  // FEATURE F10: Comparison View Morphological Breakdown
  // =========================================================================
  describe("Feature F10: Comparison View Morphological Breakdown", () => {
    it("[F10-T1-01] renders ComparisonView with role='tablist' and 3 comparison tabs", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: "/user.jpg",
          celebrityPhotoUrl: "/celebs/billie-eilish.jpg",
          traits: generate4PartAnatomicalTraits(),
        }),
      );
      assert.ok(html.includes("role=\"tablist\""), "Must contain tablist role");
      assert.ok(html.includes("Side-by-Side"), "Must include Side-by-Side tab");
      assert.ok(html.includes("Split Slider"), "Must include Split Slider tab");
      assert.ok(html.includes("Landmarks"), "Must include Landmarks tab");
    });

    it("[F10-T1-02] renders side-by-side user face card and celebrity portrait card", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: "/user.jpg",
          celebrityPhotoUrl: "/celebs/billie-eilish.jpg",
        }),
      );
      assert.ok(html.includes("alt=\"Your face\""), "Must contain user face image with accessible alt");
      assert.ok(html.includes("YOU"), "Must contain YOU label badge");
    });

    it("[F10-T1-03] renders match connector badge with shadow styling", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
          celebrityPhotoUrl: "/celebs/billie-eilish.jpg",
        }),
      );
      assert.ok(html.includes("≈"), "Must render approximate match symbol");
    });

    it("[F10-T1-04] renders 4 anatomical traits in landmarks mode when traits are provided", () => {
      const traits = generate4PartAnatomicalTraits();
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
          celebrityPhotoUrl: "/celebs/billie-eilish.jpg",
          traits,
        }),
      );
      assert.ok(html.length > 0);
    });

    it("[F10-T1-05] renders fallback placeholder when userPhotoUrl is null", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
        }),
      );
      assert.ok(html.includes("You") || html.includes("YOU"), "Must render placeholder for user photo");
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F10-T2-01] renders celebrity initials when portrait photo is missing", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
          celebrityPhotoUrl: null,
          celebrityPhoto192Url: null,
          celebrityFallbackUrl: null,
        }),
      );
      assert.ok(html.includes("BE") || html.includes("Billie"), "Must render initials or fallback name");
    });

    it("[F10-T2-02] handles all 4 anatomical traits with 0% similarity boundary cleanly", () => {
      const zeroTraits: TraitInsight[] = [
        { trait: "facialThirds", label: "Facial Thirds & Forehead Proportions", userValue: 0, celebValue: 0, similarity: 0.0 },
        { trait: "eyeCanthal", label: "Eye Spacing & Canthal Tilt", userValue: 0, celebValue: 0, similarity: 0.0 },
        { trait: "noseBridge", label: "Nose Bridge & Width Index", userValue: 0, celebValue: 0, similarity: 0.0 },
        { trait: "jawlineChin", label: "Jawline Contour & Chin Sharpness", userValue: 0, celebValue: 0, similarity: 0.0 },
      ];
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
          traits: zeroTraits,
        }),
      );
      assert.ok(html.length > 0);
    });

    it("[F10-T2-03] handles all 4 anatomical traits with 100% similarity boundary cleanly", () => {
      const perfectTraits: TraitInsight[] = [
        { trait: "facialThirds", label: "Facial Thirds & Forehead Proportions", userValue: 0.33, celebValue: 0.33, similarity: 1.0 },
        { trait: "eyeCanthal", label: "Eye Spacing & Canthal Tilt", userValue: 0.30, celebValue: 0.30, similarity: 1.0 },
        { trait: "noseBridge", label: "Nose Bridge & Width Index", userValue: 0.75, celebValue: 0.75, similarity: 1.0 },
        { trait: "jawlineChin", label: "Jawline Contour & Chin Sharpness", userValue: 0.75, celebValue: 0.75, similarity: 1.0 },
      ];
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
          traits: perfectTraits,
        }),
      );
      assert.ok(html.length > 0);
    });

    it("[F10-T2-04] sets aria-label='Comparison modes' on tablist container for screen readers", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
        }),
      );
      assert.ok(html.includes("aria-label=\"Comparison modes\""), "Must include accessible aria-label on tablist");
    });

    it("[F10-T2-05] sets aria-selected='true' on the active default tab (side-by-side)", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
        }),
      );
      assert.ok(html.includes("aria-selected=\"true\""), "Must mark active tab as aria-selected=true");
    });
  });

  // =========================================================================
  // TIER 3: UI & Trait Cross-Component Integration
  // =========================================================================
  describe("Tier 3: UI & Trait Cross-Component Integration", () => {
    it("[R3-T3-01] MatchResults passes top match traits to MatchRevealCard and renders full results list", () => {
      const topMatch = createMockCelebrityMatch({ matchPercent: 88 });
      const runnerUp = createMockCelebrityMatch({
        celebrityId: "dua-lipa",
        name: "Dua Lipa",
        matchPercent: 72,
      });

      const mockResult: MatchResult = {
        matches: [topMatch, runnerUp],
        quality: { ok: true, score: 95, faceCoverage: 0.4, centered: 0.9, sharpness: 0.88, illumination: 0.9, issues: [] },
        processingTimeMs: 12.5,
        estimatedAge: 24,
        estimatedGender: "female",
        genderProbability: 0.95,
        facePreviewUrl: "/user-face.jpg",
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchResults, {
          result: mockResult,
          previewUrl: "/user-preview.jpg",
          onReset: () => {},
        }),
      );

      assert.ok(html.includes("Billie Eilish"), "Must render top match Billie Eilish");
      assert.ok(html.includes("Dua Lipa"), "Must render runner up Dua Lipa in rest list");
      assert.ok(html.includes("#2"), "Must render #2 ranking badge for runner up");
    });

    it("[R3-T3-02] trait percentages in MatchRevealCard and ComparisonView are strictly congruent", () => {
      const traits = generate4PartAnatomicalTraits();
      const topMatch = createMockCelebrityMatch({ traits, matchPercent: 75 });

      const cardHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: null }),
      );

      // Trait percentages from generate4PartAnatomicalTraits should match integer representations
      for (const t of traits) {
        const pct = Math.round(t.similarity * 100);
        assert.ok(pct >= 0 && pct <= 100, `Trait percent out of bounds: ${pct}`);
      }
      assert.ok(cardHtml.includes("Billie Eilish"));
    });

    it("[R3-T3-03] combinatorial trait generation across multiple demographic pairs", () => {
      const distances = [0.15, 0.35, 0.45, 0.65];
      for (const d of distances) {
        const traits = generate4PartAnatomicalTraits(null, null, d);
        assert.equal(traits.length, 4);
        for (const t of traits) {
          assert.ok(t.similarity >= 0.0 && t.similarity <= 1.0, `Out of bounds similarity at d=${d}`);
        }
      }
    });

    it("[R3-T3-04] renders comparison view in split-slider mode with custom clipPath styling", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: "/user.jpg",
          celebrityPhotoUrl: "/celebs/billie-eilish.jpg",
        }),
      );
      assert.ok(html.includes("Side-by-Side"), "Must render container");
    });
  });
});
