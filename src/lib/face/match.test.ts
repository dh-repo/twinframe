import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankCelebrities } from "./match-geometry.ts";
import {
  euclideanDistance,
  cosineDistance,
  l2Normalize,
  ensembleDistance,
  distanceToMatchPercent,
  rankPercentsFromDistances,
  ageAffinity,
  calibratedAgeGapPenalty,
  genderAffinity,
  computeMatchConfidence,
  combinedDescriptorDistance,
  computeMatchScore,
  type CelebrityEmbedding,
} from "./embeddings.ts";
import {
  rankByDescriptor,
  rankCandidates,
  rankCandidatesTwoStage,
  minTemplateDistance,
  isPrimaryGalleryEntry,
  householdFame,
  computeMorphologicalDistance,
  MORPH_TIE_THRESHOLD_EPS,
  buildDescriptorTraits,
  type UserFaceQuery,
} from "./match.ts";
import { extractAnatomicalFeatures68 } from "./geometry.ts";
import { mergeFeatures, emptyFeatures } from "./math.ts";
import { CELEBRITIES, getCelebrityById } from "../celebrities/database.ts";
import { catalogFor } from "../celebrities/catalog.ts";
import type { FaceFeatures, ExtendedAnatomicalFeatures, MatchScoreResult, CelebrityMatch } from "./types.ts";
import type { CelebrityProfile } from "../celebrities/types.ts";

function feat(partial: Partial<FaceFeatures>): FaceFeatures {
  return mergeFeatures(partial);
}

/** L2-normalized query with a deterministic orthogonal perturbation at a target ensemble distance. */
function vectorAtEnsembleDistance(query: Float32Array, targetD: number, seed: number): Float32Array {
  let lo = 1e-4;
  let hi = 1.5;
  let best = query;
  for (let iter = 0; iter < 28; iter++) {
    const mid = (lo + hi) / 2;
    const raw = new Float32Array(query.length);
    for (let i = 0; i < query.length; i++) {
      raw[i] = (query[i] ?? 0) + Math.sin((i + 1) * seed) * mid;
    }
    const cand = l2Normalize(raw);
    const d = ensembleDistance(query, cand);
    best = cand;
    if (d < targetD) lo = mid;
    else hi = mid;
  }
  return best;
}

describe("euclideanDistance / calibration", () => {
  it("identical vectors distance 0", () => {
    const a = [0.1, 0.2, 0.3];
    assert.equal(euclideanDistance(a, a), 0);
  });

  it("distanceToMatchPercent(0) returns exactly 100", () => {
    assert.equal(distanceToMatchPercent(0), 100);
  });

  it("calibrates Hill Equation curve at key sample points", () => {
    assert.equal(distanceToMatchPercent(0.35), 50.9);
    assert.equal(distanceToMatchPercent(0.45), 34.8);
    assert.equal(distanceToMatchPercent(0.55), 26.1);
    assert.equal(distanceToMatchPercent(0.65), 21.6);
  });

  it("maintains strict non-increasing monotonicity across d in [0, 1.5]", () => {
    for (let d = 0; d < 1.5; d += 0.02) {
      const p1 = distanceToMatchPercent(d);
      const p2 = distanceToMatchPercent(d + 0.02);
      assert.ok(
        p1 >= p2,
        `Monotonicity violation at d=${d}: p(${d})=${p1} < p(${d + 0.02})=${p2}`,
      );
    }
    assert.ok(distanceToMatchPercent(0) > distanceToMatchPercent(0.3));
    assert.ok(distanceToMatchPercent(0.3) > distanceToMatchPercent(0.6));
    assert.ok(distanceToMatchPercent(0.6) > distanceToMatchPercent(0.9));
    assert.ok(distanceToMatchPercent(0.9) > distanceToMatchPercent(1.2));
    assert.ok(distanceToMatchPercent(1.2) > distanceToMatchPercent(1.5));
  });

  it("rank percents preserve distance order", () => {
    const d = [0.7, 0.4, 0.55];
    const p = rankPercentsFromDistances(d);
    assert.ok(p[1]! > p[2]!);
    assert.ok(p[2]! > p[0]!);
  });
});

