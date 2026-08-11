import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankCelebrities } from "./match-geometry.ts";
import {
  euclideanDistance,
  distanceToMatchPercent,
  rankPercentsFromDistances,
} from "./embeddings.ts";
import { mergeFeatures, emptyFeatures } from "./math.ts";
import { CELEBRITIES, getCelebrityById } from "../celebrities/database.ts";
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

  it("distanceToMatchPercent is high for close faces", () => {
    assert.ok(distanceToMatchPercent(0.3) > distanceToMatchPercent(0.6));
    assert.ok(distanceToMatchPercent(0.35) >= 70);
    assert.ok(distanceToMatchPercent(0.9) < 45);
  });

  it("rank percents preserve distance order", () => {
    const d = [0.7, 0.4, 0.55];
    const p = rankPercentsFromDistances(d);
    assert.ok(p[1]! > p[2]!);
    assert.ok(p[2]! > p[0]!);
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
