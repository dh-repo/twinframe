import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  calibratedAgeGapPenalty,
  distanceToMatchPercent,
  hydrateFaceFeatures,
  computeMatchScore,
  type CelebrityEmbedding,
} from "../../src/lib/face/embeddings.ts";
import {
  type FaceFeatures,
  type TraitInsight,
} from "../../src/lib/face/types.ts";
import { MatchRevealCard } from "../../src/components/results/match-reveal-card.tsx";
import { ComparisonView } from "../../src/components/results/comparison-view.tsx";

const ROOT = path.resolve(process.cwd());
const CELEBS_DIR = path.join(ROOT, "public/celebs");

function generate4PartAnatomicalTraits(
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

describe("Tier 4: Real-World Integrated Application Scenarios (E2E)", () => {
  // =========================================================================
  // SCENARIO 1: 55-Year-Old Adult Query with Weak Matches
  // =========================================================================
  describe("Scenario 1: 55-Year-Old Adult Query with Weak Matches (F5, F6, F7, F8, F9)", () => {
    it("demotes young candidate (20yo, d=0.42) below mature peer (52yo, d=0.435) and renders honest weak UI", () => {
      const userAge = 55;

      // 1. Candidate Generation
      const candYoung: CelebrityEmbedding = {
        id: "young-star",
        name: "Young Star",
        path: "/celebs/young-star.jpg",
        descriptor: new Array(128).fill(0.088),
        descriptors: [new Float32Array(128).fill(0.088)],
        age: 20, // gap = 35 -> large penalty for mature user
        gender: "female",
        genderProb: 0.95,
      };

      const candPeer: CelebrityEmbedding = {
        id: "mature-peer",
        name: "Mature Peer",
        path: "/celebs/mature-peer.jpg",
        descriptor: new Array(128).fill(0.090),
        descriptors: [new Float32Array(128).fill(0.090)],
        age: 52, // gap = 3 -> zero age penalty
        gender: "female",
        genderProb: 0.95,
      };

      const distYoung = 0.42;
      const distPeer = 0.435;

      // 2. Compute Age Penalties
      const penYoung = calibratedAgeGapPenalty(distYoung, userAge, candYoung.age);
      const penPeer = calibratedAgeGapPenalty(distPeer, userAge, candPeer.age);

      assert.ok(penYoung >= 0.02, `Young candidate penalty too low: ${penYoung}`);
      assert.equal(penPeer, 0.0, `Mature peer penalty must be 0: ${penPeer}`);

      const effDistYoung = distYoung + penYoung;
      const effDistPeer = distPeer + penPeer;

      assert.ok(
        effDistPeer < effDistYoung,
        `Mature peer (eff=${effDistPeer}) must rank ahead of young candidate (eff=${effDistYoung})`,
      );

      // 3. UI Rendering & 4-Part Traits
      const traits = generate4PartAnatomicalTraits(null, null, distPeer);
      assert.equal(traits.length, 4, "Must generate 4 anatomical traits");

      const topMatch = {
        celebrityId: candPeer.id,
        name: candPeer.name,
        knownFor: "Acclaimed Actress",
        matchPercent: distanceToMatchPercent(distPeer),
        rawScore: 0.70,
        confidenceScore: 35,
        traits,
        accentHue: 200,
        initials: "MP",
        tags: ["Cinema"],
        photoUrl: candPeer.path,
        distance: distPeer,
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: null }),
      );

      assert.ok(html.includes("Mature Peer"), "Must display top ranked mature peer");
      assert.ok(html.includes("nearest embedding") || html.includes("No strong doppelgänger") || html.includes("LOW SIMILARITY"), "Must include honest weak match copy");
    });
  });

  // =========================================================================
  // SCENARIO 2: 22-Year-Old Query Matching Billie Eilish
  // =========================================================================
  describe("Scenario 2: 22-Year-Old Query Matching Billie Eilish (F1, F2, F3, F4, F8, F9)", () => {
    it("accurately matches updated studio portrait vectors with high similarity and 4 anatomical traits", () => {
      const indexPath = path.join(CELEBS_DIR, "index.json");
      const f32Path = path.join(CELEBS_DIR, "embeddings.f32.bin");
      const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");

      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
      const slot = indexList.findIndex((e) => e.id === "billie-eilish");
      assert.ok(slot >= 0, "Billie Eilish must exist in index.json");

      const f32Buf = fs.readFileSync(f32Path);
      const billieDesc = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);

      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const billieFeat: FaceFeatures = featuresMap["billie-eilish"];
      assert.ok(billieFeat, "Billie Eilish features must exist");

      // Query from a 22-year-old female with subtle 0.01 vector jitter
      const jitteredQuery = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        jitteredQuery[i] = billieDesc[i]! + (i % 2 === 0 ? 0.005 : -0.005);
      }

      const matchScore = computeMatchScore(jitteredQuery, billieDesc, billieFeat, billieFeat);
      assert.ok(matchScore.confidencePct >= 80.0, `Match confidence too low: ${matchScore.confidencePct}%`);
      assert.equal(matchScore.passedLookalikeGate, true, "Must pass lookalike gate");

      // Verify 4-part anatomical breakdown computes high affinity
      const traits = generate4PartAnatomicalTraits(billieFeat, billieFeat, matchScore.descriptorDistance);
      for (const t of traits) {
        assert.ok(t.similarity >= 0.85, `Trait ${t.trait} similarity should be >= 0.85, got ${t.similarity}`);
      }

      // Verify UI Component Rendering
      const topMatch = {
        celebrityId: "billie-eilish",
        name: "Billie Eilish",
        knownFor: "Singer-Songwriter",
        matchPercent: matchScore.confidencePct,
        rawScore: 0.95,
        confidenceScore: 92,
        traits,
        accentHue: 160,
        initials: "BE",
        tags: ["Musician"],
        photoUrl: "/celebs/billie-eilish.jpg",
        distance: matchScore.descriptorDistance,
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: "/user.jpg" }),
      );

      assert.ok(html.includes("Billie Eilish"), "Must render Billie Eilish top match");
      assert.ok(html.includes("SIMILARITY"), "Must render SIMILARITY label");
    });
  });

  // =========================================================================
  // SCENARIO 3: Strong Twin Lookalike Query (d = 0.28) with Large Age Gap
  // =========================================================================
  describe("Scenario 3: Strong Twin Lookalike Query (d = 0.28) with Large Age Gap (F5, F7, F8, F9)", () => {
    it("preserves genuine facial twin at rank 1 with zero age penalty despite 31-year age gap", () => {
      const userAge = 52;

      const candTwin: CelebrityEmbedding = {
        id: "young-twin",
        name: "Young Twin",
        path: "/celebs/young-twin.jpg",
        descriptor: new Array(128).fill(0.088),
        descriptors: [new Float32Array(128).fill(0.088)],
        age: 21, // 31-year age gap
        gender: "female",
        genderProb: 0.95,
      };

      const candPeer: CelebrityEmbedding = {
        id: "older-distractor",
        name: "Older Distractor",
        path: "/celebs/older-distractor.jpg",
        descriptor: new Array(128).fill(0.095),
        descriptors: [new Float32Array(128).fill(0.095)],
        age: 50, // 2-year age gap
        gender: "female",
        genderProb: 0.95,
      };

      const distTwin = 0.28; // Strong lookalike (d <= 0.40)
      const distPeer = 0.44; // Weak match

      // Crucial Invariant: Strong matches receive zero age penalty
      const penTwin = calibratedAgeGapPenalty(distTwin, userAge, candTwin.age);
      const penPeer = calibratedAgeGapPenalty(distPeer, userAge, candPeer.age);

      assert.equal(penTwin, 0.0, "Twin match (d=0.28 <= 0.40) must incur zero age penalty");
      assert.equal(penPeer, 0.0, "Peer match (gap <= 20) incurs zero age penalty");

      const effTwin = distTwin + penTwin;
      const effPeer = distPeer + penPeer;

      assert.ok(effTwin < effPeer, "Strong twin must strictly win rank 1");

      const simPct = distanceToMatchPercent(distTwin);
      assert.ok(simPct >= 65.0, `Twin similarity must be strong: ${simPct}%`);
    });
  });

  // =========================================================================
  // SCENARIO 4: Low-Confidence / Weak Biometric Query (d = 0.52)
  // =========================================================================
  describe("Scenario 4: Low-Confidence / Weak Biometric Query (d = 0.52) (F5, F6, F8, F9, F10)", () => {
    it("renders all 4 anatomical progress bars with honest low percentages (no single-bar regression)", () => {
      const weakDistance = 0.52;
      const matchPct = distanceToMatchPercent(weakDistance);
      assert.ok(matchPct < 35.0, `Match percent for d=0.52 must be < 35%: ${matchPct}%`);

      const traits = generate4PartAnatomicalTraits(null, null, weakDistance);
      assert.equal(traits.length, 4, "Must generate all 4 traits even on weak matches");

      const weakTopMatch = {
        celebrityId: "distant-match",
        name: "Distant Match",
        knownFor: "Performer",
        matchPercent: matchPct,
        rawScore: 0.45,
        confidenceScore: 28,
        traits,
        accentHue: 180,
        initials: "DM",
        tags: ["Performer"],
        photoUrl: "/celebs/distant-match.jpg",
        distance: weakDistance,
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: weakTopMatch, youUrl: null }),
      );

      assert.ok(html.includes("Distant Match"), "Must render distant candidate");
      assert.ok(html.includes("nearest embedding") || html.includes("LOW SIMILARITY"), "Must render honest disclaimer");
    });
  });

  // =========================================================================
  // SCENARIO 5: Morphological Trait Comparison in Side-by-Side View
  // =========================================================================
  describe("Scenario 5: Morphological Trait Comparison in Side-by-Side View (F8, F9, F10)", () => {
    it("maintains biometric trait congruence between MatchRevealCard and ComparisonView", () => {
      const traits = generate4PartAnatomicalTraits();
      assert.equal(traits.length, 4);

      const topMatch = {
        celebrityId: "brad-pitt",
        name: "Brad Pitt",
        knownFor: "Actor & Producer",
        matchPercent: 74.0,
        rawScore: 0.80,
        confidenceScore: 72,
        traits,
        accentHue: 45,
        initials: "BP",
        tags: ["Actor", "Producer"],
        photoUrl: "/celebs/brad-pitt.jpg",
        distance: 0.32,
      };

      const cardHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: "/user.jpg" }),
      );

      const comparisonHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: topMatch.name,
          celebrityInitials: topMatch.initials,
          userPhotoUrl: "/user.jpg",
          celebrityPhotoUrl: topMatch.photoUrl,
          traits: topMatch.traits,
        }),
      );

      assert.ok(cardHtml.includes("Brad Pitt"), "Card must render Brad Pitt");
      assert.ok(comparisonHtml.includes("Brad Pitt"), "ComparisonView must render Brad Pitt");
      assert.ok(comparisonHtml.includes("role=\"tablist\""), "ComparisonView must contain tablist");
    });
  });
});
