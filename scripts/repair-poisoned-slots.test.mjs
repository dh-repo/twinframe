import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRepairArgs, unchangedBytesExcept } from "./repair-poisoned-slots.mjs";
import { COLLAPSE_IDS, HOUSEHOLD_COLLAPSE_IDS } from "./lib/gallery-collapse.mjs";
import { encodeV4Gallery, l2Normalize } from "./lib/gallery-binary.mjs";

function pseudoVector(dim, seed) {
  let s = seed;
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    v[i] = s / 2147483648 - 0.5;
  }
  return l2Normalize(v);
}

describe("repair-poisoned-slots harness", () => {
  it("defaults to the 14 collapse ids and requires --write to mutate", () => {
    const dry = parseRepairArgs([]);
    assert.deepEqual(dry.ids, [...COLLAPSE_IDS]);
    assert.equal(dry.write, false);
    const wet = parseRepairArgs(["--write", "--ids", "ed-sheeran,oprah-winfrey"]);
    assert.equal(wet.write, true);
    assert.deepEqual(wet.ids, ["ed-sheeran", "oprah-winfrey"]);
    for (const id of HOUSEHOLD_COLLAPSE_IDS) {
      assert.ok(COLLAPSE_IDS.includes(id));
    }
  });

  it("detects a stray payload edit outside the patched indices", () => {
    const dim = 8;
    const { buffer } = encodeV4Gallery([pseudoVector(dim, 1), pseudoVector(dim, 2), pseudoVector(dim, 3)], dim);
    const copy = Buffer.from(buffer);
    assert.equal(unchangedBytesExcept(buffer, copy, [1], dim), true);
    copy[32 + dim] = (copy[32 + dim] + 1) % 256;
    assert.equal(unchangedBytesExcept(buffer, copy, [1], dim), true);
    copy[32] = (copy[32] + 1) % 256;
    assert.equal(unchangedBytesExcept(buffer, copy, [1], dim), false);
  });
});