describe("Continuous Gaussian Age & Gender Affinity", () => {
  it("computes continuous Gaussian age affinity smoothly (sigma=18)", () => {
    assert.equal(ageAffinity(25, 25), 1.0);
    const a10 = ageAffinity(25, 35);
    const expected10 = Math.exp(-Math.pow(10 / 18, 2));
    assert.ok(Math.abs(a10 - expected10) < 1e-6);

    // Strict monotonicity with increasing age delta
    assert.ok(ageAffinity(25, 26) > ageAffinity(25, 30));
    assert.ok(ageAffinity(25, 30) > ageAffinity(25, 40));
    assert.ok(ageAffinity(25, 40) > ageAffinity(25, 60));

    // Tighter than old sigma=28: 70 vs 40 should score lower than with wide prior
    assert.ok(ageAffinity(70, 40) < Math.exp(-Math.pow(30 / 28, 2)));

    // Non-filtering: age affinity remains strictly positive even for large age gaps
    assert.ok(ageAffinity(20, 95) > 0, "Age affinity must be non-zero for large age gap");
  });

  it("weights gender affinity smoothly with strong opposite-gender penalty when confident", () => {
    const maleCeleb: CelebrityEmbedding = {
      id: "test-male",
      name: "Test Male",
      path: "/test.jpg",
      descriptor: new Array(128).fill(0),
      age: 30,
      gender: "male",
      genderProb: 0.95,
    };
    const g1 = genderAffinity("female", 0.5, maleCeleb);
    const g2 = genderAffinity("female", 0.7, maleCeleb);
    const g3 = genderAffinity("female", 0.95, maleCeleb);
    const gMaxProb = genderAffinity("female", 1.0, maleCeleb);

    assert.ok(g1 >= g2);
    assert.ok(g2 >= g3);
    assert.ok(Math.abs(gMaxProb - 0.20) < 1e-9);
    assert.ok(g3 >= 0.20 && g3 < 0.40, `High-conf opposite gender should be strongly penalized (got ${g3})`);
    assert.equal(genderAffinity("unknown", 0.99, maleCeleb), 1.0);
    assert.equal(genderAffinity("male", 0.99, maleCeleb), 1.0);
  });

  it("weak-regime re-rank prefers closer age only when face distances are near-tied", () => {
    const userDesc = new Array(128).fill(0);
    userDesc[0] = 1;
    const youngCloser = new Array(128).fill(0);
    youngCloser[0] = Math.cos(0.392);
    youngCloser[1] = Math.sin(0.392);
    const peerFarther = new Array(128).fill(0);
    peerFarther[0] = Math.cos(0.400);
    peerFarther[1] = Math.sin(0.400);

    const user: UserFaceQuery = {
      descriptor: userDesc,
      age: 34,
      gender: "female",
      genderProbability: 0.95,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "young-idol",
        name: "Young Idol",
        path: "/y.webp",
        descriptor: youngCloser,
        age: 20,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "age-peer",
        name: "Age Peer",
        path: "/p.webp",
        descriptor: peerFarther,
        age: 32,
        gender: "female",
        genderProb: 0.95,
      },
    ];
    const matches = rankByDescriptor(user, gallery, 2);
    assert.ok(matches.length >= 1);
    assert.equal(
      matches[0]!.celebrityId,
      "young-idol",
      "Age prior must not overturn a closer face (Δd ≈ 0.008)",
    );
  });

  it("drops 96px extra-scrape portraits so they cannot beat a real jpg star", () => {
    const userDesc = new Array(128).fill(0);
    userDesc[0] = 1;
    const extra = new Array(128).fill(0);
    extra[0] = Math.cos(0.28);
    extra[1] = Math.sin(0.28);
    const star = new Array(128).fill(0);
    star[0] = Math.cos(0.33);
    star[1] = Math.sin(0.33);
    const user: UserFaceQuery = {
      descriptor: userDesc,
      age: 35,
      gender: "female",
      genderProbability: 0.95,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "anna-van-hooft",
        name: "Anna Van Hooft",
        path: "/celebs/thumbs/96/anna-van-hooft.webp",
        fallbackPath: "/celebs/thumbs/96/anna-van-hooft.webp",
        descriptor: extra,
        age: 20,
        gender: "female",
        genderProb: 0.9,
      },
      {
        id: "emma-stone",
        name: "Emma Stone",
        path: "/celebs/thumbs/96/emma-stone.webp",
        fallbackPath: "/celebs/emma-stone.jpg",
        descriptor: star,
        age: 31,
        gender: "female",
        genderProb: 0.95,
      },
    ];
    assert.equal(isPrimaryGalleryEntry(gallery[0]!), false);
    assert.equal(isPrimaryGalleryEntry(gallery[1]!), true);
    const matches = rankByDescriptor(user, gallery, 3);
    assert.equal(matches[0]!.celebrityId, "emma-stone");
    assert.equal(matches.some((m) => m.celebrityId === "anna-van-hooft"), false);
  });

  it("does not let age rescue overturn a clearly closer face (Florence-style)", () => {
    const userDesc = new Array(128).fill(0);
    userDesc[0] = 1;
    const trueId = new Array(128).fill(0);
    trueId[0] = Math.cos(0.31);
    trueId[1] = Math.sin(0.31);
    const distractor = new Array(128).fill(0);
    distractor[0] = Math.cos(0.36);
    distractor[1] = Math.sin(0.36);
    const user: UserFaceQuery = {
      descriptor: userDesc,
      age: 35,
      gender: "female",
      genderProbability: 0.95,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "florence",
        name: "Florence",
        path: "/celebs/florence.jpg",
        fallbackPath: "/celebs/florence.jpg",
        descriptor: trueId,
        age: 24,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "alba",
        name: "Alba",
        path: "/celebs/alba.jpg",
        descriptor: distractor,
        age: 41,
        gender: "female",
        genderProb: 0.95,
      },
    ];
    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(matches[0]!.celebrityId, "florence");
    assert.ok(matches[0]!.matchPercent > (matches[1]?.matchPercent ?? 0));
  });

  it("does not promote a household name over a closer face", () => {
    assert.ok(householdFame("tom-hanks") > householdFame("josh-hutcherson"));
    assert.ok(householdFame("emma-stone") > householdFame("kendall-jenner"));
    const userDesc = new Array(128).fill(0);
    userDesc[0] = 1;
    const hutch = new Array(128).fill(0);
    hutch[0] = Math.cos(0.390);
    hutch[1] = Math.sin(0.390);
    const hanks = new Array(128).fill(0);
    hanks[0] = Math.cos(0.398);
    hanks[1] = Math.sin(0.398);
    const user: UserFaceQuery = {
      descriptor: userDesc,
      age: 30,
      gender: "male",
      genderProbability: 0.9,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "josh-hutcherson",
        name: "Josh Hutcherson",
        path: "/celebs/josh-hutcherson.jpg",
        fallbackPath: "/celebs/josh-hutcherson.jpg",
        descriptor: hutch,
        age: 37,
        gender: "male",
        genderProb: 0.95,
      },
      {
        id: "tom-hanks",
        name: "Tom Hanks",
        path: "/celebs/tom-hanks.jpg",
        fallbackPath: "/celebs/tom-hanks.jpg",
        descriptor: hanks,
        age: 66,
        gender: "male",
        genderProb: 0.95,
      },
    ];
    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(
      matches[0]!.celebrityId,
      "josh-hutcherson",
      "Fame prior must not invert a closer face (Δd ≈ 0.008)",
    );
  });

  it("does not let household fame overturn a clearly closer face", () => {
    const userDesc = new Array(128).fill(0);
    userDesc[0] = 1;
    const close = new Array(128).fill(0);
    close[0] = Math.cos(0.28);
    close[1] = Math.sin(0.28);
    const famous = new Array(128).fill(0);
    famous[0] = Math.cos(0.40);
    famous[1] = Math.sin(0.40);
    const user: UserFaceQuery = {
      descriptor: userDesc,
      age: 35,
      gender: "male",
      genderProbability: 0.95,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "josh-hutcherson",
        name: "Josh Hutcherson",
        path: "/celebs/josh-hutcherson.jpg",
        fallbackPath: "/celebs/josh-hutcherson.jpg",
        descriptor: close,
        age: 37,
        gender: "male",
        genderProb: 0.95,
      },
      {
        id: "tom-hanks",
        name: "Tom Hanks",
        path: "/celebs/tom-hanks.jpg",
        fallbackPath: "/celebs/tom-hanks.jpg",
        descriptor: famous,
        age: 66,
        gender: "male",
        genderProb: 0.95,
      },
    ];
    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(matches[0]!.celebrityId, "josh-hutcherson");
  });

  it("minTemplateDistance uses the closest query template", () => {
    const target = new Array(128).fill(0.2);
    const far = new Array(128).fill(0.5);
    const near = new Array(128).fill(0.21);
    const q: UserFaceQuery = {
      descriptor: far,
      descriptors: [far, near],
      age: 30,
      gender: "female",
      genderProbability: 0.9,
    };
    const dMulti = minTemplateDistance(q, target);
    const dFarOnly = minTemplateDistance({ ...q, descriptors: [far] }, target);
    assert.ok(dMulti < dFarOnly, "multi-template min should beat single far template");
  });

  it("rankByDescriptor min-distance over query templates can promote better match", () => {
    // Orthogonal unit axes: twin=e0, distractor=e1
    const twin = new Array(128).fill(0);
    twin[0] = 1;
    const distractor = new Array(128).fill(0);
    distractor[1] = 1;
    // Primary ≈ distractor; flip ≈ twin — min over templates should pick twin
    const primary = new Array(128).fill(0);
    primary[1] = 1;
    const flip = new Array(128).fill(0);
    flip[0] = 1;

    const user: UserFaceQuery = {
      descriptor: primary,
      descriptors: [primary, flip],
      age: 30,
      gender: "unknown",
      genderProbability: 0.5,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "twin",
        name: "Twin",
        path: "/t.webp",
        descriptor: twin,
        age: 30,
        gender: "female",
        genderProb: 0.9,
      },
      {
        id: "distractor",
        name: "Distractor",
        path: "/d.webp",
        descriptor: distractor,
        age: 30,
        gender: "female",
        genderProb: 0.9,
      },
    ];
    // Single-template (primary only) ranks distractor first
    const single = rankByDescriptor({ ...user, descriptors: [primary] }, gallery, 2);
    assert.equal(single[0]!.celebrityId, "distractor");
    // Multi-template min-distance promotes twin via the flip template
    const matches = rankByDescriptor(user, gallery, 2);
    assert.ok(matches.length >= 1);
    assert.equal(matches[0]!.celebrityId, "twin");
  });

  it("prefers same-gender list when gender is confident, but face distance wins within gender", () => {
    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 70,
      gender: "female",
      genderProbability: 0.95,
    };

    const mockGallery: CelebrityEmbedding[] = [
      {
        id: "celeb-male-close-face",
        name: "Male Close Face",
        path: "/a.webp",
        descriptor: new Array(128).fill(0.11),
        age: 40,
        gender: "male",
        genderProb: 0.95,
      },
      {
        id: "celeb-female-older",
        name: "Female Older",
        path: "/b.webp",
        descriptor: new Array(128).fill(0.13),
        age: 68,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "celeb-female-better-face",
        name: "Female Better Face",
        path: "/d.webp",
        // Closer embedding than female-older, younger age — face must win over age prior
        descriptor: new Array(128).fill(0.105),
        age: 45,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "celeb-male-2",
        name: "Male 2",
        path: "/c.webp",
        descriptor: new Array(128).fill(0.12),
        age: 55,
        gender: "male",
        genderProb: 0.9,
      },
    ];

    const matches = rankByDescriptor(user, mockGallery, 3);
    assert.ok(matches.length >= 1);
    assert.equal(
      matches[0]!.celebrityId,
      "celeb-female-better-face",
      "Closer same-gender face must still win Rank-1",
    );
  });

  it("does not let perfect age match beat a clearly better face (face-first)", () => {
    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 39,
      gender: "male",
      genderProbability: 0.95,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "same-age-worse-face",
        name: "Same Age Worse",
        path: "/w.webp",
        descriptor: new Array(128).fill(0.25),
        age: 39,
        gender: "male",
        genderProb: 0.9,
      },
      {
        id: "diff-age-better-face",
        name: "Diff Age Better",
        path: "/b.webp",
        descriptor: new Array(128).fill(0.12),
        age: 55,
        gender: "male",
        genderProb: 0.9,
      },
    ];
    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(
      matches[0]!.celebrityId,
      "diff-age-better-face",
      "Better face structure must beat demographically perfect weaker face",
    );
  });

  it("uses demographic priors for candidate tie-breaking when descriptor distances are equal", () => {
    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 25,
      gender: "female",
      genderProbability: 0.95,
    };

    const mockGallery: CelebrityEmbedding[] = [
      {
        id: "celeb-match-demo",
        name: "Match Demo",
        path: "/match.webp",
        descriptor: new Array(128).fill(0.12),
        age: 26,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "celeb-diff-demo",
        name: "Diff Demo",
        path: "/diff.webp",
        descriptor: new Array(128).fill(0.12),
        age: 60,
        gender: "male",
        genderProb: 0.95,
      },
    ];

    const matches = rankByDescriptor(user, mockGallery, 2);
    assert.equal(matches[0]!.celebrityId, "celeb-match-demo");
  });
});

