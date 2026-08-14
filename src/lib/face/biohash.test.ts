import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  hashKeyToSeed,
  getProjectionMatrix,
  computeBiohash,
  popcount32,
  hammingDistance64BytesTS,
  getPopcountWasmInstance,
  screenBiohashCandidates,
} from "./biohash.ts";
import { l2Normalize } from "./embeddings.ts";

describe("Feature 11: 512-bit Biohashing & WASM Popcount Candidate Screening", () => {
  test("1. PRNG Determinism & Key Isolation", () => {
    const seed1 = hashKeyToSeed("test-key-alpha");
    const seed2 = hashKeyToSeed("test-key-alpha");
    const seed3 = hashKeyToSeed("test-key-beta");

    assert.equal(seed1, seed2, "Identical keys must yield identical PRNG seeds");
    assert.notEqual(seed1, seed3, "Different keys must yield distinct PRNG seeds");

    const mat1 = getProjectionMatrix("test-key-alpha");
    const mat2 = getProjectionMatrix("test-key-alpha");
    const mat3 = getProjectionMatrix("test-key-beta");

    assert.equal(mat1.length, 512 * 256, "Projection matrix must be 512x256 = 131072 elements");
    assert.equal(mat1, mat2, "Cached projection matrix reference must match for identical key");
    assert.notEqual(mat1[0], mat3[0], "Distinct keys must produce distinct matrix entries");
  });

  test("2. Bit Packing & Biohash Generation", () => {
    // Generate normalized random vector
    const rawVec = new Float32Array(256);
    for (let i = 0; i < 256; i++) rawVec[i] = (i - 128) / 128;
    const normVec = l2Normalize(rawVec);

    const bioResult = computeBiohash(normVec);

    assert.equal(bioResult.hash.length, 64, "Packed biohash payload must be exactly 64 bytes");
    assert.equal(bioResult.bitLength, 512, "Bit length must be 512");
    assert.ok(bioResult.latencyMs >= 0, "Latency must be non-negative");

    // Invalid length embedding should throw
    assert.throws(() => {
      computeBiohash(new Float32Array(128));
    }, /length 256/);
  });

  test("3. SWAR popcount32 & 64-byte Hamming Distance", () => {
    assert.equal(popcount32(0x00000000), 0);
    assert.equal(popcount32(0xffffffff), 32);
    assert.equal(popcount32(0x0f0f0f0f), 16);

    const hashA = new Uint8Array(64).fill(0xff);
    const hashB = new Uint8Array(64).fill(0xff);
    const hashC = new Uint8Array(64).fill(0x00);

    assert.equal(hammingDistance64BytesTS(hashA, hashB), 0, "Identical hashes must have 0 Hamming distance");
    assert.equal(hammingDistance64BytesTS(hashA, hashC), 512, "Inverted hashes must have 512 Hamming distance");
  });

  test("4. SWAR vs WASM Popcount Parity", async () => {
    const wasmInst = await getPopcountWasmInstance();
    assert.ok(wasmInst, "WASM module must compile and instantiate cleanly");

    const query = new Uint8Array(64);
    for (let i = 0; i < 64; i++) query[i] = (i * 7 + 3) & 0xff;

    const catalogCount = 20;
    const catalogHashes = new Uint8Array(catalogCount * 64);
    for (let c = 0; c < catalogCount; c++) {
      for (let i = 0; i < 64; i++) {
        catalogHashes[c * 64 + i] = (c * 13 + i * 5) & 0xff;
      }
    }

    const resWasm = await screenBiohashCandidates(query, catalogHashes, catalogCount, {
      maxHammingDistance: 512,
      topM: 20,
      minCandidates: 1,
      forceTS: false,
    });

    const resTS = await screenBiohashCandidates(query, catalogHashes, catalogCount, {
      maxHammingDistance: 512,
      topM: 20,
      minCandidates: 1,
      forceTS: true,
    });

    assert.equal(resWasm.providerUsed, "wasm");
    assert.equal(resTS.providerUsed, "typescript");
    assert.equal(resWasm.candidates.length, resTS.candidates.length);

    for (let i = 0; i < resWasm.candidates.length; i++) {
      assert.equal(resWasm.candidates[i]!.index, resTS.candidates[i]!.index);
      assert.equal(resWasm.candidates[i]!.hammingDistance, resTS.candidates[i]!.hammingDistance);
    }
  });

  test("5. Biometric Recall & Hamming Distance Distribution", () => {
    // Generate base face embedding
    const baseVec = new Float32Array(256);
    for (let i = 0; i < 256; i++) baseVec[i] = Math.sin(i * 0.1);
    const vBase = l2Normalize(baseVec);

    // Matching face (small perturbation)
    const matchVec = new Float32Array(256);
    for (let i = 0; i < 256; i++) matchVec[i] = vBase[i]! + (Math.cos(i * 0.2) * 0.05);
    const vMatch = l2Normalize(matchVec);

    // Non-matching face (orthogonal noise)
    const nonMatchVec = new Float32Array(256);
    for (let i = 0; i < 256; i++) nonMatchVec[i] = (i % 2 === 0 ? 1 : -1) * Math.cos(i * 0.7);
    const vNonMatch = l2Normalize(nonMatchVec);

    const bioBase = computeBiohash(vBase);
    const bioMatch = computeBiohash(vMatch);
    const bioNonMatch = computeBiohash(vNonMatch);

    const distMatch = hammingDistance64BytesTS(bioBase.hash, bioMatch.hash);
    const distNonMatch = hammingDistance64BytesTS(bioBase.hash, bioNonMatch.hash);

    assert.ok(
      distMatch < 180,
      `Matching face Hamming distance (${distMatch}) should be well below 180 bits`
    );
    assert.ok(
      distNonMatch > 200,
      `Non-matching face Hamming distance (${distNonMatch}) should be above 200 bits`
    );
  });
});
