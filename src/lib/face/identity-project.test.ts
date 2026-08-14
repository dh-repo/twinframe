import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateNuissanceDirections,
  projectIdentity,
  shouldProjectIdentity,
} from "./identity-project.ts";
import { l2Normalize } from "./embeddings.ts";

function unit(seed: number): Float32Array {
  const v = new Float32Array(128);
  for (let i = 0; i < 128; i++) v[i] = Math.sin((i + 1) * seed);
  return l2Normalize(v);
}

describe("Identity projection", () => {
  it("reduces energy along an estimated nuisance direction", () => {
    const identity = unit(0.41);
    const hair = new Float32Array(128);
    for (let i = 0; i < 128; i++) hair[i] = i < 16 ? 1 : 0;
    const hairDir = l2Normalize(hair);
    const residuals = [0.12, 0.18, 0.25, -0.14, 0.2].map((s) => {
      const r = new Float32Array(128);
      for (let i = 0; i < 128; i++) r[i] = s * (hairDir[i] ?? 0);
      return r;
    });
    const dirs = estimateNuissanceDirections(residuals, 1);
    assert.equal(dirs.length, 1);
    const mixed = new Float32Array(128);
    for (let i = 0; i < 128; i++) mixed[i] = (identity[i] ?? 0) + 0.4 * (hairDir[i] ?? 0);
    const q = l2Normalize(mixed);
    const projected = projectIdentity(q, dirs, 1);
    let before = 0;
    let after = 0;
    for (let i = 0; i < 128; i++) {
      before += (q[i] ?? 0) * (dirs[0]![i] ?? 0);
      after += (projected[i] ?? 0) * (dirs[0]![i] ?? 0);
    }
    assert.ok(Math.abs(after) < Math.abs(before), `|proj|=${after} vs |raw|=${before}`);
  });

  it("triggers on large age or hair gaps only", () => {
    assert.equal(shouldProjectIdentity(20, 50, 0.5, 0.5), true);
    assert.equal(shouldProjectIdentity(30, 32, 0.2, 0.7), true);
    assert.equal(shouldProjectIdentity(30, 32, 0.5, 0.52), false);
  });
});
