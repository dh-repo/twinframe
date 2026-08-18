import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CROP_ZOOM_MAX,
  coverFitScale,
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
});
