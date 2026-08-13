import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HEIC_UNSUPPORTED_MESSAGE, isHeicFile } from "./heic.ts";

function fakeFile(name: string, type: string): File {
  return new File([new Uint8Array([0xff, 0xd8])], name, { type });
}

describe("isHeicFile", () => {
  it("sniffs type and extension", () => {
    assert.equal(isHeicFile(fakeFile("IMG_0001.HEIC", "image/heic")), true);
    assert.equal(isHeicFile(fakeFile("shot.heif", "")), true);
    assert.equal(isHeicFile(fakeFile("face.jpg", "image/jpeg")), false);
    assert.equal(isHeicFile(fakeFile("face.png", "image/png")), false);
  });

  it("keeps a clear Photos export hint", () => {
    assert.match(HEIC_UNSUPPORTED_MESSAGE, /Save as JPEG/i);
  });
});
