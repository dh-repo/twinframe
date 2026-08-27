import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { acceptPrimaryEmbed, adafaceModelReady, swapRgbToBgr } from "./enroll-gallery-onnx.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADAFACE = path.join(ROOT, "public/models/adaface_ir101_webface12m.onnx");

describe("AdaFace enroll path", () => {
  it("reports ready only when the IR-101 file is at least 50MB", () => {
    const missing = path.join(os.tmpdir(), "twinframe-no-adaface.onnx");
    assert.equal(adafaceModelReady(missing), false);

    const tiny = path.join(os.tmpdir(), "twinframe-tiny-adaface.onnx");
    fs.writeFileSync(tiny, "onnx");
    assert.equal(adafaceModelReady(tiny, 50 * 1024 * 1024), false);
    fs.unlinkSync(tiny);

    if (fs.existsSync(ADAFACE) && fs.statSync(ADAFACE).size >= 50 * 1024 * 1024) {
      assert.equal(adafaceModelReady(), true);
    }
  });

  it("swaps RGB and BGR planes and is its own inverse", () => {
    const size = 2;
    const rgb = new Float32Array([1, 2, 3, 4, 10, 20, 30, 40, 7, 8, 9, 6]);
    const bgr = swapRgbToBgr(rgb, size);
    assert.deepEqual(Array.from(bgr), [7, 8, 9, 6, 10, 20, 30, 40, 1, 2, 3, 4]);
    assert.deepEqual(Array.from(swapRgbToBgr(bgr, size)), Array.from(rgb));
    assert.deepEqual(Array.from(rgb), [1, 2, 3, 4, 10, 20, 30, 40, 7, 8, 9, 6]);
  });

  it("refuses a whole-crop primary so a rebuild cannot re-poison a slot", () => {
    assert.equal(acceptPrimaryEmbed({ usedDetection: true }), true);
    assert.equal(acceptPrimaryEmbed({ usedDetection: false }), false);
    assert.equal(acceptPrimaryEmbed({}), false);
  });
});
