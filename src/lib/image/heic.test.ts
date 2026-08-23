import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isHeicFile,
  isLikelyPhotoFile,
  jpegOutputName,
  normalizeImageFile,
  HEIC_UNSUPPORTED_MESSAGE,
} from "./heic.ts";

function makeFile(name: string, type: string, sizeBytes: number): File {
  const body = new Uint8Array(sizeBytes);
  return new File([body], name, { type });
}

describe("isHeicFile", () => {
  it("detects HEIC by MIME, extension, and the empty-MIME iPhone case", () => {
    assert.equal(isHeicFile(makeFile("a.heic", "image/heic", 100)), true);
    assert.equal(isHeicFile(makeFile("b.HEIC", "", 100)), true);
    assert.equal(isHeicFile(makeFile("c.heif", "image/heif", 100)), true);
    assert.equal(isHeicFile(makeFile("noext", "image/x-heif", 100)), true);
  });

  it("does not flag ordinary photos (adversarial)", () => {
    assert.equal(isHeicFile(makeFile("selfie.jpg", "image/jpeg", 100)), false);
    assert.equal(isHeicFile(makeFile("photo.png", "image/png", 100)), false);
    assert.equal(isHeicFile(makeFile("doc.pdf", "application/pdf", 100)), false);
  });
});

describe("isLikelyPhotoFile", () => {
  it("accepts image MIME types even with odd extensions", () => {
    assert.equal(isLikelyPhotoFile(makeFile("weird.bin", "image/jpeg", 100)), true);
  });

  it("accepts known photo extensions when MIME is missing (Android WebView case)", () => {
    assert.equal(isLikelyPhotoFile(makeFile("IMG_0001.HEIC", "", 100)), true);
    assert.equal(isLikelyPhotoFile(makeFile("shot.jpeg", "", 100)), true);
    assert.equal(isLikelyPhotoFile(makeFile("pic.webp", "", 100)), true);
  });

  it("rejects non-photo files explicitly", () => {
    for (const [name, type] of [
      ["report.pdf", "application/pdf"],
      ["notes.txt", "text/plain"],
      ["malware.exe", ""],
      ["archive.zip", "application/zip"],
    ] as Array<[string, string]>) {
      assert.equal(isLikelyPhotoFile(makeFile(name, type, 100)), false, `${name}`);
    }
  });
});

describe("jpegOutputName", () => {
  it("strips known photo extensions so re-encodes never double-extend", () => {
    assert.equal(jpegOutputName("IMG_1.heic"), "IMG_1.jpg");
    assert.equal(jpegOutputName("a.b.JPG"), "a.b.jpg");
    assert.equal(jpegOutputName("noext"), "noext.jpg");
    assert.equal(jpegOutputName(""), "photo.jpg");
  });
});

describe("normalizeImageFile rejection gates", () => {
  it("rejects files below the minimum byte floor as empty", async () => {
    await assert.rejects(
      () => normalizeImageFile(makeFile("tiny.jpg", "image/jpeg", 31)),
      /empty/i,
    );
  });

  it("rejects oversized camera-roll files before decoding", async () => {
    const big = makeFile("huge.jpg", "image/jpeg", 25 * 1024 * 1024 + 1);
    await assert.rejects(() => normalizeImageFile(big), /too large/i);
  });

  it("rejects non-photo types with explicit guidance", async () => {
    await assert.rejects(
      () => normalizeImageFile(makeFile("resume.pdf", "application/pdf", 1024)),
      /choose a photo/i,
    );
  });

  it("never returns a file that keeps a .heic name (transcode contract)", async () => {
    // In Node there is no HEIC decoder; the function must either transcode to a
    // .jpg File or throw the explicit unsupported message. It must never resolve
    // to something still named .heic.
    const heic = makeFile("iphone.HEIC", "", 4096);
    let outcome: string;
    try {
      const out = await normalizeImageFile(heic);
      outcome = out.name;
    } catch (e) {
      outcome = e instanceof Error ? e.message : String(e);
    }
    assert.ok(
      outcome === HEIC_UNSUPPORTED_MESSAGE || /\.jpg$/i.test(outcome),
      `expected either "${HEIC_UNSUPPORTED_MESSAGE}" or a .jpg output, got: ${outcome}`,
    );
  });

  it("boundary: exactly MIN_BYTES passes the size gate (reaches decode stage)", async () => {
    // 32 bytes is allowed through the size gate; node cannot rasterize, so the
    // observable contract is a decode failure message, never the "empty" error.
    let msg = "";
    try {
      await normalizeImageFile(makeFile("min.jpg", "image/jpeg", 32));
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    assert.ok(!/empty/i.test(msg), `size gate misfired at boundary: ${msg}`);
  });
});
