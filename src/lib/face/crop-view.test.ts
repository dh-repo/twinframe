import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CROP_ZOOM_MAX,
  GROUP_SHOT_PICK_HINT,
  STANDING_SHOT_HINT,
  coverFitScale,
  cropReviewNeedsExplicitPick,
  initialCropReviewFaceId,
  isStandingFullBodyShot,
  maxCropPan,
  offsetToCenterBox,
  zoomToFillFace,
} from "./crop-view.ts";

describe("crop-view", () => {
  it("zooms a distant full-body face past the old 2x selfie cap", () => {
    // 12MP-ish phone frame, face ~140px near the top (swing / standing shot)
    const zoom = zoomToFillFace(140, 3024, 4032);
    assert.ok(zoom > 2, `expected zoom > 2, got ${zoom}`);
    assert.ok(zoom <= CROP_ZOOM_MAX);
  });

  it("does not zoom a already-close selfie past 1x", () => {
    assert.equal(zoomToFillFace(900, 1080, 1440), 1);
  });

  it("lets pan reach a face at the top of a tall photo", () => {
    const imageW = 1000;
    const imageH = 2000;
    const container = 320;
    const box = { x: 420, y: 80, width: 160, height: 200 };
    const zoom = zoomToFillFace(200, imageW, imageH);
    const offset = offsetToCenterBox(box, imageW, imageH, zoom, container);
    const max = maxCropPan(imageW, imageH, zoom, container);
    assert.ok(Math.abs(offset.y) <= max.y + 1e-6);
    // Old clamp was 120 * zoom (~240 at 2x) — a top-of-frame face needs more.
    assert.ok(max.y > 240, `expected generous Y pan, got ${max.y}`);
    assert.ok(offset.y > 0, "face above center should push the image down");
  });

  it("cover-fits a portrait so height, not width, sets the base scale", () => {
    assert.equal(coverFitScale(1000, 2000, 320), 320 / 1000);
  });

  it("flags the standing-swing fixture geometry as a full-body shot", () => {
    // 1536×2048 swing photo, face ~147×216
    assert.equal(isStandingFullBodyShot(216, 1536, 2048), true);
    assert.equal(isStandingFullBodyShot(900, 1080, 1440), false);
    assert.ok(STANDING_SHOT_HINT.toLowerCase().includes("standing"));
  });

  it("auto-selects a solo face and requires a tap when two or more faces are present", () => {
    assert.equal(cropReviewNeedsExplicitPick(0), false);
    assert.equal(cropReviewNeedsExplicitPick(1), false);
    assert.equal(cropReviewNeedsExplicitPick(2), true);
    assert.equal(cropReviewNeedsExplicitPick(8), true);
    assert.equal(initialCropReviewFaceId([]), null);
    assert.equal(initialCropReviewFaceId([0]), 0);
    assert.equal(initialCropReviewFaceId([3]), 3);
    assert.equal(initialCropReviewFaceId([0, 1]), null);
    assert.equal(initialCropReviewFaceId([2, 0, 1]), null);
    assert.match(GROUP_SHOT_PICK_HINT, /tap the person/i);
  });
});
