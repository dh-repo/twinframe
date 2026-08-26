import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreDisplay } from "./score-display.ts";

describe("scoreDisplay", () => {
  it("leads a dead ringer with calibrated P(correct), Hill as similarity", () => {
    const s = scoreDisplay({
      matchPercent: 88.4,
      probabilityCorrect: 0.821,
      verdict: "dead-ringer",
    });
    assert.equal(s.heroPercent, 82);
    assert.equal(s.heroCaption, "GALLERY ID CHANCE");
    assert.equal(s.muteHeroPercent, false);
    assert.equal(s.similarityPercent, 88.4);
    assert.equal(s.similarityLabel, "SIMILARITY");
    assert.equal(s.showSparkles, true);
  });

  it("mutes the hero when calibration is missing — Hill is not a twin score", () => {
    const s = scoreDisplay({ matchPercent: 78.5, verdict: "strong-resemblance" });
    assert.equal(s.heroPercent, null);
    assert.equal(s.muteHeroPercent, true);
    assert.equal(s.heroCaption, "UNCALIBRATED");
    assert.equal(s.similarityLabel, "SIMILARITY");
  });

  it("never heros a Distant Twin percent, even with a high Hill score", () => {
    const s = scoreDisplay({
      matchPercent: 62,
      probabilityCorrect: 0.19,
      verdict: "distant-twin",
    });
    assert.equal(s.heroPercent, null);
    assert.equal(s.muteHeroPercent, true);
    assert.equal(s.heroCaption, "NOT A TWIN CLAIM");
    assert.equal(s.similarityLabel, "NEAREST");
    assert.equal(s.showSparkles, false);
  });

  it("adversarial: high Hill + tiny/negative-gap P stays muted on Distant Twin", () => {
    const s = scoreDisplay({
      matchPercent: 71,
      probabilityCorrect: 0.91,
      verdict: "distant-twin",
    });
    assert.equal(s.heroPercent, null);
    assert.equal(s.muteHeroPercent, true);
    assert.equal(s.showSparkles, false);
    assert.equal(s.similarityLabel, "NEAREST");
  });
});
