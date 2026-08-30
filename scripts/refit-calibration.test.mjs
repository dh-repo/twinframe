import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_NEGATIVES_FOR_SLOPE_FIT, refitFromRecords } from "./refit-calibration.ts";

const PRIOR = { intercept: 6.7786, wDtrue: -1.413, wGap: 1.2795 };

describe("held-out calibration refit", () => {
  it("keeps prior slopes when every probe is Rank-1", () => {
    assert.ok(MIN_NEGATIVES_FOR_SLOPE_FIT >= 3);
    const records = Array.from({ length: 24 }, (_, i) => ({
      dTrue: 0.15 + i * 0.01,
      dBestWrong: 0.85,
      rank: 1,
    }));
    const out = refitFromRecords(records, PRIOR);
    assert.equal(out.wDtrue, PRIOR.wDtrue);
    assert.equal(out.wGap, PRIOR.wGap);
    assert.equal(out.intercept, PRIOR.intercept);
    assert.ok(out.muDtrue > 0 && out.sdDtrue > 0);
    assert.ok(out.muGap > 0 && out.sdGap > 0);
  });

  it("identifies a negative distance weight when misses exist", () => {
    const records = [
      ...Array.from({ length: 20 }, () => ({ dTrue: 0.2, dBestWrong: 0.9, rank: 1 })),
      ...Array.from({ length: 8 }, () => ({ dTrue: 0.85, dBestWrong: 0.4, rank: 2 })),
    ];
    const out = refitFromRecords(records, { intercept: 0, wDtrue: 0, wGap: 0 });
    assert.ok(out.wDtrue < -0.2, `expected negative wDtrue, got ${out.wDtrue}`);
    assert.ok(out.wGap > 0.2, `expected positive wGap, got ${out.wGap}`);
  });
});
