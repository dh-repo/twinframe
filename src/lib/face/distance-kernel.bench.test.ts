import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensembleDistance, ensembleKernel128, l2Normalize } from "./embeddings.ts";

describe("Distance kernel", () => {
  it("matches ALG-01 ensembleDistance on Float32 pairs", () => {
    const a = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.2)));
    const b = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.13)));
    const slow = ensembleDistance(a, b);
    const fast = ensembleKernel128(a, b);
    assert.ok(Math.abs(slow - fast) < 1e-6, `${slow} vs ${fast}`);
  });

  it("evaluates 10,000 pairs under 8ms (JS unroll floor; 0.4ms is the WASM stretch)", () => {
    const pairs: Array<[Float32Array, Float32Array]> = [];
    for (let n = 0; n < 10000; n++) {
      const a = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.sin((i + 1) * (n + 1) * 0.017)));
      const b = l2Normalize(Float32Array.from({ length: 128 }, (_, i) => Math.cos((i + 3) * (n + 2) * 0.011)));
      pairs.push([a, b]);
    }
    for (let i = 0; i < 200; i++) ensembleKernel128(pairs[i]![0], pairs[i]![1]);
    const t0 = performance.now();
    let acc = 0;
    for (const [a, b] of pairs) acc += ensembleKernel128(a, b);
    const ms = performance.now() - t0;
    assert.ok(Number.isFinite(acc));
    assert.ok(ms < 8, `10k kernel took ${ms.toFixed(3)}ms`);
  });
});
