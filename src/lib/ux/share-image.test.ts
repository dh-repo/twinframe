import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  verdictStampStyle,
} from "./share-image.ts";
import type { VerdictTier } from "../face/verdict.ts";

const TIERS: VerdictTier[] = [
  "dead-ringer",
  "strong-resemblance",
  "soft-match",
  "distant-twin",
];

describe("share card layout", () => {
  it("commits to a 1080×1080 meme square", () => {
    assert.equal(SHARE_CARD_WIDTH, 1080);
    assert.equal(SHARE_CARD_HEIGHT, 1080);
  });
});

describe("verdictStampStyle", () => {
  it("gives every verdict a fill, wash, and glow", () => {
    for (const tier of TIERS) {
      const style = verdictStampStyle(tier);
      assert.ok(style.fill.startsWith("#"));
      assert.match(style.wash, /^rgba\(/);
      assert.match(style.glow, /^rgba\(/);
    }
  });

  it("keeps distant twins visually quieter than a dead ringer", () => {
    const gold = verdictStampStyle("dead-ringer");
    const muted = verdictStampStyle("distant-twin");
    assert.notEqual(gold.fill, muted.fill);
  });
});