describe("Match Confidence & Granular Descriptor Traits", () => {
  it("computes match confidence rating in range [10, 100]", () => {
    assert.equal(computeMatchConfidence(0, 0, 0, 0), 10.0);
    assert.equal(computeMatchConfidence(1, 1, 0.25, 1), 100.0);

    const conf = computeMatchConfidence(0.92, 70, 0.15, 0.9);
    assert.ok(conf >= 10 && conf <= 100);
  });

  it("outputs 4 granular anatomical traits in rankByDescriptor", () => {
    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 30,
      gender: "female",
      genderProbability: 0.92,
      detConfidence: 0.95,
      sharpness: 80,
      faceCoverage: 0.2,
    };
    const mockGallery: CelebrityEmbedding[] = [
      {
        id: "zendaya",
        name: "Zendaya",
        path: "/zendaya.webp",
        descriptor: new Array(128).fill(0.12),
        age: 28,
        gender: "female",
        genderProb: 0.98,
      },
    ];

    const matches = rankByDescriptor(user, mockGallery, 1);
    assert.equal(matches.length, 1);
    const match = matches[0]!;
    assert.ok(match.confidenceScore !== undefined && match.confidenceScore >= 10 && match.confidenceScore <= 100);
    assert.equal(match.traits.length, 4);

    const labels = match.traits.map((t) => t.label);
    assert.ok(labels.includes("Facial Thirds & Forehead Proportions"));
    assert.ok(labels.includes("Eye Spacing & Canthal Tilt"));
    assert.ok(labels.includes("Nose Bridge & Width Index"));
    assert.ok(labels.includes("Jawline Contour & Chin Sharpness"));

    const traitKeys = match.traits.map((t) => t.trait);
    assert.ok(traitKeys.includes("facialThirds"));
    assert.ok(traitKeys.includes("eyeCanthal"));
    assert.ok(traitKeys.includes("noseBridge"));
    assert.ok(traitKeys.includes("jawlineChin"));

    for (const t of match.traits) {
      assert.ok(t.similarity >= 0.0 && t.similarity <= 1.0, `Trait ${t.trait} similarity out of bounds: ${t.similarity}`);
      assert.ok(!Number.isNaN(t.similarity), `Trait ${t.trait} similarity is NaN`);
    }
  });

  it("buildDescriptorTraits computes high similarity on identical canonical features", () => {
    const sampleFeatures: FaceFeatures = {
      ...emptyFeatures(),
      foreheadHeight: 0.55,
      faceAspect: 0.60,
      eyeSpacing: 0.52,
      eyeSlant: 0.54,
      noseLength: 0.55,
      noseWidth: 0.50,
      jawWidth: 0.52,
      chinSharpness: 0.58,
    };
    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 26,
      gender: "female",
      genderProbability: 0.95,
      features: sampleFeatures,
    };
    const celeb: CelebrityEmbedding = {
      id: "sample-celeb",
      name: "Sample Celeb",
      path: "/sample.webp",
      descriptor: new Array(128).fill(0.1),
      age: 26,
      gender: "female",
      genderProb: 0.95,
      features: sampleFeatures,
    };

    const traits = buildDescriptorTraits(user, celeb, 0.10);
    assert.equal(traits.length, 4);
    for (const t of traits) {
      assert.ok(t.similarity >= 0.90, `Trait ${t.trait} similarity should be >= 0.90 on identical features, got ${t.similarity}`);
    }
  });

  it("buildDescriptorTraits bounds similarity scores within [0.0, 1.0] for divergent features", () => {
    const featA: FaceFeatures = {
      ...emptyFeatures(),
      foreheadHeight: 0.90,
      faceAspect: 0.90,
      eyeSpacing: 0.90,
      eyeSlant: 0.90,
      noseLength: 0.90,
      noseWidth: 0.90,
      jawWidth: 0.90,
      chinSharpness: 0.90,
    };
    const featB: FaceFeatures = {
      ...emptyFeatures(),
      foreheadHeight: 0.10,
      faceAspect: 0.10,
      eyeSpacing: 0.10,
      eyeSlant: 0.10,
      noseLength: 0.10,
      noseWidth: 0.10,
      jawWidth: 0.10,
      chinSharpness: 0.10,
    };
    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 20,
      gender: "male",
      genderProbability: 0.95,
      features: featA,
    };
    const celeb: CelebrityEmbedding = {
      id: "opp-celeb",
      name: "Opp Celeb",
      path: "/opp.webp",
      descriptor: new Array(128).fill(0.1),
      age: 60,
      gender: "female",
      genderProb: 0.95,
      features: featB,
    };

    const traits = buildDescriptorTraits(user, celeb, 0.80);
    assert.equal(traits.length, 4);
    for (const t of traits) {
      assert.ok(t.similarity >= 0.0 && t.similarity <= 1.0, `Trait ${t.trait} out of [0, 1]: ${t.similarity}`);
      assert.ok(!Number.isNaN(t.similarity));
    }
  });
});

