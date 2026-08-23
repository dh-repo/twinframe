import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  V4_HEADER_SIZE,
  cosineDistance,
  decodeV4Gallery,
  decodeV4Header,
  dequantizeComponent,
  encodeV4Gallery,
  globalQuantScale,
  l2Normalize,
  quantizeComponent,
} from "./gallery-binary.mjs";

function pseudoVector(dim, seed) {
  let s = seed;
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    v[i] = s / 2147483648 - 0.5;
  }
  return l2Normalize(v);
}

describe("AFv4 gallery codec", () => {
  it("round-trips vectors within quantization error", () => {
    const dim = 512;
    const vectors = [pseudoVector(dim, 1), pseudoVector(dim, 7), pseudoVector(dim, 99)];
    const { buffer, scale, maxAbs } = encodeV4Gallery(vectors, dim);

    assert.equal(buffer.length, V4_HEADER_SIZE + vectors.length * dim);
    const header = decodeV4Header(buffer);
    assert.equal(header.magic, "AFv4");
    assert.equal(header.version, 4);
    assert.equal(header.vectorCount, 3);
    assert.equal(header.dimension, dim);
    assert.equal(header.quantType, 1);
    assert.ok(Math.abs(header.globalScale - scale) < 1e-9);
    assert.ok(Math.abs(scale * 127 - maxAbs) < 1e-9);

    const { vectors: decoded } = decodeV4Gallery(buffer);
    for (let i = 0; i < vectors.length; i++) {
      assert.ok(cosineDistance(vectors[i], decoded[i]) < 5e-3);
    }
  });

  it("keeps quantized bytes inside the biased uint8 range", () => {
    const { scale } = globalQuantScale([Float32Array.from([0.5, -0.5])]);
    assert.equal(quantizeComponent(0.5, scale), 255);
    assert.equal(quantizeComponent(-0.5, scale), 1);
    assert.equal(quantizeComponent(0, scale), 128);
    assert.equal(quantizeComponent(99, scale), 255);
    assert.equal(quantizeComponent(-99, scale), 1);
    assert.ok(Math.abs(dequantizeComponent(quantizeComponent(0.5, scale), scale) - 0.5) < 1e-6);
  });

  it("rejects a truncated or mistyped buffer instead of returning garbage", () => {
    const dim = 8;
    const { buffer } = encodeV4Gallery([pseudoVector(dim, 3), pseudoVector(dim, 4)], dim);
    assert.throws(() => decodeV4Gallery(buffer.subarray(0, buffer.length - 4)), /payload size/);
    const wrongMagic = Buffer.from(buffer);
    wrongMagic.write("XXXX", 0, "ascii");
    assert.throws(() => decodeV4Gallery(wrongMagic), /magic/);
    assert.throws(() => encodeV4Gallery([pseudoVector(dim, 3)], dim + 1), /dimension/);
  });
});
