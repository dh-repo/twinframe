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
  patchQ8Slots,
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

  it("patches listed q8 slots with the existing global scale and leaves every other byte alone", () => {
    const dim = 8;
    const original = [pseudoVector(dim, 3), pseudoVector(dim, 4), pseudoVector(dim, 5)];
    const { buffer } = encodeV4Gallery(original, dim);
    const replacement = pseudoVector(dim, 99);
    const patched = patchQ8Slots(buffer, [{ index: 1, descriptor: replacement }]);
    const beforeHeader = decodeV4Header(buffer);

    assert.notEqual(patched, buffer);
    assert.deepEqual(patched.subarray(0, V4_HEADER_SIZE), buffer.subarray(0, V4_HEADER_SIZE));
    assert.deepEqual(
      patched.subarray(V4_HEADER_SIZE, V4_HEADER_SIZE + dim),
      buffer.subarray(V4_HEADER_SIZE, V4_HEADER_SIZE + dim),
    );
    assert.deepEqual(
      patched.subarray(V4_HEADER_SIZE + 2 * dim),
      buffer.subarray(V4_HEADER_SIZE + 2 * dim),
    );
    assert.notDeepEqual(
      patched.subarray(V4_HEADER_SIZE + dim, V4_HEADER_SIZE + 2 * dim),
      buffer.subarray(V4_HEADER_SIZE + dim, V4_HEADER_SIZE + 2 * dim),
    );

    const { header, vectors } = decodeV4Gallery(patched);
    assert.equal(header.globalScale, beforeHeader.globalScale);
    assert.ok(cosineDistance(vectors[0], original[0]) < 5e-3);
    assert.ok(cosineDistance(vectors[2], original[2]) < 5e-3);
    assert.ok(cosineDistance(vectors[1], replacement) < 5e-3);
    assert.throws(() => patchQ8Slots(buffer, [{ index: 1, descriptor: new Float32Array(dim + 1) }]), /dimension/);
    assert.throws(() => patchQ8Slots(buffer, [{ index: 9, descriptor: replacement }]), /index/);
  });
});