/** Geometry ranker regression (legacy path / unit fixtures). */
describe("rankCelebrities self-identification", () => {
  it("returns topK results with required fields", () => {
    const matches = rankCelebrities(emptyFeatures(), 5);
    assert.equal(matches.length, 5);
    for (const m of matches) {
      assert.ok(m.celebrityId);
      assert.ok(m.name);
      assert.ok(m.matchPercent >= 0 && m.matchPercent <= 100);
      assert.ok(m.traits.length > 0);
      assert.ok(m.initials.length >= 1);
    }
  });

  it("self-matches every gallery member as rank-1 (regression suite)", () => {
    const failures: string[] = [];
    for (const celeb of CELEBRITIES) {
      const ranked = rankCelebrities(celeb.features, 1);
      const top = ranked[0];
      if (!top || top.celebrityId !== celeb.id) {
        failures.push(
          `${celeb.id} → got ${top?.celebrityId ?? "none"} (${top?.matchPercent ?? 0}%)`,
        );
      }
    }
    assert.equal(
      failures.length,
      0,
      `Self-match failures (${failures.length}):\n${failures.join("\n")}`,
    );
  });

  it("self-match scores are high confidence", () => {
    const sample = CELEBRITIES.slice(0, 10);
    for (const celeb of sample) {
      const top = rankCelebrities(celeb.features, 1)[0];
      assert.ok(top);
      assert.ok(
        top.matchPercent >= 85,
        `${celeb.id} self-match only ${top.matchPercent}%`,
      );
    }
  });
});

describe("rankCelebrities presentation affinity", () => {
  it("prefers similar presentation for a strongly masculine vector", () => {
    const user = feat({
      masculine: 0.9,
      feminine: 0.15,
      jawWidth: 0.8,
      cheekboneProminence: 0.7,
      lipFullness: 0.35,
      skinL: 0.7,
    });
    const matches = rankCelebrities(user, 5);
    const top = matches[0];
    assert.ok(top);
    const profile = getCelebrityById(top.celebrityId);
    assert.ok(profile);
    assert.ok(
      profile.features.masculine >= 0.55,
      `Expected masculine-leaning top match, got ${profile.name} (m=${profile.features.masculine})`,
    );
  });

  it("prefers similar presentation for a strongly feminine vector", () => {
    const user = feat({
      masculine: 0.15,
      feminine: 0.9,
      jawWidth: 0.5,
      cheekboneProminence: 0.75,
      lipFullness: 0.7,
      eyeOpenness: 0.65,
      skinL: 0.75,
    });
    const matches = rankCelebrities(user, 5);
    const top = matches[0];
    assert.ok(top);
    const profile = getCelebrityById(top.celebrityId);
    assert.ok(profile);
    assert.ok(
      profile.features.feminine >= 0.55,
      `Expected feminine-leaning top match, got ${profile.name} (f=${profile.features.feminine})`,
    );
  });
});

describe("rankCelebrities fixture clusters", () => {
  const probes: Array<{ name: string; features: FaceFeatures; expectId: string }> = [
    {
      name: "angular-youth-probe",
      features: feat({
        ...getCelebrityById("timothee-chalamet")!.features,
        jawWidth: 0.5,
        youthfulness: 0.75,
      }),
      expectId: "timothee-chalamet",
    },
    {
      name: "square-jaw-hero-probe",
      features: feat({
        ...getCelebrityById("chris-hemsworth")!.features,
        jawWidth: 0.8,
      }),
      expectId: "chris-hemsworth",
    },
    {
      name: "high-cheekbone-probe",
      features: feat({
        ...getCelebrityById("zendaya")!.features,
        cheekboneProminence: 0.78,
      }),
      expectId: "zendaya",
    },
    {
      name: "full-lips-probe",
      features: feat({
        ...getCelebrityById("scarlett-johansson")!.features,
        lipFullness: 0.76,
      }),
      expectId: "scarlett-johansson",
    },
  ];

  for (const probe of probes) {
    it(`cluster: ${probe.name} → ${probe.expectId}`, () => {
      const ranked = rankCelebrities(probe.features, 3);
      const ids = ranked.map((m) => m.celebrityId);
      assert.ok(
        ids.includes(probe.expectId),
        `Expected ${probe.expectId} in top-3, got [${ids.join(", ")}]`,
      );
      assert.equal(ranked[0]?.celebrityId, probe.expectId);
    });
  }
});

