import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDENTITY_ALIASES, idsMatchHeldOut } from "./evaluate-held-out-v2.ts";

describe("held-out identity aliases", () => {
  it("treats penelope-cruz-m as the same person as penelope-cruz", () => {
    assert.equal(idsMatchHeldOut("penelope-cruz-m", "penelope-cruz-m"), true);
    assert.equal(idsMatchHeldOut("penelope-cruz-m", "penelope-cruz"), true);
    assert.equal(idsMatchHeldOut("penelope-cruz", "penelope-cruz-m"), true);
    assert.equal(idsMatchHeldOut("penelope-cruz-m", "salma-hayek"), false);
    assert.ok(IDENTITY_ALIASES["penelope-cruz-m"]?.includes("penelope-cruz"));
  });

  it("treats lisa as the same person as lisa-blackpink", () => {
    assert.equal(idsMatchHeldOut("lisa", "lisa-blackpink"), true);
    assert.equal(idsMatchHeldOut("lisa-blackpink", "lisa"), true);
    assert.equal(idsMatchHeldOut("lisa-blackpink", "jennie-blackpink"), false);
  });
});
