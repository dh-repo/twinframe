import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankCelebrities } from "./match-geometry.ts";
import {
  euclideanDistance,
  distanceToMatchPercent,
  rankPercentsFromDistances,
  ageAffinity,
  genderAffinity,
  computeMatchConfidence,
  type CelebrityEmbedding,
} from "./embeddings.ts";
import { rankByDescriptor, minTemplateDistance, isPrimaryGalleryEntry, householdFame, type UserFaceQuery } from "./match.ts";
import { mergeFeatures, emptyFeatures } from "./math.ts";
import { CELEBRITIES, getCelebrityById } from "../celebrities/database.ts";
import { catalogFor } from "../celebrities/catalog.ts";
import type { FaceFeatures } from "./types.ts";
import type { CelebrityProfile } from "../celebrities/types.ts";

function feat(partial: Partial<FaceFeatures>): FaceFeatures {
  return mergeFeatures(partial);
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

  it("outputs 4 granular traits in rankByDescriptor", () => {
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
    assert.ok(labels.includes("Facial Structure"));
    assert.ok(labels.includes("Age Affinity"));
    assert.ok(labels.includes("Gender Presentation"));
    assert.ok(labels.includes("Lighting & Quality"));
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