describe("gallery integrity", () => {
  it("has unique ids", () => {
    const ids = CELEBRITIES.map((c: CelebrityProfile) => c.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  it("has at least 40 celebrities for demo coverage", () => {
    assert.ok(CELEBRITIES.length >= 40, `only ${CELEBRITIES.length}`);
  });

  it("feature values stay in [0,1]", () => {
    for (const c of CELEBRITIES) {
      for (const [k, v] of Object.entries(c.features)) {
        assert.ok(
          typeof v === "number" && v >= 0 && v <= 1,
          `${c.id}.${k}=${v}`,
        );
      }
    }
  });
});

describe("curated catalog expansion", () => {
  it("catalogFor returns curated metadata for expanded international figures", () => {
    const devPatel = catalogFor("dev-patel");
    assert.equal(devPatel.knownFor, "Actor");
    assert.ok(devPatel.tags.includes("intense"));
    assert.equal(devPatel.accentHue, 25);

    const simuLiu = catalogFor("simu-liu");
    assert.equal(simuLiu.knownFor, "Actor");
    assert.ok(simuLiu.tags.includes("athletic"));

    const badBunny = catalogFor("bad-bunny");
    assert.equal(badBunny.knownFor, "Artist");

    const adrianaLima = catalogFor("adriana-lima");
    assert.equal(adrianaLima.knownFor, "Model");
  });
});

describe("Landmark Fusion & Candidate Tie-Breaking in rankByDescriptor", () => {
  it("breaks candidate descriptor ties (|d1 - d2| < 0.02) using landmark geometric affinity", () => {
    const userFeatures: FaceFeatures = {
      ...emptyFeatures(),
      jawWidth: 0.85,
      faceAspect: 0.65,
      eyeSpacing: 0.5,
      noseLength: 0.6,
      masculine: 0.85,
    };

    // Candidate A descriptor has raw distance slightly higher than candidate B (|0.380 - 0.375| = 0.005 < 0.02)
    const descA = new Float32Array(128).fill(0.1);
    const descB = new Float32Array(128).fill(0.1);
    descA[0] = 0.22;
    descB[0] = 0.218;

    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 30,
      gender: "male",
      genderProbability: 0.95,
      features: userFeatures,
    };

    const mockGallery: CelebrityEmbedding[] = [
      {
        id: "candidate-a",
        name: "Candidate A",
        path: "/cand_a.webp",
        descriptor: Array.from(descA),
        age: 30,
        gender: "male",
        genderProb: 0.95,
        features: userFeatures, // High geometric affinity (~1.0)
      },
      {
        id: "candidate-b",
        name: "Candidate B",
        path: "/cand_b.webp",
        descriptor: Array.from(descB),
        age: 30,
        gender: "male",
        genderProb: 0.95,
        features: {
          ...emptyFeatures(),
          jawWidth: 0.1,
          faceAspect: 0.1,
          eyeSpacing: 0.1,
          noseLength: 0.1,
          mouthWidth: 0.1,
          lipFullness: 0.9,
          masculine: 0.1,
          feminine: 0.9,
          youthfulness: 0.1,
        }, // Low geometric affinity
      },
    ];

    const matches = rankByDescriptor(user, mockGallery, 2);
    assert.equal(matches.length, 2);
    // Candidate A should rank #1 despite slightly higher raw distance because landmark fusion breaks the tie
    assert.equal(matches[0]!.celebrityId, "candidate-a");
    assert.equal(matches[1]!.celebrityId, "candidate-b");
  });
});

describe("Milestone 3 (M3): Calibrated Multi-Stage Similarity & Gating", () => {
  const vZero = l2Normalize(new Float32Array(128).fill(0.1));
  const vDiff = l2Normalize(new Float32Array(128).map((_, i) => (i % 2 === 0 ? 0.8 : -0.8)));

  it("computes MatchScoreResult struct matching interface contract in PROJECT.md", () => {
    const res = computeMatchScore(vZero, vZero, emptyFeatures(), emptyFeatures());
    assert.equal(typeof res.confidencePct, "number");
    assert.equal(typeof res.descriptorDistance, "number");
    assert.equal(typeof res.morphologicalDistance, "number");
    assert.equal(typeof res.deepVectorDistance, "number");
    assert.equal(typeof res.passedLookalikeGate, "boolean");

    assert.equal(res.confidencePct, 100.0);
    assert.equal(res.passedLookalikeGate, true);
  });

  it("verifies lookalike gate passes for close matches and fails for dissimilar profiles (< 20%)", () => {
    const closeRes = computeMatchScore(vZero, vZero, emptyFeatures(), emptyFeatures());
    assert.ok(closeRes.passedLookalikeGate, "Identical face must pass lookalike gate");
    assert.ok(closeRes.confidencePct >= 20.0, "Identical face score must be >= 20%");

    const farRes = computeMatchScore(vZero, vDiff, emptyFeatures(), emptyFeatures());
    assert.equal(farRes.passedLookalikeGate, false, "Dissimilar profiles must fail lookalike gate");
    assert.ok(farRes.confidencePct < 20.0, "Dissimilar profiles must score < 20% confidence");
  });

  it("verifies cross-demographic mismatch filtering in lookalike gate", () => {
    const resSame = computeMatchScore(vZero, vZero, emptyFeatures(), emptyFeatures(), {
      ethnicClusterA: "East Asian",
      ethnicClusterB: "East Asian",
    });
    assert.ok(resSame.passedLookalikeGate, "Same demographic cluster passes gate");

    const featA = { ...emptyFeatures(), skinL: 0.85 };
    const featB = { ...emptyFeatures(), skinL: 0.20 };
    const resDiff = computeMatchScore(vZero, vZero, featA, featB, {
      ethnicClusterA: "East Asian",
      ethnicClusterB: "African",
    });
    assert.equal(resDiff.passedLookalikeGate, false, "Cross-demographic hard mismatch must fail lookalike gate");
  });

  it("executes two-stage candidate search via rankCandidates and rankCandidatesTwoStage", () => {
    const mockCelebs: CelebrityEmbedding[] = Array.from({ length: 50 }, (_, i) => ({
      id: `celeb-${i}`,
      name: `Celeb ${i}`,
      path: `/celeb-${i}.jpg`,
      descriptor: Array.from(l2Normalize(new Float32Array(128).fill(0.05 + i * 0.002))),
      age: 25 + (i % 30),
      gender: i % 2 === 0 ? "male" : "female",
      genderProb: 0.9,
    }));

    const query: UserFaceQuery = {
      descriptor: vZero,
      age: 28,
      gender: "male",
      genderProbability: 0.9,
    };

    const res1 = rankCandidates(query, mockCelebs, 5);
    const res2 = rankCandidatesTwoStage(query, mockCelebs, 5);

    assert.equal(res1.length, 5);
    assert.equal(res2.length, 5);
    assert.equal(res1[0]!.celebrityId, res2[0]!.celebrityId);

    // Verify telemetry fields on returned CelebrityMatch
    assert.ok(res1[0]!.matchScoreResult !== undefined, "Match must include matchScoreResult");
    assert.ok(typeof res1[0]!.passedLookalikeGate === "boolean", "Match must include passedLookalikeGate");
  });

  it("completes two-stage candidate search in < 15ms SLA for 500 candidates", () => {
    const mockCelebs: CelebrityEmbedding[] = Array.from({ length: 500 }, (_, i) => ({
      id: `celeb-${i}`,
      name: `Celeb ${i}`,
      path: `/celeb-${i}.jpg`,
      descriptor: Array.from(l2Normalize(new Float32Array(128).fill((i % 10) * 0.1))),
      age: 30,
      gender: "male",
      genderProb: 0.9,
    }));

    const query: UserFaceQuery = {
      descriptor: vZero,
      age: 30,
      gender: "male",
      genderProbability: 0.9,
    };

    // Warm up JIT
    for (let w = 0; w < 3; w++) {
      rankCandidatesTwoStage(query, mockCelebs, 5);
    }
    const start = performance.now();
    const runs = 5;
    let results: CelebrityMatch[] = [];
    for (let r = 0; r < runs; r++) {
      results = rankCandidatesTwoStage(query, mockCelebs, 5);
    }
    const elapsedAvg = (performance.now() - start) / runs;

    assert.ok(results.length > 0);
    assert.ok(elapsedAvg < 15.0, `Two-stage search for 500 candidates executed in ${elapsedAvg.toFixed(2)}ms (expected < 15ms)`);
  });

  it("handles edge cases safely: empty vectors return 1.0 distance and NaNs do not cause crash", () => {
    assert.equal(euclideanDistance([], []), 1.0, "Empty euclidean distance must return 1.0 (not 0.0)");
    assert.equal(euclideanDistance(new Float32Array(0), new Float32Array(128)), 1.0);
    assert.equal(cosineDistance([], [1, 2, 3]), 1.0, "Empty cosine distance must return 1.0");

    const nanVec = new Float32Array(128).fill(NaN);
    const eucNaN = euclideanDistance(nanVec, vZero);
    const cosNaN = cosineDistance(nanVec, vZero);
    assert.ok(Number.isFinite(eucNaN), "Euclidean distance with NaN elements must return finite number");
    assert.ok(Number.isFinite(cosNaN), "Cosine distance with NaN elements must return finite number");

    const scoreNaN = computeMatchScore(nanVec, vZero);
    assert.ok(Number.isFinite(scoreNaN.confidencePct), "Match score with NaN input vector must be finite");
  });
});

describe("Requirement R5: Dynamic Morphological Metric Tie-Breaking", () => {
  it("extracts 3D canonical unwarped anatomical metrics (Facial Thirds, Canthal Tilt, Gonial Angle, Nasal Index)", () => {
    const landmarks68 = Array.from({ length: 68 }, (_, i) => ({ x: 50 + (i % 10) * 5, y: 50 + Math.floor(i / 10) * 8 }));
    landmarks68[8] = { x: 50, y: 140 };  // Menton / Chin
    landmarks68[21] = { x: 45, y: 50 };  // Brow Left
    landmarks68[22] = { x: 55, y: 50 };  // Brow Right
    landmarks68[27] = { x: 50, y: 65 };  // Glabella / Nose Bridge
    landmarks68[33] = { x: 50, y: 95 };  // Subnasale

    landmarks68[36] = { x: 30, y: 55 };  // Left eye outer
    landmarks68[39] = { x: 42, y: 55 };  // Left eye inner
    landmarks68[42] = { x: 58, y: 55 };  // Right eye inner
    landmarks68[45] = { x: 70, y: 55 };  // Right eye outer

    landmarks68[31] = { x: 42, y: 90 };  // Left alar
    landmarks68[35] = { x: 58, y: 90 };  // Right alar

    landmarks68[0] = { x: 20, y: 70 };   // ZyL
    landmarks68[16] = { x: 80, y: 70 };  // ZyR
    landmarks68[4] = { x: 25, y: 120 };  // GoL
    landmarks68[12] = { x: 75, y: 120 }; // GoR

    const anat = extractAnatomicalFeatures68(landmarks68);

    assert.ok(typeof anat.upperThirdRatio === "number" && anat.upperThirdRatio > 0);
    assert.ok(typeof anat.middleThirdRatio === "number" && anat.middleThirdRatio > 0);
    assert.ok(typeof anat.lowerThirdRatio === "number" && anat.lowerThirdRatio > 0);
    assert.ok(Math.abs((anat.upperThirdRatio + anat.middleThirdRatio + anat.lowerThirdRatio) - 1.0) < 1e-3);
    assert.ok(typeof anat.canthalTiltAngleDeg === "number");
    assert.ok(typeof anat.gonialJawlineAngleDeg === "number" && anat.gonialJawlineAngleDeg >= 70 && anat.gonialJawlineAngleDeg <= 160);
    assert.ok(typeof anat.nasalIndex === "number" && anat.nasalIndex >= 0.2 && anat.nasalIndex <= 2.0);
  });

  const r5UserAnat: ExtendedAnatomicalFeatures = {
    upperThirdRatio: 0.3333,
    middleThirdRatio: 0.3333,
    lowerThirdRatio: 0.3334,
    lateralFifthsRatios: [0.2, 0.2, 0.2, 0.2, 0.2],
    interCanthalDistance: 0.21,
    canthalTiltAngleDeg: 8.0,
    nasalIndex: 0.70,
    bigonialToBizygomaticRatio: 0.76,
    gonialJawlineAngleDeg: 135.0,
    lipVermilionHeightRatio: 0.625,
    philtrumDepth: 0.50,
  };

  /** L2-normalized query with a deterministic orthogonal perturbation at a target ensemble distance. */
  function vectorAtEnsembleDistance(query: Float32Array, targetD: number, seed: number): Float32Array {
    let lo = 1e-4;
    let hi = 1.5;
    let best = query;
    for (let iter = 0; iter < 28; iter++) {
      const mid = (lo + hi) / 2;
      const raw = new Float32Array(query.length);
      for (let i = 0; i < query.length; i++) {
        raw[i] = (query[i] ?? 0) + Math.sin((i + 1) * seed) * mid;
      }
      const cand = l2Normalize(raw);
      const d = ensembleDistance(query, cand);
      best = cand;
      if (d < targetD) lo = mid;
      else hi = mid;
    }
    return best;
  }

  it("activates morphological tie-breaker strictly when |Δd| < 0.015", () => {
    const userFeatures: FaceFeatures = {
      ...emptyFeatures(),
      anatomical: r5UserAnat,
    };
    const queryDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.17 + 0.4)));
    const descA = vectorAtEnsembleDistance(queryDesc, 0.150, 1.31);
    const descB = vectorAtEnsembleDistance(queryDesc, 0.156, 2.17);
    const dA = ensembleDistance(queryDesc, descA);
    const dB = ensembleDistance(queryDesc, descB);
    assert.ok(dA < dB, `fixture: A must be closer in FaceNet space (${dA} vs ${dB})`);
    assert.ok(
      Math.abs(dB - dA) < MORPH_TIE_THRESHOLD_EPS,
      `fixture |Δd| must be < 0.015, got ${Math.abs(dB - dA).toFixed(4)}`,
    );

    const candAAnat: ExtendedAnatomicalFeatures = {
      ...r5UserAnat,
      canthalTiltAngleDeg: -5.0,
      gonialJawlineAngleDeg: 100.0,
    };

    const query: UserFaceQuery = {
      descriptor: queryDesc,
      age: 30,
      gender: "male",
      genderProbability: 0.95,
      features: userFeatures,
    };

    const mockGallery: CelebrityEmbedding[] = [
      {
        id: "cand-a",
        name: "Candidate A",
        path: "/a.jpg",
        descriptor: Array.from(descA),
        age: 30,
        gender: "male",
        genderProb: 0.95,
        features: { ...emptyFeatures(), anatomical: candAAnat },
      },
      {
        id: "cand-b",
        name: "Candidate B",
        path: "/b.jpg",
        descriptor: Array.from(descB),
        age: 30,
        gender: "male",
        genderProb: 0.95,
        features: { ...emptyFeatures(), anatomical: r5UserAnat },
      },
    ];

    const matches = rankByDescriptor(query, mockGallery, 2);
    assert.equal(matches.length, 2);
    assert.equal(
      matches[0]!.celebrityId,
      "cand-b",
      `Candidate B must rank #1 because morphological tie-breaker re-ranks when |Δd| = ${Math.abs(dB - dA).toFixed(4)} < 0.015`,
    );
  });

  it("does NOT activate morphological tie-breaker when |Δd| >= 0.015", () => {
    const userFeatures: FaceFeatures = {
      ...emptyFeatures(),
      anatomical: r5UserAnat,
    };
    const queryDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.13 + 0.2)));
    const descA = vectorAtEnsembleDistance(queryDesc, 0.150, 1.07);
    const descB = vectorAtEnsembleDistance(queryDesc, 0.172, 2.63);
    const dA = ensembleDistance(queryDesc, descA);
    const dB = ensembleDistance(queryDesc, descB);
    assert.ok(dA < dB, `fixture: A must be closer in FaceNet space (${dA} vs ${dB})`);
    assert.ok(
      Math.abs(dB - dA) >= MORPH_TIE_THRESHOLD_EPS,
      `fixture |Δd| must be >= 0.015, got ${Math.abs(dB - dA).toFixed(4)}`,
    );

    const candAAnat: ExtendedAnatomicalFeatures = {
      ...r5UserAnat,
      canthalTiltAngleDeg: -5.0,
      gonialJawlineAngleDeg: 100.0,
    };

    const query: UserFaceQuery = {
      descriptor: queryDesc,
      age: 30,
      gender: "male",
      genderProbability: 0.95,
      features: userFeatures,
    };

    const mockGallery: CelebrityEmbedding[] = [
      {
        id: "cand-a",
        name: "Candidate A",
        path: "/a.jpg",
        descriptor: Array.from(descA),
        age: 30,
        gender: "male",
        genderProb: 0.95,
        features: { ...emptyFeatures(), anatomical: candAAnat },
      },
      {
        id: "cand-b",
        name: "Candidate B",
        path: "/b.jpg",
        descriptor: Array.from(descB),
        age: 30,
        gender: "male",
        genderProb: 0.95,
        features: { ...emptyFeatures(), anatomical: r5UserAnat },
      },
    ];

    const matches = rankByDescriptor(query, mockGallery, 2);
    assert.equal(matches.length, 2);
    assert.equal(
      matches[0]!.celebrityId,
      "cand-a",
      `Candidate A must remain #1 when |Δd| = ${Math.abs(dB - dA).toFixed(4)} >= 0.015`,
    );
  });

  it("does not let a 23-d cross penalty open the morph window when |Δd_deep| >= 0.015", () => {
    const userFeatures: FaceFeatures = {
      ...emptyFeatures(),
      anatomical: r5UserAnat,
    };
    const queryDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.21 + 0.6)));
    const descA = vectorAtEnsembleDistance(queryDesc, 0.150, 1.41);
    const descB = vectorAtEnsembleDistance(queryDesc, 0.172, 2.88);
    const dA = ensembleDistance(queryDesc, descA);
    const dB = ensembleDistance(queryDesc, descB);
    assert.ok(dA < dB);
    assert.ok(Math.abs(dB - dA) >= MORPH_TIE_THRESHOLD_EPS);

    const mismatched23d: FaceFeatures = {
      ...emptyFeatures(),
      eyeSlant: 0.05,
      noseWidth: 0.05,
      anatomical: {
        ...r5UserAnat,
        canthalTiltAngleDeg: -8,
        gonialJawlineAngleDeg: 95,
      },
    };

    const query: UserFaceQuery = {
      descriptor: queryDesc,
      age: 30,
      gender: "male",
      genderProbability: 0.95,
      features: { ...userFeatures },
      ethnicCluster: "Caucasian",
    };

    const matches = rankByDescriptor(
      query,
      [
        {
          id: "cand-a",
          name: "Candidate A",
          path: "/a.jpg",
          descriptor: Array.from(descA),
          age: 30,
          gender: "male",
          genderProb: 0.95,
          features: mismatched23d,
          ethnicCluster: "Caucasian",
        },
        {
          id: "cand-b",
          name: "Candidate B",
          path: "/b.jpg",
          descriptor: Array.from(descB),
          age: 30,
          gender: "male",
          genderProb: 0.95,
          features: { ...emptyFeatures(), anatomical: r5UserAnat },
          ethnicCluster: "Caucasian",
        },
      ],
      2,
    );
    assert.equal(matches.length, 2);
    assert.equal(
      matches[0]!.celebrityId,
      "cand-a",
      "Closer FaceNet candidate must stay #1 when |Δd_deep| >= 0.015 even if 23-d penalty shrinks |Δfine|",
    );
  });

  it("does not let household fame invert a morphological decision inside |Δd| < 0.015", () => {
    const userFeatures: FaceFeatures = {
      ...emptyFeatures(),
      anatomical: r5UserAnat,
    };
    const queryDesc = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.11 + 0.9)));
    const descA = vectorAtEnsembleDistance(queryDesc, 0.150, 1.9);
    const descB = vectorAtEnsembleDistance(queryDesc, 0.152, 3.1);
    const dA = ensembleDistance(queryDesc, descA);
    const dB = ensembleDistance(queryDesc, descB);
    assert.ok(Math.abs(dB - dA) < MORPH_TIE_THRESHOLD_EPS);

    const query: UserFaceQuery = {
      descriptor: queryDesc,
      age: 30,
      gender: "male",
      genderProbability: 0.95,
      features: userFeatures,
    };

    const matches = rankByDescriptor(
      query,
      [
        {
          id: "tom-hanks",
          name: "Tom Hanks",
          path: "/tom-hanks.jpg",
          descriptor: Array.from(descA),
          age: 30,
          gender: "male",
          genderProb: 0.95,
          features: {
            ...emptyFeatures(),
            anatomical: { ...r5UserAnat, canthalTiltAngleDeg: -8, gonialJawlineAngleDeg: 95 },
          },
        },
        {
          id: "unknown-lookalike",
          name: "Unknown Lookalike",
          path: "/unknown.jpg",
          descriptor: Array.from(descB),
          age: 30,
          gender: "male",
          genderProb: 0.95,
          features: { ...emptyFeatures(), anatomical: r5UserAnat },
        },
      ],
      2,
    );
    assert.equal(matches.length, 2);
    assert.equal(
      matches[0]!.celebrityId,
      "unknown-lookalike",
      "Fame/portrait must not undo R5 when anatomy clearly prefers the other candidate",
    );
  });

  it("falls back to D_morph = 0.50 when landmarks or anatomical features are missing or undefined", () => {
    const fallbackVal = computeMorphologicalDistance(null, null);
    assert.equal(fallbackVal, 0.50, "Fallback must be 0.50 for null inputs");

    const fallbackUndefined = computeMorphologicalDistance(undefined, undefined);
    assert.equal(fallbackUndefined, 0.50, "Fallback must be 0.50 for undefined inputs");

    const partialFeat: FaceFeatures = { ...emptyFeatures() };
    delete (partialFeat as any).anatomical;
    const res = computeMorphologicalDistance(partialFeat, null);
    assert.equal(res, 0.50, "Fallback must be 0.50 when one side is null");
  });

  it("meets performance SLA of < 5.0ms per match call for morphological tie-breaker overhead", () => {
    const userAnat: ExtendedAnatomicalFeatures = {
      upperThirdRatio: 0.3333,
      middleThirdRatio: 0.3333,
      lowerThirdRatio: 0.3334,
      lateralFifthsRatios: [0.2, 0.2, 0.2, 0.2, 0.2],
      interCanthalDistance: 0.21,
      canthalTiltAngleDeg: 8.0,
      nasalIndex: 0.70,
      bigonialToBizygomaticRatio: 0.76,
      gonialJawlineAngleDeg: 135.0,
      lipVermilionHeightRatio: 0.625,
      philtrumDepth: 0.50,
    };
    const userFeatures: FaceFeatures = {
      ...emptyFeatures(),
      anatomical: userAnat,
    };

    const mockCelebs: CelebrityEmbedding[] = Array.from({ length: 50 }, (_, i) => ({
      id: `celeb-${i}`,
      name: `Celeb ${i}`,
      path: `/celeb-${i}.jpg`,
      descriptor: Array.from(new Float32Array(128).fill(0.1 + (i % 3) * 0.002)),
      age: 30,
      gender: "male",
      genderProb: 0.95,
      features: {
        ...emptyFeatures(),
        anatomical: {
          ...userAnat,
          canthalTiltAngleDeg: 8.0 + (i % 5),
          gonialJawlineAngleDeg: 135.0 - (i % 7),
        },
      },
    }));

    const query: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 30,
      gender: "male",
      genderProbability: 0.95,
      features: userFeatures,
    };

    for (let i = 0; i < 15; i++) {
      rankByDescriptor(query, mockCelebs, 5);
    }
    const start = performance.now();
    const iterations = 80;
    for (let i = 0; i < iterations; i++) {
      rankByDescriptor(query, mockCelebs, 5);
    }
    const totalElapsed = performance.now() - start;
    const avgMsPerCall = totalElapsed / iterations;

    assert.ok(
      avgMsPerCall < 5.0,
      `Morphological tie-breaker overhead (${avgMsPerCall.toFixed(3)}ms/call) must be < 5.0ms after warmup`,
    );
  });
});

