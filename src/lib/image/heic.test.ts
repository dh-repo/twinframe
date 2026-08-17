import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HEIC_UNSUPPORTED_MESSAGE,
  isHeicFile,
  isLikelyPhotoFile,
  jpegOutputName,
  normalizeImageFile,
} from "./heic.ts";

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

describe("isLikelyPhotoFile", () => {
  it("accepts iPhone Photos HEIC with an empty MIME type", () => {
    assert.equal(isLikelyPhotoFile(fakeFile("IMG_3936.HEIC", "")), true);
    assert.equal(isLikelyPhotoFile(fakeFile("photo", "image/heic")), true);
  });

  it("accepts extension-only JPEGs from Android WebViews", () => {
    assert.equal(isLikelyPhotoFile(fakeFile("IMG_0001.JPG", "")), true);
    assert.equal(isLikelyPhotoFile(fakeFile("notes.pdf", "")), false);
  });
});

describe("jpegOutputName", () => {
  it("does not double .jpg when the source is already a JPEG", () => {
    assert.equal(jpegOutputName("realistic-group.jpg"), "realistic-group.jpg");
    assert.equal(jpegOutputName("IMG_0001.JPEG"), "IMG_0001.jpg");
    assert.equal(jpegOutputName("shot.PNG"), "shot.jpg");
  });

  it("converts HEIC names to a single .jpg suffix", () => {
    assert.equal(jpegOutputName("IMG_3936.HEIC"), "IMG_3936.jpg");
    assert.equal(jpegOutputName("photo.heif"), "photo.jpg");
  });
});

describe("normalizeImageFile", () => {
  it("rejects empty files", async () => {
    const empty = new File([new Uint8Array(8)], "empty.jpg", { type: "image/jpeg" });
    await assert.rejects(() => normalizeImageFile(empty), /empty/i);
  });
});
