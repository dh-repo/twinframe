import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveShareVerdict,
  shareCardBlurb,
  shareCardFilename,
  shareHeroCaption,
  shareModalTitle,
  sharePairGlyph,
  sharePercentCaption,
  shareText,
  shareTextFromMatch,
} from "./share-copy.ts";
import { verdictLabel, verdictSubtitle, type VerdictTier } from "../face/verdict.ts";

const TIERS: VerdictTier[] = [
  "dead-ringer",
  "strong-resemblance",
  "soft-match",
  "distant-twin",
];

describe("resolveShareVerdict", () => {
  it("prefers an explicit verdict over ranking signals", () => {
    assert.equal(
      resolveShareVerdict({
        verdict: "distant-twin",
        adjustedDistance: 0.2,
        rankMargin: 0.2,
        matchPercent: 94,
      }),
      "distant-twin",
    );
  });

  it("derives a distant twin from a low percent when verdict is missing", () => {
    assert.equal(resolveShareVerdict({ matchPercent: 41 }), "distant-twin");
  });
});

describe("shareCardBlurb", () => {
  it("uses the match blurb when present", () => {
    assert.equal(
      shareCardBlurb("Same cheekbones, different tax bracket.", "soft-match"),
      "Same cheekbones, different tax bracket.",
    );
  });

  it("falls back to the verdict subtitle when blurb is empty", () => {
    assert.equal(shareCardBlurb(undefined, "distant-twin"), verdictSubtitle("distant-twin"));
    assert.equal(shareCardBlurb("   ", "dead-ringer"), verdictSubtitle("dead-ringer"));
  });

  it("ignores trait blurbs on a distant twin", () => {
    assert.equal(
      shareCardBlurb("You share her high cheekbones and long face.", "distant-twin"),
      verdictSubtitle("distant-twin"),
    );
  });
});

describe("shareText", () => {
  it("includes stamp, name, and Twinframe for every verdict", () => {
    for (const verdict of TIERS) {
      const text = shareText("Zendaya", 81.4, verdict, 0.77);
      assert.match(text, new RegExp(verdictLabel(verdict)));
      assert.match(text, /Zendaya/);
      assert.match(text, /Twinframe/);
    }
  });

  it("labels Hill percent as similarity, not a twin claim", () => {
    const text = shareText("Zendaya", 81.4, "dead-ringer", 0.77);
    assert.match(text, /81% similarity/);
    assert.match(text, /gallery-ID chance ~77%/);
  });

  it("keeps distant twins shareable without a fake look-alike percent", () => {
    const text = shareText("Keanu Reeves", 62, "distant-twin", 0.19);
    assert.match(text, /Distant Twin/);
    assert.match(text, /Keanu Reeves/);
    assert.match(text, /nearest gallery neighbor/i);
    assert.match(text, /not a look-alike claim/);
    assert.doesNotMatch(text, /62%/);
  });
});

describe("shareTextFromMatch", () => {
  it("reads verdict + percent + name off a match-shaped object", () => {
    const text = shareTextFromMatch({
      name: "Florence Pugh",
      matchPercent: 88,
      verdict: "strong-resemblance",
    });
    assert.match(text, /Strong Resemblance/);
    assert.match(text, /88% similarity/);
    assert.match(text, /Florence Pugh/);
  });
});

describe("share modal honesty", () => {
  it("does not call a distant twin a doppelgänger", () => {
    assert.equal(shareModalTitle("distant-twin"), "Share nearest neighbor");
    assert.equal(sharePairGlyph("distant-twin"), "NEAR");
    assert.equal(sharePercentCaption("distant-twin"), "NEAREST");
    assert.equal(shareHeroCaption("distant-twin", true), "NOT A TWIN CLAIM");
    assert.equal(shareHeroCaption("dead-ringer", true), "GALLERY ID CHANCE");
    assert.equal(sharePairGlyph("dead-ringer"), "≈");
    assert.match(shareModalTitle("dead-ringer"), /Dead Ringer/);
    assert.match(shareModalTitle("strong-resemblance"), /Doppelgänger/);
  });
});

describe("shareCardFilename", () => {
  it("slugs the celebrity name", () => {
    assert.equal(shareCardFilename("Florence Pugh"), "twinframe-florence-pugh.png");
    assert.equal(shareCardFilename(""), "twinframe-match.png");
  });
});