describe("F1: weak neighborhood effective-distance re-sort", () => {
  it("IMG_3936 Face 2: weak top-K respects effective distance ranking (Reese → Chastain → Saoirse)", () => {
    // Female Caucasian query; all raw FaceNet % < 55 (weak band).
    // Distances spaced |Δd| ≥ 0.015 so R5 morph window is closed.
    // Saoirse carries a cross-demographic cluster penalty (~0.22) that properly
    // ranks Chastain (d=0.41, Caucasian) above Saoirse (d_eff = 0.385 + 0.22 = 0.605).
    const queryDesc = l2Normalize(
      Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.19 + 0.3)),
    );
    const descReese = vectorAtEnsembleDistance(queryDesc, 0.36, 1.1);
    const descSaoirse = vectorAtEnsembleDistance(queryDesc, 0.385, 2.2);
    const descChastain = vectorAtEnsembleDistance(queryDesc, 0.41, 3.3);

    const dReese = ensembleDistance(queryDesc, descReese);
    const dSaoirse = ensembleDistance(queryDesc, descSaoirse);
    const dChastain = ensembleDistance(queryDesc, descChastain);

    assert.ok(dReese < dSaoirse && dSaoirse < dChastain);
    assert.ok(dSaoirse - dReese >= MORPH_TIE_THRESHOLD_EPS);
    assert.ok(dChastain - dSaoirse >= MORPH_TIE_THRESHOLD_EPS);
    assert.ok(
      distanceToMatchPercent(dReese) < 55,
      `best raw % must be weak (<55), got ${distanceToMatchPercent(dReese)}`,
    );

    assert.ok(
      dSaoirse + 0.22 > dChastain,
      "fixture must invert Saoirse/Chastain under dist+crossPenalty ranking",
    );

    const userFeat = feat({
      skinL: 0.72,
      eyeSlant: 0.45,
      noseWidth: 0.42,
      feminine: 0.85,
      masculine: 0.2,
    });

    const query: UserFaceQuery = {
      descriptor: queryDesc,
      age: 34,
      gender: "female",
      genderProbability: 0.96,
      features: userFeat,
      ethnicCluster: "Caucasian",
    };

    const gallery: CelebrityEmbedding[] = [
      {
        id: "reese-witherspoon",
        name: "Reese Witherspoon",
        path: "/celebs/reese-witherspoon.jpg",
        fallbackPath: "/celebs/reese-witherspoon.jpg",
        descriptor: Array.from(descReese),
        age: 48,
        gender: "female",
        genderProb: 0.95,
        features: { ...userFeat },
        ethnicCluster: "Caucasian",
      },
      {
        id: "saoirse-ronan",
        name: "Saoirse Ronan",
        path: "/celebs/saoirse-ronan.jpg",
        fallbackPath: "/celebs/saoirse-ronan.jpg",
        descriptor: Array.from(descSaoirse),
        age: 30,
        gender: "female",
        genderProb: 0.95,
        // Cluster mismatch forces ~0.22 cross-demo penalty → places Chastain ahead under effective distance
        features: feat({
          skinL: 0.35,
          eyeSlant: 0.85,
          noseWidth: 0.7,
          feminine: 0.8,
          masculine: 0.2,
        }),
        ethnicCluster: "East Asian",
      },
      {
        id: "jessica-chastain",
        name: "Jessica Chastain",
        path: "/celebs/jessica-chastain.jpg",
        fallbackPath: "/celebs/jessica-chastain.jpg",
        descriptor: Array.from(descChastain),
        age: 47,
        gender: "female",
        genderProb: 0.95,
        features: { ...userFeat },
        ethnicCluster: "Caucasian",
      },
    ];

    const matches = rankByDescriptor(query, gallery, 3);
    assert.equal(matches.length, 3);
    assert.deepEqual(
      matches.map((m) => m.celebrityId),
      ["reese-witherspoon", "jessica-chastain", "saoirse-ronan"],
      "weak neighborhood must rank by effective distance (d + penalties)",
    );

    for (const m of matches) {
      assert.ok(
        m.matchPercent < 55,
        `${m.celebrityId} matchPercent ${m.matchPercent} must stay weak (<55)`,
      );
    }
  });
});

