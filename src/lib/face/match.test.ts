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
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";
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
  it("computes continuous Gaussian age affinity smoothly", () => {
    assert.equal(ageAffinity(25, 25), 1.0);
    const a10 = ageAffinity(25, 35);
    const expected10 = Math.exp(-Math.pow(10 / 28, 2));
    assert.ok(Math.abs(a10 - expected10) < 1e-6);

    // Strict monotonicity with increasing age delta
    assert.ok(ageAffinity(25, 26) > ageAffinity(25, 30));
    assert.ok(ageAffinity(25, 30) > ageAffinity(25, 40));
    assert.ok(ageAffinity(25, 40) > ageAffinity(25, 60));

    // Non-filtering: age affinity remains strictly positive even for large age gaps
    assert.ok(ageAffinity(20, 95) > 0, "Age affinity must be non-zero for large age gap");
  });

  it("weights gender affinity smoothly without step function discontinuities and within [0.78, 1.0]", () => {
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
    assert.equal(gMaxProb, 0.78);
    assert.ok(g3 >= 0.78 && g3 <= 1.0);
    assert.equal(genderAffinity("unknown", 0.99, maleCeleb), 1.0);
    assert.equal(genderAffinity("male", 0.99, maleCeleb), 1.0);
  });

  it("ensures demographic priors act as soft priors without hard filtering in rankByDescriptor", () => {
    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 25,
      gender: "female",
      genderProbability: 0.95,
    };

    // Candidate A has excellent facial descriptor match (0.12) but different demographics (male, age 65)
    // Candidate B has poor facial descriptor match (0.50) but matching demographics (female, age 25)
    const mockGallery: CelebrityEmbedding[] = [
      {
        id: "celeb-a-diff-demo",
        name: "Celeb A",
        path: "/a.webp",
        descriptor: new Array(128).fill(0.12),
        age: 65,
        gender: "male",
        genderProb: 0.95,
      },
      {
        id: "celeb-b-same-demo",
        name: "Celeb B",
        path: "/b.webp",
        descriptor: new Array(128).fill(0.50),
        age: 25,
        gender: "female",
        genderProb: 0.95,
      },
    ];

    const matches = rankByDescriptor(user, mockGallery, 2);
    assert.equal(matches.length, 2, "Both candidates should be returned without hard filtering");
    // Candidate A must rank #1 because facial feature match (descriptor distance) dominates soft demographic priors
    assert.equal(matches[0]!.celebrityId, "celeb-a-diff-demo");
  });

  it("uses soft demographic priors for candidate tie-breaking when descriptor distances are equal", () => {
    const user: UserFaceQuery = {
      descriptor: new Float32Array(128).fill(0.1),
      age: 25,
      gender: "female",
      genderProbability: 0.95,
    };

    // Candidate A and B have identical facial descriptors (distance 0.12)
    // Candidate A matches demographics (female, 26)
    // Candidate B differs in demographics (male, 60)
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

