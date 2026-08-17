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

  it("calibrates Hill curve at live FaceNet distance anchors", () => {
    assert.equal(distanceToMatchPercent(0.6), 50.0);
    assert.equal(distanceToMatchPercent(0.30), 94.5);
    assert.equal(distanceToMatchPercent(0.45), 76.5);
    assert.equal(distanceToMatchPercent(0.85), 19.3);
    assert.equal(distanceToMatchPercent(1.2), 5.5);
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
    // Hill saturates near 0 for large d — allow equality once floored.
    assert.ok(distanceToMatchPercent(0.6) >= distanceToMatchPercent(0.9));
    assert.ok(distanceToMatchPercent(0.9) >= distanceToMatchPercent(1.2));
    assert.ok(distanceToMatchPercent(1.2) >= distanceToMatchPercent(1.5));
  });

  it("rank percents preserve distance order", () => {
    const d = [0.7, 0.4, 0.55];
    const p = rankPercentsFromDistances(d);
    assert.ok(p[1]! > p[2]!);
    assert.ok(p[2]! > p[0]!);
  });

  it("rankByDescriptor refuses far open-set neighbors instead of forcing top-K", () => {
    const far = Array.from({ length: 256 }, (_, i) => (i === 10 ? 1 : 0));
    const other = Array.from({ length: 256 }, (_, i) => (i === 200 ? 1 : 0));
    const gallery: CelebrityEmbedding[] = [
      {
        id: "a",
        name: "A",
        path: "/a.jpg",
        descriptor: far,
        age: 40,
        gender: "female",
        genderProb: 0.9,
      },
      {
        id: "b",
        name: "B",
        path: "/b.jpg",
        descriptor: other,
        age: 40,
        gender: "male",
        genderProb: 0.9,
      },
    ];
    const user: UserFaceQuery = {
      descriptor: Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)),
      age: 35,
      gender: "female",
      genderProbability: 0.9,
    };
    const matches = rankByDescriptor(user, gallery, 5);
    assert.equal(matches.length, 0);
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
  });

  it("weights gender affinity smoothly without step function discontinuities", () => {
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

    assert.ok(g1 >= g2);
    assert.ok(g2 >= g3);
    assert.ok(g3 >= 0.75 && g3 <= 1.0);
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

describe("Demographic Prior Softening & Uncertainty Scaling (R3 Recalibration)", () => {
  it("ensures visual facial geometry dominates over demographic mismatch", () => {
    // True biometric match: d = 0.10, but cross-gender (female vs male) and 30-year age gap
    // Distractor: d = 0.40, but perfect gender & age match
    const queryVec = new Float32Array(256);
    queryVec[0] = 1.0;

    const trueMatchVec = new Float32Array(256);
    // Vector with cosine distance ~0.10: cos(theta) = 0.90
    trueMatchVec[0] = 0.90;
    trueMatchVec[1] = Math.sqrt(1 - 0.90 * 0.90);

    const distractorVec = new Float32Array(256);
    // Vector with cosine distance ~0.40: cos(theta) = 0.60
    distractorVec[0] = 0.60;
    distractorVec[2] = Math.sqrt(1 - 0.60 * 0.60);

    const user: UserFaceQuery = {
      descriptor: queryVec,
      age: 22,
      gender: "female",
      genderProbability: 0.99,
    };

    const gallery: CelebrityEmbedding[] = [
      {
        id: "visual-twin-cross-demo",
        name: "Visual Twin Cross Demo",
        path: "/twin.webp",
        descriptor: Array.from(trueMatchVec),
        age: 55, // 33-year age gap
        gender: "male", // opposite gender
        genderProb: 0.99,
      },
      {
        id: "visual-distractor-same-demo",
        name: "Visual Distractor Same Demo",
        path: "/distractor.webp",
        descriptor: Array.from(distractorVec),
        age: 22, // exact age match
        gender: "female", // same gender
        genderProb: 0.99,
      },
    ];

    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(matches.length, 2);
    assert.equal(
      matches[0]?.celebrityId,
      "visual-twin-cross-demo",
      "Visual geometry must outrank demographic match",
    );
    assert.ok(
      matches[0]!.matchPercent > matches[1]!.matchPercent,
      "True visual match percent must be higher than distractor",
    );
  });

  it("degrades gracefully without penalties on unknown or missing demographics", () => {
    const queryVec = new Float32Array(256);
    queryVec[0] = 1.0;

    const userUnknown: UserFaceQuery = {
      descriptor: queryVec,
      age: NaN,
      gender: "unknown",
      genderProbability: 0.5,
    };

    const gallery: CelebrityEmbedding[] = [
      {
        id: "celeb-a",
        name: "Celeb A",
        path: "/a.webp",
        descriptor: Array.from(queryVec),
        age: 35,
        gender: "female",
        genderProb: 0.9,
      },
    ];

    const matches = rankByDescriptor(userUnknown, gallery, 1);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.celebrityId, "celeb-a");
    assert.equal(matches[0]?.matchPercent, 100.0);
  });

  it("deduplicates multiple age-buckets by selecting lowest adjusted distance", () => {
    const queryVec = new Float32Array(256);
    queryVec[0] = 1.0;

    const nearVec = new Float32Array(256);
    nearVec[0] = 0.95;
    nearVec[1] = Math.sqrt(1 - 0.95 * 0.95);

    const farVec = new Float32Array(256);
    farVec[0] = 0.50;
    farVec[1] = Math.sqrt(1 - 0.50 * 0.50);

    const user: UserFaceQuery = {
      descriptor: queryVec,
      age: 30,
      gender: "male",
      genderProbability: 0.95,
    };

    const multiBucketGallery: CelebrityEmbedding[] = [
      {
        id: "actor-multi",
        name: "Actor Multi",
        path: "/actor_old.webp",
        descriptor: Array.from(farVec),
        age: 65,
        gender: "male",
        genderProb: 0.95,
      },
      {
        id: "actor-multi",
        name: "Actor Multi",
        path: "/actor_young.webp",
        descriptor: Array.from(nearVec),
        age: 28,
        gender: "male",
        genderProb: 0.95,
      },
    ];

    const matches = rankByDescriptor(user, multiBucketGallery, 5);
    assert.equal(matches.length, 1, "Should deduplicate to 1 entry per celebrity ID");
    assert.equal(matches[0]?.photoUrl, "/actor_young.webp", "Should select the younger/closer bucket");
  });
});

function axisVector(index: number, dim = 256): Float32Array {
  const v = new Float32Array(dim);
  v[index] = 1;
  return v;
}

function vectorAtCosineDistance(distance: number, dim = 256): Float32Array {
  const v = new Float32Array(dim);
  const cos = 1 - distance;
  v[0] = cos;
  v[1] = Math.sqrt(Math.max(0, 1 - cos * cos));
  return v;
}

describe("open-set margin calibration in rankByDescriptor", () => {
  it("keeps identity-range percents at full Hill even with a nearby distractor", () => {
    const user: UserFaceQuery = {
      descriptor: axisVector(0),
      age: 30,
      gender: "female",
      genderProbability: 0.95,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "self",
        name: "Self",
        path: "/self.webp",
        descriptor: Array.from(vectorAtCosineDistance(0.1)),
        age: 30,
        gender: "female",
        genderProb: 0.95,
      },
      {
        id: "near",
        name: "Near",
        path: "/near.webp",
        descriptor: Array.from(vectorAtCosineDistance(0.18)),
        age: 30,
        gender: "female",
        genderProb: 0.95,
      },
    ];
    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(matches[0]?.celebrityId, "self");
    assert.equal(matches[0]?.matchPercent, matches[0]?.hillPercent);
    assert.ok((matches[0]?.matchPercent ?? 0) >= 90);
  });

  it("pulls a crowded open-set nearest-neighbor out of the 60–75% band", () => {
    const user: UserFaceQuery = {
      descriptor: axisVector(0),
      age: 35,
      gender: "unknown",
      genderProbability: 0.5,
    };
    const gallery: CelebrityEmbedding[] = [
      {
        id: "emma-style",
        name: "Crowded Neighbor",
        path: "/a.webp",
        descriptor: Array.from(vectorAtCosineDistance(0.54)),
        age: 35,
        gender: "female",
        genderProb: 0.9,
      },
      {
        id: "almost-as-close",
        name: "Runner Up",
        path: "/b.webp",
        descriptor: Array.from(vectorAtCosineDistance(0.56)),
        age: 35,
        gender: "female",
        genderProb: 0.9,
      },
    ];
    const matches = rankByDescriptor(user, gallery, 2);
    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.celebrityId, "emma-style");
    assert.ok((matches[0]?.rankMargin ?? 1) < 0.05);
    assert.ok((matches[0]?.hillPercent ?? 0) >= 55);
    assert.ok(
      (matches[0]?.matchPercent ?? 100) < 55,
      `crowded open-set should display as weak, got ${matches[0]?.matchPercent}% (hill ${matches[0]?.hillPercent}%)`,
    );
    assert.ok((matches[0]?.matchPercent ?? 0) < (matches[0]?.hillPercent ?? 0));
  });
});

