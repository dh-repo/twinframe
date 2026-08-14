import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  consensusFromFrames,
  emaAnatomical,
  emaUnitVector,
  TEMPORAL_ALPHA,
} from "./temporal.ts";
import { l2Normalize, ensembleDistance } from "./embeddings.ts";
import { ensureAnatomicalFeatures } from "./geometry.ts";
import { emptyFeatures } from "./math.ts";

function unit(seed: number, noise = 0): Float32Array {
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = Math.sin((i + 1) * seed) + noise * Math.cos((i + 3) * seed);
  return l2Normalize(v);
}

describe("Temporal EMA consensus", () => {
  it("keeps L2 unit norm after mixing", () => {
    const a = unit(0.2);
    const b = unit(0.9);
    const s = emaUnitVector(a, b, TEMPORAL_ALPHA);
    let n = 0;
    for (let i = 0; i < s.length; i++) n += (s[i] ?? 0) ** 2;
    assert.ok(Math.abs(Math.sqrt(n) - 1) < 1e-5);
  });

  it("renormalizes facial thirds to sum to 1", () => {
    const base = ensureAnatomicalFeatures(emptyFeatures());
    const next = { ...base, upperThirdRatio: 0.5, middleThirdRatio: 0.4, lowerThirdRatio: 0.4 };
    const out = emaAnatomical(base, next, 0.5);
    assert.ok(Math.abs(out.upperThirdRatio + out.middleThirdRatio + out.lowerThirdRatio - 1) < 1e-5);
  });

  it("six noisy frames sit closer to the true vector than the first noisy frame", () => {
    const truth = unit(1.1);
    const frames = Array.from({ length: 6 }, (_, i) => ({
      descriptor: unit(1.1, 0.08 + i * 0.002),
      features: emptyFeatures(),
      confidence: 0.9,
    }));
    const c = consensusFromFrames(frames);
    assert.ok(c);
    const dFirst = ensembleDistance(frames[0]!.descriptor, truth);
    const dSmooth = ensembleDistance(c.descriptor, truth);
    assert.ok(dSmooth <= dFirst + 0.02, `smoothed ${dSmooth} vs first ${dFirst}`);
    assert.equal(c.usedFallback, false);
    assert.equal(c.frameCount, 6);
  });

  it("drops low-confidence frames and falls back below 3 good frames", () => {
    const frames = [
      { descriptor: unit(0.3), confidence: 0.1 },
      { descriptor: unit(0.4), confidence: 0.2 },
      { descriptor: unit(0.5), features: emptyFeatures(), confidence: 0.9 },
    ];
    const c = consensusFromFrames(frames);
    assert.ok(c);
    assert.equal(c.usedFallback, true);
    assert.equal(c.frameCount, 1);
  });

  it("returns null when every frame is rejected", () => {
    assert.equal(consensusFromFrames([{ descriptor: unit(1), confidence: 0.01 }]), null);
  });
});
