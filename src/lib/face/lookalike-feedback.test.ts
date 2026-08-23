import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashProbeKey,
  lookalikeFeedbackCopy,
  lookalikeFeedbackThanks,
} from "./lookalike-feedback.ts";

describe("lookalike-feedback", () => {
  it("hashes probe keys stably", () => {
    assert.equal(hashProbeKey("abc"), hashProbeKey("abc"));
    assert.notEqual(hashProbeKey("abc"), hashProbeKey("abcd"));
  });

  it("asks Distant Twin about nearest-neighbor honesty, not look-alikes", () => {
    const copy = lookalikeFeedbackCopy("distant-twin");
    assert.equal(copy.prompt, "Was the nearest face at least plausible?");
    assert.equal(copy.negativeLabel, "Wrong nearest");
    assert.equal(copy.fairNearestLabel, "Fair nearest");
    assert.ok(!/look-alike/i.test(copy.prompt));
    assert.equal(
      lookalikeFeedbackThanks("distant-twin", "fair_nearest"),
      "Thanks — noted as a fair nearest neighbor.",
    );
    assert.equal(
      lookalikeFeedbackThanks("distant-twin", "not_really"),
      "Thanks — marked as the wrong nearest face.",
    );
    assert.ok(!/look-alike/i.test(lookalikeFeedbackThanks("distant-twin", "not_really")));
    assert.ok(!/look-alike/i.test(lookalikeFeedbackThanks("distant-twin", "better_match")));
  });

  it("keeps look-alike wording on stronger verdicts", () => {
    for (const verdict of ["dead-ringer", "strong-resemblance", "soft-match"] as const) {
      const copy = lookalikeFeedbackCopy(verdict);
      assert.equal(copy.prompt, "Was this a good look-alike?");
      assert.equal(copy.negativeLabel, "Not really");
      assert.equal(copy.fairNearestLabel, null);
    }
    assert.equal(lookalikeFeedbackCopy().prompt, "Was this a good look-alike?");
    assert.match(
      lookalikeFeedbackThanks("soft-match", "not_really"),
      /tune future look-alikes/,
    );
  });
});
