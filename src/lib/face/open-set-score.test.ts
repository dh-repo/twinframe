import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { distanceToMatchPercent } from "./embeddings.ts";
import {
  OPEN_SET_IDENTITY_DISTANCE,
  OPEN_SET_MARGIN_FACTOR_MIN,
  OPEN_SET_MARGIN_FLOOR,
  OPEN_SET_MARGIN_FULL,
  applyOpenSetLookalikePercent,
  applyOpenSetLookalikePercents,
  openSetMarginFactor,
  rankMargin,
} from "./open-set-score.ts";

describe("open-set look-alike scoring", () => {
  it("treats a missing #2 as a full-credit distinctive match", () => {
    assert.equal(rankMargin([]), OPEN_SET_MARGIN_FULL);
    assert.equal(rankMargin([0.5]), OPEN_SET_MARGIN_FULL);
  });

  it("measures top-2 margin as d2 − d1 and floors at 0", () => {
    assert.ok(Math.abs(rankMargin([0.5, 0.58]) - 0.08) < 1e-12);
    assert.equal(rankMargin([0.6, 0.6]), 0);
    assert.equal(rankMargin([0.7, 0.5]), 0);
  });

  it("does not tax identity-range distances even when the top-2 gap is tiny", () => {
    assert.equal(openSetMarginFactor(0, 0), 1);
    assert.equal(openSetMarginFactor(0.01, OPEN_SET_IDENTITY_DISTANCE), 1);
    assert.equal(applyOpenSetLookalikePercent(100, 0, 0), 100);
    assert.equal(applyOpenSetLookalikePercent(94.5, 0.01, 0.3), 94.5);
  });

  it("keeps full Hill credit when the top-2 gap is distinctive", () => {
    assert.equal(openSetMarginFactor(OPEN_SET_MARGIN_FULL, 0.55), 1);
    assert.equal(openSetMarginFactor(0.2, 0.55), 1);
    const hill = distanceToMatchPercent(0.45);
    assert.equal(applyOpenSetLookalikePercent(hill, 0.12, 0.45), hill);
  });

  it("suppresses crowded open-set neighbors into the honesty-weak band", () => {
    assert.equal(openSetMarginFactor(OPEN_SET_MARGIN_FLOOR, 0.55), OPEN_SET_MARGIN_FACTOR_MIN);
    assert.equal(openSetMarginFactor(0, 0.6), OPEN_SET_MARGIN_FACTOR_MIN);

    const typicalImpostor = distanceToMatchPercent(0.6);
    assert.equal(typicalImpostor, 50);
    const crowded = applyOpenSetLookalikePercent(typicalImpostor, 0.01, 0.6);
    assert.equal(crowded, 34);
    assert.ok(crowded < 55, `crowded p50 impostor should be weak, got ${crowded}`);

    const p10Impostor = distanceToMatchPercent(0.54);
    const crowdedP10 = applyOpenSetLookalikePercent(p10Impostor, 0.02, 0.54);
    assert.ok(
      crowdedP10 < 55,
      `crowded p10 impostor should leave the 60–75% band, got ${crowdedP10} from hill ${p10Impostor}`,
    );
  });

  it("interpolates the margin factor between floor and full", () => {
    const mid = (OPEN_SET_MARGIN_FLOOR + OPEN_SET_MARGIN_FULL) / 2;
    const factor = openSetMarginFactor(mid, 0.55);
    const expected = (OPEN_SET_MARGIN_FACTOR_MIN + 1) / 2;
    assert.ok(Math.abs(factor - expected) < 1e-9, `mid factor ${factor} != ${expected}`);
  });

  it("scales a list of percents without changing rank order", () => {
    const scaled = applyOpenSetLookalikePercents([61.2, 55.0, 50.0], 0.01, 0.54);
    assert.equal(scaled.length, 3);
    assert.ok(scaled[0]! > scaled[1]!);
    assert.ok(scaled[1]! > scaled[2]!);
    assert.ok(scaled[0]! < 55);
  });
});
