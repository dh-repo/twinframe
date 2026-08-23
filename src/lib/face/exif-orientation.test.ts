import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseJpegExifOrientation,
  orientedDisplaySize,
  isExifQuarterTurn,
} from "./exif-orientation.ts";

/** Build a minimal JPEG byte stream whose APP1 EXIF carries the given orientation. */
function jpegWithOrientation(orientation: number, endian: "le" | "be" = "le"): Uint8Array {
  const u16 = (v: number) => (endian === "le" ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) =>
    endian === "le"
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

  const tiff = [...(endian === "le" ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)];
  const entry = [...u16(0x0112), ...u16(3), ...u32(1)];
  // Value field holds the SHORT inline; first bytes per endianness.
  const valueBytes = endian === "le" ? [orientation & 0xff, 0x00] : [0x00, orientation & 0xff];
  const ifd = [...tiff, ...u16(1), ...entry, ...valueBytes, ...u32(0)];

  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const payload = [...exifHeader, ...ifd];
  const size = payload.length + 2;
  const app1 = [0xff, 0xe1, (size >> 8) & 0xff, size & 0xff, ...payload];

  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xda, 0x00, 0x02]);
}

describe("parseJpegExifOrientation", () => {
  it("reads every valid orientation value (little-endian TIFF)", () => {
    for (let o = 1; o <= 8; o++) {
      assert.equal(parseJpegExifOrientation(jpegWithOrientation(o)), o, `orientation ${o}`);
    }
  });

  it("reads big-endian TIFF layout too", () => {
    assert.equal(parseJpegExifOrientation(jpegWithOrientation(6, "be")), 6);
    assert.equal(parseJpegExifOrientation(jpegWithOrientation(8, "be")), 8);
  });

  it("returns null for non-JPEG input", () => {
    assert.equal(parseJpegExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
    assert.equal(parseJpegExifOrientation(new Uint8Array([])), null);
  });

  it("returns null when no APP1/EXIF segment exists", () => {
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x01, 0xff, 0xd9]);
    assert.equal(parseJpegExifOrientation(plain), null);
  });

  it("returns null for out-of-range orientation values (adversarial)", () => {
    assert.equal(parseJpegExifOrientation(jpegWithOrientation(0)), null);
    assert.equal(parseJpegExifOrientation(jpegWithOrientation(9)), null);
  });

  it("returns null when APP1 lacks the Exif\\0\\0 signature", () => {
    const junk = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x58, 0x59, 0x5a, 0x00, 0x00, 0x49, 0x49, 0x2a,
      0x00, 0x08, 0x00, 0x00, 0x00, 0xff, 0xd9,
    ]);
    assert.equal(parseJpegExifOrientation(junk), null);
  });

  it("survives truncated segments and absurd declared sizes without looping forever", () => {
    const good = jpegWithOrientation(6);
    assert.equal(parseJpegExifOrientation(good.subarray(0, 8)), null);
    const absurd = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, 0x45, 0x78, 0x69, 0x66]);
    assert.equal(parseJpegExifOrientation(absurd), null);
  });
});

describe("orientedDisplaySize and isExifQuarterTurn", () => {
  it("swaps dimensions exactly for orientations 5-8", () => {
    for (const o of [5, 6, 7, 8]) {
      assert.deepEqual(orientedDisplaySize(400, 300, o), { width: 300, height: 400 }, `o=${o}`);
    }
    for (const o of [1, 2, 3, 4]) {
      assert.deepEqual(orientedDisplaySize(400, 300, o), { width: 400, height: 300 }, `o=${o}`);
    }
  });

  it("classifies quarter turns with exact boundaries", () => {
    for (const [o, want] of [
      [4, false],
      [5, true],
      [8, true],
      [9, false],
      [0, false],
      [-1, false],
    ] as Array<[number, boolean]>) {
      assert.equal(isExifQuarterTurn(o), want, `o=${o}`);
    }
  });
});
