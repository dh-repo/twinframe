import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isPresentAndSized, MIN_FP32_BYTES, MIN_FAST_BYTES } from "./ensure-face-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ensure-face-model", () => {
  it("treats undersized files as missing (partial download / placeholder)", () => {
    const tiny = path.join(os.tmpdir(), "twinframe-tiny-adaface.onnx");
    fs.writeFileSync(tiny, "onnx");
    assert.equal(isPresentAndSized(tiny, MIN_FP32_BYTES), false);
    assert.equal(isPresentAndSized(tiny, MIN_FAST_BYTES), false);
    fs.unlinkSync(tiny);
    assert.equal(isPresentAndSized(path.join(os.tmpdir(), "no-such-adaface.onnx"), MIN_FP32_BYTES), false);
  });

  it("accepts a file at or above the fast-path floor", () => {
    const ok = path.join(os.tmpdir(), "twinframe-fast-adaface.bin");
    fs.writeFileSync(ok, Buffer.alloc(MIN_FAST_BYTES));
    assert.equal(isPresentAndSized(ok, MIN_FAST_BYTES), true);
    assert.equal(isPresentAndSized(ok, MIN_FP32_BYTES), false);
    fs.unlinkSync(ok);
  });

  it("does not auto-run ensure on import (main-guard)", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/ensure-face-model.mjs"), "utf8");
    assert.match(src, /fileURLToPath\(import\.meta\.url\)/);
    assert.match(src, /FP16_PATH/);
    assert.match(src, /INT8_PATH/);
  });
});
