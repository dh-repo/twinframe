import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEAD_RINGER_MAX_DISTANCE,
  DEAD_RINGER_MIN_MARGIN,
  verdictFromMatch,
  verdictLabel,
  verdictSubtitle,
  type VerdictTier,
} from "./verdict.ts";

describe("verdictFromMatch", () => {
  it("calls a dead ringer only inside identity range with a clear gap", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.3, rankMargin: 0.12, matchPercent: 92 }),
      "dead-ringer",
    );
    assert.equal(
      verdictFromMatch({
        adjustedDistance: DEAD_RINGER_MAX_DISTANCE,
        rankMargin: DEAD_RINGER_MIN_MARGIN,
        matchPercent: 78,
      }),
      "dead-ringer",
    );
  });

  it("demotes a close distance when the gallery is crowded at that point", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.3, rankMargin: 0.02, matchPercent: 88 }),
      "soft-match",
    );
  });

  it("keeps a distinctive but non-identity match at strong resemblance", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.52, rankMargin: 0.06, matchPercent: 74 }),
      "strong-resemblance",
    );
  });

  it("treats low percents as distant twins regardless of margin", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.72, rankMargin: 0.2, matchPercent: 41 }),
      "distant-twin",
    );
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.68, rankMargin: 0.01, matchPercent: 54.9 }),
      "distant-twin",
    );
  });

  it("lands mid-percent matches in soft match", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.6, rankMargin: 0.09, matchPercent: 62 }),
      "soft-match",
    );
  });

  it("survives NaN and missing signals without claiming a twin", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: Number.NaN, rankMargin: Number.NaN, matchPercent: 90 }),
      "soft-match",
    );
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.3, rankMargin: 0.2, matchPercent: Number.NaN }),
      "distant-twin",
    );
  });
});

describe("verdict copy", () => {
  it("gives every tier a label and subtitle", () => {
    const tiers: VerdictTier[] = [
      "dead-ringer",
      "strong-resemblance",
      "soft-match",
      "distant-twin",
    ];
    for (const tier of tiers) {
      assert.ok(verdictLabel(tier).length > 0);
      assert.ok(verdictSubtitle(tier).length > 0);
    }
    assert.equal(verdictLabel("dead-ringer"), "Dead Ringer");
    assert.match(verdictSubtitle("distant-twin"), /not a real look-alike/i);
  });
});
