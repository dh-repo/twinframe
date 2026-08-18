import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  honestyBand,
  honestyBandFromVerdict,
  honestyHeadline,
  honestyShareLabel,
  restListHeading,
  shouldShowContenders,
  shareText,
  shouldShowEstimatedAge,
  verdictFromHonestyBand,
} from "./honesty.ts";
import type { VerdictTier } from "../face/verdict.ts";

describe("honesty bands", () => {
  it("treats mid FaceNet scores as nearest-neighbor, not look-alikes", () => {
    assert.equal(honestyBand(48), "weak");
    assert.equal(honestyBand(54.9), "weak");
    assert.equal(honestyBand(55), "soft");
    assert.equal(honestyBand(69.9), "soft");
    assert.equal(honestyBand(70), "strong");
    assert.equal(honestyBand(74, 0.02), "soft");
    assert.equal(honestyBand(74, 0.08), "strong");
  });

  it("keeps share / list copy aligned with the top-card bands", () => {
    assert.equal(honestyShareLabel("weak"), "Nearest neighbor");
    assert.equal(honestyHeadline("strong"), "TOP DOPPELGÄNGER MATCH");
    assert.equal(restListHeading(48), "OTHER NEAREST NEIGHBORS");
    assert.equal(restListHeading(72), "ALSO CLOSE");
    assert.equal(shouldShowContenders(29), false);
    assert.equal(shouldShowContenders(48), false);
    assert.equal(shouldShowContenders(62), true);
    assert.equal(shouldShowContenders(74, 0.02), true);
    assert.match(shareText("Zendaya", 48), /not a strong look-alike/i);
    assert.match(shareText("Zendaya", 81), /Zendaya at 81%/);
  });
});

describe("honesty ↔ verdict mapping", () => {
  it("maps every named verdict onto a share/list band", () => {
    const tiers: VerdictTier[] = [
      "dead-ringer",
      "strong-resemblance",
      "soft-match",
      "distant-twin",
    ];
    const bands = tiers.map((tier) => honestyBandFromVerdict(tier));
    assert.deepEqual(bands, ["strong", "strong", "soft", "weak"]);
  });

  it("maps bands back to the closest named verdict", () => {
    assert.equal(verdictFromHonestyBand("weak"), "distant-twin");
    assert.equal(verdictFromHonestyBand("soft"), "soft-match");
    assert.equal(verdictFromHonestyBand("strong"), "strong-resemblance");
  });

  it("lets a stamp override percent when writing share / list copy", () => {
    assert.equal(restListHeading(88, 0.2, "distant-twin"), "OTHER NEAREST NEIGHBORS");
    assert.equal(restListHeading(40, 0.01, "dead-ringer"), "ALSO CLOSE");
    assert.equal(shouldShowContenders(88, 0.2, "distant-twin"), false);
    assert.equal(shouldShowContenders(40, 0.01, "dead-ringer"), true);
    assert.match(shareText("Zendaya", 48, undefined, "distant-twin"), /not a strong look-alike/i);
    assert.match(shareText("Zendaya", 91, 0.12, "dead-ringer"), /Dead ringer/i);
    assert.match(shareText("Zendaya", 74, 0.08, "strong-resemblance"), /Zendaya at 74%/);
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
