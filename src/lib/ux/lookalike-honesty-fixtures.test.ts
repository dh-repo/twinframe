import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreDisplay } from "./score-display.ts";
import {
  HONESTY_FIXTURES,
  REFUSE_BODY,
  REFUSE_HEADING,
} from "./lookalike-honesty-fixtures.ts";

describe("lookalike honesty fixtures", () => {
  it("pins four cases: dead ringer, soft match, distant twin, refuse", () => {
    assert.deepEqual(
      HONESTY_FIXTURES.map((c) => c.id),
      ["dead-ringer", "soft-match", "distant-twin", "refuse"],
    );
  });

  it("Dead Ringer heros calibrated P(correct) and keeps Hill as similarity", () => {
    const match = HONESTY_FIXTURES[0]!.match!;
    const s = scoreDisplay(match);
    assert.equal(s.heroPercent, 82);
    assert.equal(s.muteHeroPercent, false);
    assert.equal(s.similarityPercent, 88.4);
    assert.equal(s.similarityLabel, "SIMILARITY");
    assert.equal(s.heroCaption, "GALLERY ID CHANCE");
    assert.equal(match.name, "Florence Pugh");
    assert.equal(match.verdict, "dead-ringer");
  });

  it("Soft Match heros gallery-ID chance, not a twin claim", () => {
    const match = HONESTY_FIXTURES[1]!.match!;
    const s = scoreDisplay(match);
    assert.equal(s.heroPercent, 58);
    assert.equal(s.similarityPercent, 65);
    assert.equal(match.name, "Zendaya");
    assert.equal(match.verdict, "soft-match");
  });

  it("Distant Twin never heros 62% as a twin score", () => {
    const match = HONESTY_FIXTURES[2]!.match!;
    const s = scoreDisplay(match);
    assert.equal(s.heroPercent, null);
    assert.equal(s.muteHeroPercent, true);
    assert.equal(s.similarityLabel, "NEAREST");
    assert.equal(s.heroCaption, "NOT A TWIN CLAIM");
    assert.equal(match.matchPercent, 62);
    assert.equal(match.name, "Keanu Reeves");
    assert.equal(match.verdict, "distant-twin");
  });

  it("Refuse has no celebrity percent", () => {
    const refuse = HONESTY_FIXTURES[3]!;
    assert.equal(refuse.match, null);
    assert.match(REFUSE_HEADING, /No close look-alike/);
    assert.doesNotMatch(REFUSE_HEADING, /%/);
    assert.doesNotMatch(REFUSE_BODY, /\d+%/);
  });
});
