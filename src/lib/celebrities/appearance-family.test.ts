import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CelebrityEmbedding } from "../face/embeddings.ts";
import { l2Normalize } from "../face/embeddings.ts";
import { rankByDescriptor, type UserFaceQuery } from "../face/match.ts";
import {
  applyAppearanceFamilyManifest,
  appearanceFamilyCount,
  appearanceFamilyFor,
  classifyProbeAppearance,
  familiesCompatible,
  filterRanksByAppearanceFamily,
  resetAppearanceFamiliesForTests,
} from "./appearance-family.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const FAMILIES_PATH = join(ROOT, "public/celebs/appearance-families.json");

function axis(index: number, dim = 32): Float32Array {
  const v = new Float32Array(dim);
  v[index] = 1;
  return v;
}

function mix(a: Float32Array, b: Float32Array, aWeight: number): Float32Array {
  const out = new Float32Array(a.length);
  const bWeight = Math.sqrt(1 - aWeight * aWeight);
  for (let i = 0; i < a.length; i++) {
    out[i] = (a[i] ?? 0) * aWeight + (b[i] ?? 0) * bWeight;
  }
  return l2Normalize(out);
}

function celeb(
  id: string,
  descriptor: Float32Array,
  gender: "male" | "female" = "female",
): CelebrityEmbedding {
  return {
    id,
    name: id,
    path: `/${id}.jpg`,
    descriptor: Array.from(descriptor),
    age: 36,
    gender,
    genderProb: 0.95,
  };
}

describe("appearance glance families", () => {
  afterEach(() => {
    resetAppearanceFamiliesForTests();
  });

  it("ships glance labels for the swing-probe mismatch pair", () => {
    applyAppearanceFamilyManifest(JSON.parse(readFileSync(FAMILIES_PATH, "utf8")));
    assert.ok(appearanceFamilyCount() >= 400);
    assert.equal(appearanceFamilyFor("sandra-oh"), "east_asian");
    assert.equal(appearanceFamilyFor("wendy-mericle"), "white");
    assert.equal(appearanceFamilyFor("halle-berry"), "black");
    assert.equal(appearanceFamilyFor("maitreyi-ramakrishnan"), "south_asian");
    assert.equal(familiesCompatible("white", appearanceFamilyFor("sandra-oh")), false);
  });

  it("treats unknown as compatible with every family", () => {
    assert.equal(familiesCompatible("unknown", "east_asian"), true);
    assert.equal(familiesCompatible("white", "unknown"), true);
    assert.equal(familiesCompatible("white", "east_asian"), false);
    assert.equal(familiesCompatible("white", "black"), false);
    assert.equal(familiesCompatible("white", "south_asian"), false);
    assert.equal(familiesCompatible("white", "latine"), true);
    assert.equal(familiesCompatible("east_asian", "east_asian"), true);
  });

  it("drops an incompatible #1 and keeps a glance-plausible neighbor", () => {
    applyAppearanceFamilyManifest({
      "sandra-oh": "east_asian",
      "wendy-mericle": "white",
    });
    const ranked = [
      { celeb: { id: "sandra-oh" } },
      { celeb: { id: "wendy-mericle" } },
    ];
    const kept = filterRanksByAppearanceFamily(ranked, "white");
    assert.deepEqual(
      kept.map((row) => row.celeb.id),
      ["wendy-mericle"],
    );
  });

  it("classifies a probe from family centroids and re-ranks past a cross-family nearest neighbor", () => {
    const labels: Record<string, string> = {};
    const gallery: CelebrityEmbedding[] = [];
    for (let i = 0; i < 8; i++) {
      const id = `white-${i}`;
      labels[id] = "white";
      gallery.push(celeb(id, mix(axis(0), axis(5), 0.7)));
    }
    for (let i = 0; i < 8; i++) {
      const id = `east-${i}`;
      labels[id] = "east_asian";
      gallery.push(celeb(id, mix(axis(1), axis(4), 0.98)));
    }
    labels["sandra-oh"] = "east_asian";
    labels["wendy-mericle"] = "white";
    gallery.push(celeb("sandra-oh", mix(axis(0), axis(1), 0.92)));
    gallery.push(celeb("wendy-mericle", mix(axis(0), axis(2), 0.82)));

    applyAppearanceFamilyManifest(labels);
    assert.equal(appearanceFamilyFor("sandra-oh"), "east_asian");

    const guess = classifyProbeAppearance(axis(0), gallery);
    assert.equal(guess.family, "white");
    assert.ok(guess.margin >= 0.012);

    const user: UserFaceQuery = {
      descriptor: axis(0),
      age: 32,
      gender: "female",
      genderProbability: 0.95,
    };
    const matches = rankByDescriptor(user, gallery, 5);
    assert.ok(matches.length >= 1);
    assert.notEqual(matches[0]?.celebrityId, "sandra-oh");
    assert.ok(
      matches.every((row) => appearanceFamilyFor(row.celebrityId) !== "east_asian"),
    );
    assert.equal(matches[0]?.celebrityId, "wendy-mericle");
  });
});
