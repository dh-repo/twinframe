import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  closerTwin,
  closerTwinLabel,
  closerTwinStamp,
  type CloserTwinWinner,
} from "./closer-twin.ts";

const WINNERS: CloserTwinWinner[] = ["a", "b", "tie"];

describe("closerTwin", () => {
  it("picks the lower adjustedDistance", () => {
    assert.equal(
      closerTwin(
        { adjustedDistance: 0.31, matchPercent: 70 },
        { adjustedDistance: 0.44, matchPercent: 88 },
      ),
      "a",
    );
    assert.equal(
      closerTwin(
        { adjustedDistance: 0.5, matchPercent: 90 },
        { adjustedDistance: 0.22, matchPercent: 61 },
      ),
      "b",
    );
  });

  it("falls back to higher matchPercent when distances tie", () => {
    assert.equal(
      closerTwin(
        { adjustedDistance: 0.4, matchPercent: 77 },
        { adjustedDistance: 0.4, matchPercent: 81 },
      ),
      "b",
    );
  });

  it("falls back to higher matchPercent when a distance is missing", () => {
    assert.equal(
      closerTwin({ matchPercent: 84 }, { adjustedDistance: 0.3, matchPercent: 60 }),
      "a",
    );
    assert.equal(
      closerTwin({ adjustedDistance: 0.3, matchPercent: 60 }, { matchPercent: 84 }),
      "b",
    );
    assert.equal(
      closerTwin({ matchPercent: 72 }, { matchPercent: 68 }),
      "a",
    );
  });

  it("treats non-finite distances as missing", () => {
    assert.equal(
      closerTwin(
        { adjustedDistance: Number.POSITIVE_INFINITY, matchPercent: 90 },
        { adjustedDistance: 0.4, matchPercent: 50 },
      ),
      "a",
    );
    assert.equal(
      closerTwin(
        { adjustedDistance: Number.NaN, matchPercent: 40 },
        { matchPercent: 55 },
      ),
      "b",
    );
  });

  it("returns tie when both signals match", () => {
    assert.equal(
      closerTwin(
        { adjustedDistance: 0.33, matchPercent: 70 },
        { adjustedDistance: 0.33, matchPercent: 70 },
      ),
      "tie",
    );
    assert.equal(closerTwin({ matchPercent: 50 }, { matchPercent: 50 }), "tie");
  });
});

describe("closerTwin labels", () => {
  it("covers every winner with an exhaustive label + stamp", () => {
    const labels: Record<CloserTwinWinner, string> = {
      a: "Closer twin: You",
      b: "Closer twin: Friend",
      tie: "It's a tie",
    };
    const stamps: Record<CloserTwinWinner, string> = {
      a: "Closer Twin: You",
      b: "Closer Twin: Friend",
      tie: "Tied Twins",
    };
    for (const winner of WINNERS) {
      assert.equal(closerTwinLabel(winner), labels[winner]);
      assert.equal(closerTwinStamp(winner), stamps[winner]);
    }
  });
});