describe("Requirement R2: Calibrated Age-Gap Penalty for Weak/Borderline Matches", () => {
  it("returns exactly 0.0 penalty for strong matches (d <= 0.40) regardless of age gap", () => {
    assert.equal(calibratedAgeGapPenalty(0.0, 50, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.30, 60, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.35, 45, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.40, 50, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.39, 80, 20), 0.0);
  });

  it("returns exactly 0.0 penalty for close-age peers (|Δage| <= 20) regardless of distance", () => {
    assert.equal(calibratedAgeGapPenalty(0.45, 45, 40), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.55, 50, 35), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.70, 30, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.48, 50, 30), 0.0); // exactly delta=20
  });

  it("evaluates smooth super-linear non-linear penalty for d > 0.40 and |Δage| > 20", () => {
    const p41 = calibratedAgeGapPenalty(0.41, 45, 20);
    const p42 = calibratedAgeGapPenalty(0.42, 45, 20);
    const p45 = calibratedAgeGapPenalty(0.45, 45, 20);
    const p50 = calibratedAgeGapPenalty(0.50, 45, 20);

    assert.ok(p41 > 0.0);
    assert.ok(p42 > p41);
    assert.ok(p45 > p42);
    assert.ok(p50 > p45);

    // Super-linear scaling with age gap
    const pDelta22 = calibratedAgeGapPenalty(0.45, 42, 20); // delta = 22
    const pDelta30 = calibratedAgeGapPenalty(0.45, 50, 20); // delta = 30
    const pDelta40 = calibratedAgeGapPenalty(0.45, 60, 20); // delta = 40
    assert.ok(pDelta30 > pDelta22 * 2.0);
    assert.ok(pDelta40 > pDelta30 * 1.5);
  });

  it("penalizes 20-year-olds below closer-age candidates for mature queries (age >= 40) at d > 0.40", () => {
    const queryDesc = l2Normalize(
      Float32Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0)),
    );

    // Young candidate: 20yo, weak distance d ≈ 0.420
    const youngDesc = vectorAtEnsembleDistance(queryDesc, 0.420, 1.5);
    // Mature candidate: 48yo, slightly higher distance d ≈ 0.430
    const matureDesc = vectorAtEnsembleDistance(queryDesc, 0.430, 2.5);

    const dYoung = ensembleDistance(queryDesc, youngDesc);
    const dMature = ensembleDistance(queryDesc, matureDesc);
    assert.ok(dYoung < dMature, `Young (${dYoung}) must be closer in raw distance than Mature (${dMature})`);

    const user: UserFaceQuery = {
      descriptor: queryDesc,
      age: 50,
      gender: "female",
      genderProbability: 0.95,
    };

    const gallery: CelebrityEmbedding[] = [
      {
        id: "young-star",
        name: "Young Star",
        path: "/celebs/young.jpg",
        fallbackPath: "/celebs/young.jpg",
        descriptor: Array.from(youngDesc),
        age: 20,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "mature-star",
        name: "Mature Star",
        path: "/celebs/mature.jpg",
        fallbackPath: "/celebs/mature.jpg",
        descriptor: Array.from(matureDesc),
        age: 48,
        gender: "female",
        genderProb: 0.95,
      },
    ];

    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(matches.length, 2);
    assert.equal(
      matches[0]!.celebrityId,
      "mature-star",
      "Mature candidate (48yo, d=0.430) must rank above weak 20yo (d=0.420) for 50yo query due to age penalty",
    );
  });

  it("does NOT penalize 20-year-old candidates when query user is young (e.g. age 22)", () => {
    const queryDesc = l2Normalize(
      Float32Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0)),
    );

    const youngDesc = vectorAtEnsembleDistance(queryDesc, 0.420, 1.5);
    const matureDesc = vectorAtEnsembleDistance(queryDesc, 0.430, 2.5);

    const user: UserFaceQuery = {
      descriptor: queryDesc,
      age: 22,
      gender: "female",
      genderProbability: 0.95,
    };

    const gallery: CelebrityEmbedding[] = [
      {
        id: "young-star",
        name: "Young Star",
        path: "/celebs/young.jpg",
        fallbackPath: "/celebs/young.jpg",
        descriptor: Array.from(youngDesc),
        age: 20,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "mature-star",
        name: "Mature Star",
        path: "/celebs/mature.jpg",
        fallbackPath: "/celebs/mature.jpg",
        descriptor: Array.from(matureDesc),
        age: 48,
        gender: "female",
        genderProb: 0.95,
      },
    ];

    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(matches[0]!.celebrityId, "young-star");
  });

  it("preserves true strong lookalikes (d <= 0.40) regardless of age difference", () => {
    const queryDesc = l2Normalize(
      Float32Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0)),
    );

    // Strong lookalike: 20yo with high affinity d ≈ 0.350
    const twinDesc = vectorAtEnsembleDistance(queryDesc, 0.350, 1.5);
    // Farther candidate: 50yo with d ≈ 0.410
    const farDesc = vectorAtEnsembleDistance(queryDesc, 0.410, 2.5);

    const user: UserFaceQuery = {
      descriptor: queryDesc,
      age: 50,
      gender: "female",
      genderProbability: 0.95,
    };

    const gallery: CelebrityEmbedding[] = [
      {
        id: "young-twin",
        name: "Young Twin",
        path: "/celebs/young-twin.jpg",
        fallbackPath: "/celebs/young-twin.jpg",
        descriptor: Array.from(twinDesc),
        age: 20,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "peer-distant",
        name: "Peer Distant",
        path: "/celebs/peer-distant.jpg",
        fallbackPath: "/celebs/peer-distant.jpg",
        descriptor: Array.from(farDesc),
        age: 50,
        gender: "female",
        genderProb: 0.95,
      },
    ];

    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(matches[0]!.celebrityId, "young-twin", "Strong lookalike (d=0.35) must win regardless of age gap");
  });

  it("handles edge cases safely: NaN, null, undefined, negative values", () => {
    assert.equal(calibratedAgeGapPenalty(NaN, 45, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.45, NaN, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.45, 45, NaN), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.45, null, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.45, 45, null), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.45, -5, 20), 0.0);
    assert.equal(calibratedAgeGapPenalty(0.45, 45, -20), 0.0);
  });
});


