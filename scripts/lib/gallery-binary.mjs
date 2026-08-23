/**
 * AFv4 binary gallery codec (header + uint8-biased payload).
 *
 * Kept dependency-free (no .ts imports) so plain `node scripts/...` can both
 * write the shipping binary and read the current one back for verification.
 *
 * Layout: magic "AFv4"@0, version u16@4, flags u16@6, vectorCount u32@8,
 * dimension u16@12, quantType u16@14, globalScale f32@16, globalOffset f32@20,
 * checksum u32@24, reserved u32@28, payload@32 (vectorCount * dimension bytes).
 * Decode is `(byte - 128) * globalScale` followed by L2 normalization.
 */

export const V4_HEADER_SIZE = 32;
export const V4_MAGIC = "AFv4";
export const V4_VERSION = 4;
export const V4_QUANT_UINT8_BIASED = 1;

export function l2Normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** Symmetric scale shared by every vector: the largest |component| maps to ±127. */
export function globalQuantScale(vectors) {
  let maxAbs = 0;
  for (const v of vectors) {
    for (let i = 0; i < v.length; i++) {
      const a = Math.abs(v[i]);
      if (a > maxAbs) maxAbs = a;
    }
  }
  return { maxAbs, scale: maxAbs / 127 };
}

export function quantizeComponent(value, scale) {
  const q = Math.max(-127, Math.min(127, Math.round(value / scale)));
  return q + 128;
}

export function dequantizeComponent(byte, scale) {
  return (byte - 128) * scale;
}

export function encodeV4Header({ vectorCount, dimension, scale }) {
  const header = Buffer.alloc(V4_HEADER_SIZE);
  header.write(V4_MAGIC, 0, "ascii");
  header.writeUint16LE(V4_VERSION, 4);
  header.writeUint16LE(0, 6); // flags
  header.writeUint32LE(vectorCount, 8);
  header.writeUint16LE(dimension, 12);
  header.writeUint16LE(V4_QUANT_UINT8_BIASED, 14);
  header.writeFloatLE(scale, 16);
  header.writeFloatLE(0, 20); // globalOffset
  header.writeUint32LE(0, 24); // checksum (unused by loader)
  header.writeUint32LE(0, 28);
  return header;
}

export function decodeV4Header(buffer) {
  if (buffer.length < V4_HEADER_SIZE) throw new Error("AFv4 buffer shorter than header");
  const magic = buffer.toString("ascii", 0, 4);
  if (magic !== V4_MAGIC) throw new Error(`Bad AFv4 magic "${magic}"`);
  return {
    magic,
    version: buffer.readUint16LE(4),
    flags: buffer.readUint16LE(6),
    vectorCount: buffer.readUint32LE(8),
    dimension: buffer.readUint16LE(12),
    quantType: buffer.readUint16LE(14),
    globalScale: buffer.readFloatLE(16),
    globalOffset: buffer.readFloatLE(20),
  };
}

/** Quantize L2-normalized vectors into a complete AFv4 buffer. */
export function encodeV4Gallery(vectors, dimension) {
  for (const v of vectors) {
    if (v.length !== dimension) {
      throw new Error(`vector dimension ${v.length} != ${dimension}`);
    }
  }
  const { maxAbs, scale } = globalQuantScale(vectors);
  if (!(scale > 0)) throw new Error("degenerate quantization scale");
  const payload = Buffer.alloc(vectors.length * dimension);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    for (let j = 0; j < dimension; j++) {
      payload[i * dimension + j] = quantizeComponent(v[j], scale);
    }
  }
  const header = encodeV4Header({ vectorCount: vectors.length, dimension, scale });
  return { buffer: Buffer.concat([header, payload]), scale, maxAbs };
}

/** Read an AFv4 buffer back as L2-normalized Float32Array vectors. */
export function decodeV4Gallery(buffer) {
  const header = decodeV4Header(buffer);
  const { vectorCount, dimension, globalScale } = header;
  const expected = V4_HEADER_SIZE + vectorCount * dimension;
  if (buffer.length !== expected) {
    throw new Error(`AFv4 payload size ${buffer.length} != expected ${expected}`);
  }
  const vectors = [];
  for (let i = 0; i < vectorCount; i++) {
    const raw = new Float32Array(dimension);
    const off = V4_HEADER_SIZE + i * dimension;
    for (let j = 0; j < dimension; j++) {
      raw[j] = dequantizeComponent(buffer[off + j], globalScale);
    }
    vectors.push(l2Normalize(raw));
  }
  return { header, vectors };
}

export function cosineDistance(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return 1 - dot;
}
