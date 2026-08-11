import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  dist,
  weightedCosineSimilarity,
  weightedL1Similarity,
  ensembleScore,
  calibrateMatchPercents,
  traitSimilarity,
  emptyFeatures,
  mergeFeatures,
  rgbToApproxLab,
} from "./math.ts";
import type { FaceFeatures } from "./types.ts";

function feat(partial: Partial<FaceFeatures>): FaceFeatures {
  return mergeFeatures(partial);
}

describe("clamp", () => {
  it("bounds values to [0,1] by default", () => {
    assert.equal(clamp(-1), 0);
    assert.equal(clamp(0.5), 0.5);
    assert.equal(clamp(2), 1);
  });
});

describe("dist", () => {
  it("computes Euclidean distance", () => {
    assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });
});

describe("similarity metrics", () => {
  it("identical features score near 1", () => {
    const a = emptyFeatures();
    assert.ok(weightedL1Similarity(a, a) > 0.99);
    assert.ok(weightedCosineSimilarity(a, a) > 0.99);
    assert.ok(ensembleScore(a, a) > 0.99);
  });

  it("opposite extremes score lower than near neighbors", () => {
    const base = feat({ jawWidth: 0.5, cheekboneProminence: 0.5, skinL: 0.5 });
    const near = feat({ jawWidth: 0.55, cheekboneProminence: 0.52, skinL: 0.48 });
    const far = feat({ jawWidth: 0.05, cheekboneProminence: 0.95, skinL: 0.1 });
    assert.ok(ensembleScore(base, near) > ensembleScore(base, far));
  });

  it("traitSimilarity is 1 for equal and 0 for opposite ends", () => {
    assert.equal(traitSimilarity(0.4, 0.4), 1);
    assert.equal(traitSimilarity(0, 1), 0);
  });
});

describe("calibrateMatchPercents", () => {
  it("returns empty for empty input", () => {
    assert.deepEqual(calibrateMatchPercents([]), []);
  });

  it("ranks top score highest and keeps others below", () => {
    const scores = [0.7, 0.9, 0.65, 0.8];
    const pct = calibrateMatchPercents(scores);
    assert.equal(pct.length, 4);
    const topIdx = scores.indexOf(Math.max(...scores));
    for (let i = 0; i < pct.length; i++) {
      if (i !== topIdx) assert.ok((pct[i] ?? 0) < (pct[topIdx] ?? 0));
    }
    assert.ok((pct[topIdx] ?? 0) >= 62);
    assert.ok((pct[topIdx] ?? 0) <= 98);
  });

  it("is monotonic with raw quality for single candidate", () => {
    const low = calibrateMatchPercents([0.5])[0] ?? 0;
    const high = calibrateMatchPercents([0.95])[0] ?? 0;
    assert.ok(high > low);
  });
});

describe("rgbToApproxLab", () => {
  it("maps pure white to high L", () => {
    const lab = rgbToApproxLab(255, 255, 255);
    assert.ok(lab.L > 0.9);
  });

  it("maps pure black to low L", () => {
    const lab = rgbToApproxLab(0, 0, 0);
    assert.ok(lab.L < 0.05);
  });
});
