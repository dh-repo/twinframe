/**
 * Minimal JPEG EXIF Orientation (tag 0x0112) parser + display-size helper.
 * Used so PRE-01 and rasterize paths can honor phone CW/CCW rotations without
 * claiming "portrait canvas" alone is EXIF compliance.
 */

/** EXIF Orientation values 1–8 (TIFF). Returns null if not a JPEG or tag missing. */
export function parseJpegExifOrientation(buf: UintLike): number | null {
  const bytes = toU8(buf);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    // Skip padding 0xFF
    if (marker === 0xff) {
      offset++;
      continue;
    }
    // SOI / markers without length
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const size = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (size < 2 || offset + 2 + size > bytes.length) break;

    // APP1 — EXIF
    if (marker === 0xe1) {
      const start = offset + 4;
      const end = offset + 2 + size;
      const orient = parseExifApp1(bytes.subarray(start, end));
      if (orient !== null) return orient;
    }

    // SOS — image data begins; stop scanning
    if (marker === 0xda) break;
    offset += 2 + size;
  }
  return null;
}

/**
 * Display dimensions after applying EXIF orientation.
 * Orientations 5–8 swap width/height (90° / 270° family).
 */
export function orientedDisplaySize(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

/** True when orientation implies a 90° or 270° display rotation (CW/CCW family). */
export function isExifQuarterTurn(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

type UintLike = Uint8Array | ArrayBuffer | ArrayBufferView;

function toU8(buf: UintLike): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (ArrayBuffer.isView(buf)) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new Uint8Array(buf);
}

function parseExifApp1(segment: Uint8Array): number | null {
  // "Exif\0\0"
  if (segment.length < 14) return null;
  if (
    segment[0] !== 0x45 ||
    segment[1] !== 0x78 ||
    segment[2] !== 0x69 ||
    segment[3] !== 0x66 ||
    segment[4] !== 0x00 ||
    segment[5] !== 0x00
  ) {
    return null;
  }

  const tiff = segment.subarray(6);
  if (tiff.length < 8) return null;

  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  const be = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!le && !be) return null;

  const u16 = (o: number) =>
    le ? tiff[o]! | (tiff[o + 1]! << 8) : (tiff[o]! << 8) | tiff[o + 1]!;
  const readU32 = (o: number) => {
    if (le) {
      return (
        (tiff[o]! |
          (tiff[o + 1]! << 8) |
          (tiff[o + 2]! << 16) |
          (tiff[o + 3]! << 24)) >>>
        0
      );
    }
    return (
      ((tiff[o]! << 24) |
        (tiff[o + 1]! << 16) |
        (tiff[o + 2]! << 8) |
        tiff[o + 3]!) >>>
      0
    );
  };

  if (u16(2) !== 42) return null;
  let ifdOffset = readU32(4);
  if (ifdOffset + 2 > tiff.length) return null;

  const entryCount = u16(ifdOffset);
  ifdOffset += 2;
  for (let i = 0; i < entryCount; i++) {
    const entry = ifdOffset + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    const type = u16(entry + 2);
    // Orientation tag 0x0112, type SHORT (3), count 1 → value in first 2 bytes of value field
    if (tag === 0x0112 && type === 3) {
      const orient = u16(entry + 8);
      if (orient >= 1 && orient <= 8) return orient;
    }
  }
  return null;
}
