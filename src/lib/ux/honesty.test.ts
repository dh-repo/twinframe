import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  honestyBand,
  honestyHeadline,
  honestyShareLabel,
  restListHeading,
  shareText,
  shouldShowEstimatedAge,
} from "./honesty.ts";

describe("honesty bands", () => {
  it("treats mid FaceNet scores as nearest-neighbor, not look-alikes", () => {
    assert.equal(honestyBand(48), "weak");
    assert.equal(honestyBand(54.9), "weak");
    assert.equal(honestyBand(55), "soft");
    assert.equal(honestyBand(69.9), "soft");
    assert.equal(honestyBand(70), "strong");
  });

  it("keeps share / list copy aligned with the top-card bands", () => {
    assert.equal(honestyShareLabel("weak"), "Nearest neighbor");
    assert.equal(honestyHeadline("strong"), "TOP DOPPELGÄNGER MATCH");
    assert.equal(restListHeading(48), "OTHER NEAREST NEIGHBORS");
    assert.equal(restListHeading(72), "ALSO CLOSE");
    assert.match(shareText("Zendaya", 48), /not a strong look-alike/i);
    assert.match(shareText("Zendaya", 81), /Zendaya at 81%/);
  });
});

describe("shouldShowEstimatedAge", () => {
  it("hides implausible ages on low-quality captures", () => {
    assert.equal(shouldShowEstimatedAge(null), false);
    assert.equal(shouldShowEstimatedAge(13, { score: 0.2, sharpness: 30 }), false);
    assert.equal(shouldShowEstimatedAge(13, { score: 0.4, sharpness: 45 }), false);
    assert.equal(shouldShowEstimatedAge(28, { score: 0.8, sharpness: 70 }), true);
  });
});
