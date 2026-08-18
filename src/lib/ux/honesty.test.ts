import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  honestyBand,
  honestyHeadline,
  honestyShareLabel,
  restListHeading,
  shouldShowContenders,
  shareText,
  shouldShowEstimatedAge,
} from "./honesty.ts";

describe("honesty bands", () => {
  it("treats mid scores as nearest-neighbor, not look-alikes", () => {
    assert.equal(honestyBand(48), "weak");
    assert.equal(honestyBand(59.9), "weak");
    assert.equal(honestyBand(60), "soft");
    assert.equal(honestyBand(79.9), "soft");
    assert.equal(honestyBand(80), "strong");
    assert.equal(honestyBand(81, 0.02), "soft");
    assert.equal(honestyBand(81, 0.08), "strong");
  });

  it("demotes presentation clashes so they are never sold as a doppelgänger", () => {
    assert.equal(honestyBand(76, 0.08, "strong"), "weak");
    assert.equal(honestyBand(85, 0.08, "strong"), "weak");
    assert.equal(honestyBand(85, 0.08, "partial"), "soft");
    assert.equal(honestyBand(72, 0.08, "partial"), "soft");
    assert.equal(honestyBand(48, 0.08, "strong"), "weak");
  });

  it("keeps share / list copy aligned with the top-card bands", () => {
    assert.equal(honestyShareLabel("weak"), "Closest available match");
    assert.equal(honestyHeadline("strong"), "STRONG VISUAL RESEMBLANCE");
    assert.equal(honestyHeadline("weak"), "CLOSEST AVAILABLE MATCH");
    assert.equal(restListHeading(48), "OTHER NEAREST NEIGHBORS");
    assert.equal(restListHeading(72), "ALSO CLOSE");
    assert.equal(shouldShowContenders(29), false);
    assert.equal(shouldShowContenders(48), false);
    assert.equal(shouldShowContenders(62), true);
    assert.equal(shouldShowContenders(74, 0.02), true);
    assert.equal(shouldShowContenders(76, 0.08, "strong"), false);
    assert.match(shareText("Zendaya", 48), /no strong double/i);
    assert.match(shareText("Zendaya", 81), /Zendaya \(81%\)/);
  });
});

describe("shouldShowEstimatedAge", () => {
  it("hides implausible ages on low-quality captures", () => {
    assert.equal(shouldShowEstimatedAge(null), false);
    assert.equal(shouldShowEstimatedAge(13, { score: 0.2, sharpness: 30 }), false);
    assert.equal(shouldShowEstimatedAge(13, { score: 0.8, sharpness: 80 }), false);
    assert.equal(shouldShowEstimatedAge(28, { score: 0.8, sharpness: 70 }), true);
  });

  it("hides teen age-net overshoot when the face is still child-like", () => {
    assert.equal(
      shouldShowEstimatedAge(18, { score: 0.61, sharpness: 100 }, { youthfulness: 0.72 }),
      false,
    );
    assert.equal(
      shouldShowEstimatedAge(38, { score: 0.64, sharpness: 100 }, { youthfulness: 0.73 }),
      true,
    );
    assert.equal(
      shouldShowEstimatedAge(21, { score: 0.8, sharpness: 80 }, { youthfulness: 0.4 }),
      true,
    );
  });
});
