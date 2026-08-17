import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashProbeKey } from "./lookalike-feedback.ts";

describe("lookalike-feedback", () => {
  it("hashes probe keys stably", () => {
    assert.equal(hashProbeKey("abc"), hashProbeKey("abc"));
    assert.notEqual(hashProbeKey("abc"), hashProbeKey("abcd"));
  });
});
