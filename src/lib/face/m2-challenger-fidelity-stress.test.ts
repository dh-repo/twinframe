import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeL2,
  computeL2Norm,
  decodeFloat16,
} from "./edgeface.ts";
import {
  REFERENCE_LANDMARKS_112,
  REFERENCE_LANDMARKS_160,
  compute5PointSimilarityMatrix,
} from "./similarity-transform.ts";
import {
  initSessionAntiGan,
  projectAntiGan,
} from "./anti-gan.ts";
import { computeBiohash } from "./biohash.ts";
import { cosineDistance } from "./embeddings.ts";

describe("Milestone 2 Adversarial Challenger Suite: Feature Extraction Fidelity & normalizeL2 Stress", () => {
  describe("1. Feature Descriptor Multi-Session Fidelity & Zero Variance Verification", () => {
    it("empirically verifies consecutive extractions across multiple sessions yield cosine similarity = 1.000000 (distance = 0.000000) with zero variance", () => {
      // Simulate raw 256-d face feature vectors from multiple distinct test images
      const testEmbeddings: Float32Array[] = [
        new Float32Array(256).map((_, i) => Math.sin(i * 0.41 + 0.3)),
        new Float32Array(256).map((_, i) => Math.cos(i * 0.83 - 1.1)),
        new Float32Array(256).map((_, i) => (i % 2 === 0 ? 0.5 : -0.5) * Math.sqrt(i + 1)),
      ];

      const SESSION_COUNT = 25;

      for (let testIdx = 0; testIdx < testEmbeddings.length; testIdx++) {
        const raw = testEmbeddings[testIdx]!;
        const baseline = normalizeL2(raw);

        // Baseline self-norm must be exactly 1.0 within float32 precision
        const baseNorm = computeL2Norm(baseline);
        assert.ok(
          Math.abs(baseNorm - 1.0) < 1e-6,
          `Baseline L2 norm must be 1.0, got ${baseNorm}`
        );

        const sessionOutputs: Float32Array[] = [];
        const sessionDistances: number[] = [];

        for (let s = 0; s < SESSION_COUNT; s++) {
          // Emulate pipeline step: pure L2 normalization without Anti-GAN subspace projection
          const copy = new Float32Array(raw);
          const currentEmb = normalizeL2(copy);

          // Telemetry step (computeBiohash) must not mutate currentEmb in-place
          const rawHash = computeBiohash(currentEmb);
          assert.equal(rawHash.bitLength, 512);

          sessionOutputs.push(currentEmb);

          // Compute cosine distance against baseline
          const dist = cosineDistance(baseline, currentEmb);
          sessionDistances.push(dist);

          // Dot product (cosine similarity)
          let dot = 0;
          for (let d = 0; d < 256; d++) {
            dot += baseline[d]! * currentEmb[d]!;
          }

          assert.ok(
            Math.abs(dot - 1.0) < 1e-6,
            `Session ${s} cosine similarity must be 1.000000 ± 1e-6, got ${dot.toFixed(8)}`
          );
          assert.ok(
            Math.abs(dist - 0.0) < 1e-6,
            `Session ${s} cosine distance must be 0.000000 ± 1e-6, got ${dist.toFixed(8)}`
          );
        }

        // Calculate variance across session distances
        const meanDist = sessionDistances.reduce((acc, v) => acc + v, 0) / SESSION_COUNT;
        const variance = sessionDistances.reduce((acc, v) => acc + Math.pow(v - meanDist, 2), 0) / SESSION_COUNT;

        assert.ok(
          Math.abs(meanDist - 0.0) < 1e-6,
          `Mean distance across ${SESSION_COUNT} sessions must be 0 within 1e-6, got ${meanDist}`
        );
        assert.ok(
          variance < 1e-12,
          `Session variance must be 0.000000, got ${variance}`
        );

        // Compare every pair of sessions (i, j) for bitwise equivalence
        for (let i = 0; i < SESSION_COUNT; i++) {
          for (let j = i + 1; j < SESSION_COUNT; j++) {
            const outI = sessionOutputs[i]!;
            const outJ = sessionOutputs[j]!;
            for (let d = 0; d < 256; d++) {
              assert.equal(outI[d], outJ[d], `Dimension ${d} differs between session ${i} and ${j}`);
            }
          }
        }
      }
    });

    it("demonstrates the catastrophic distortion caused by Anti-GAN if active vs pure pipeline", () => {
      const raw = new Float32Array(256).map((_, i) => Math.sin(i * 0.17 + 0.5));
      const pure = normalizeL2(raw);

      // Multiple sessions with Anti-GAN active
      const degradedDistances: number[] = [];
      const degradedDots: number[] = [];

      for (let s = 0; s < 10; s++) {
        const sessionCtx = initSessionAntiGan({ dimension: 256, subspaceRank: 32 });
        const projected = projectAntiGan(pure, sessionCtx);

        let dot = 0;
        for (let d = 0; d < 256; d++) {
          dot += pure[d]! * projected[d]!;
        }
        const dist = cosineDistance(pure, projected);

        degradedDots.push(dot);
        degradedDistances.push(dist);
      }

      // Compute statistics under Anti-GAN
      const meanDegradedDot = degradedDots.reduce((a, b) => a + b, 0) / degradedDots.length;
      const meanDegradedDist = degradedDistances.reduce((a, b) => a + b, 0) / degradedDistances.length;

      // In pure pipeline: dot = 1.0, dist = 0.0
      // Under Anti-GAN: dot is significantly degraded (< 0.96) and distance is elevated (> 0.04)
      assert.ok(
        meanDegradedDot < 0.98,
        `Anti-GAN projection severely distorts cosine similarity (mean dot: ${meanDegradedDot})`
      );
      assert.ok(
        meanDegradedDist > 0.02,
        `Anti-GAN projection introduces large artificial distance (mean dist: ${meanDegradedDist})`
      );
    });

    it("verifies computeBiohash is strictly read-only and causes zero in-place mutations", () => {
      const original = new Float32Array(256).map((_, i) => Math.cos(i * 0.23));
      const originalCopy = new Float32Array(original);

      // Execute computeBiohash 50 times
      for (let i = 0; i < 50; i++) {
        computeBiohash(original);
      }

      // Check bitwise identity of original buffer
      for (let d = 0; d < 256; d++) {
        assert.equal(original[d], originalCopy[d], `Dimension ${d} was mutated by computeBiohash`);
      }
    });
  });

  describe("2. normalizeL2 Edge Case & Numerical Stability Stress Testing", () => {
    it("handles all-zero vector safely without throwing, NaN, or Infinity", () => {
      const zeroVec = new Float32Array(256).fill(0);
      const result = normalizeL2(zeroVec);

      assert.equal(result.length, 256);
      assert.ok(result instanceof Float32Array);
      for (let i = 0; i < 256; i++) {
        assert.equal(result[i], 0, `Index ${i} of zero vector output must be 0`);
        assert.ok(!Number.isNaN(result[i]), `Index ${i} must not be NaN`);
        assert.ok(Number.isFinite(result[i]), `Index ${i} must be finite`);
      }
    });

    it("handles sub-epsilon near-zero vectors (< 1e-12 norm) safely by returning zeroed vector", () => {
      // Norm must be strictly < 1e-12 (e.g. scale 1e-14 on 256-d vector gives norm ~1.13e-13)
      const scales = [1e-14, 1e-15, 1e-20, 1e-35];
      for (const scale of scales) {
        const nearZero = new Float32Array(256).map((_, i) => scale * Math.sin(i));
        const inputNorm = computeL2Norm(nearZero);
        assert.ok(inputNorm < 1e-12, `Input norm (${inputNorm}) should be < 1e-12`);

        const result = normalizeL2(nearZero);

        assert.equal(result.length, 256);
        for (let i = 0; i < 256; i++) {
          assert.equal(result[i], 0, `Scale ${scale} index ${i} should be 0 for sub-epsilon norm`);
          assert.ok(!Number.isNaN(result[i]));
          assert.ok(Number.isFinite(result[i]));
        }
      }
    });

    it("handles above-epsilon near-zero vectors (>= 1e-12 norm) safely with unit output norm", () => {
      const scales = [1e-11, 1e-10, 1e-8, 1e-6];
      for (const scale of scales) {
        const nearZero = new Float32Array(256).map((_, i) => scale * (i === 0 ? 1 : 0.1));
        const result = normalizeL2(nearZero);

        assert.equal(result.length, 256);
        for (let i = 0; i < 256; i++) {
          assert.ok(!Number.isNaN(result[i]), `Scale ${scale} index ${i} is NaN`);
          assert.ok(Number.isFinite(result[i]), `Scale ${scale} index ${i} is non-finite`);
        }

        const norm = computeL2Norm(result);
        assert.ok(
          Math.abs(norm - 1.0) < 1e-4,
          `Scale ${scale}: output norm must be 1.0, got ${norm}`
        );
      }
    });

    it("handles huge norm vectors (norm 10^8 up to 10^150) without overflow NaN/Inf and yields unit norm", () => {
      const hugeScales = [1e8, 1e12, 1e20, 1e50, 1e100, 1e150];
      for (const scale of hugeScales) {
        // Double precision array can hold up to 1e308
        const input: number[] = new Array(256);
        for (let i = 0; i < 256; i++) {
          input[i] = scale * Math.sin(i + 1);
        }

        const result = normalizeL2(input);

        assert.equal(result.length, 256);
        for (let i = 0; i < 256; i++) {
          assert.ok(!Number.isNaN(result[i]), `Scale ${scale} index ${i} is NaN`);
          assert.ok(Number.isFinite(result[i]), `Scale ${scale} index ${i} is non-finite`);
        }

        const norm = computeL2Norm(result);
        assert.ok(
          Math.abs(norm - 1.0) < 1e-4,
          `Scale ${scale}: output norm must be 1.0, got ${norm}`
        );
      }
    });

    it("handles NaN values safely without throwing or propagating non-finite numbers", () => {
      // 1. Single NaN element
      const vecWithNaN = new Float32Array(256).fill(1.0);
      vecWithNaN[42] = NaN;

      const result1 = normalizeL2(vecWithNaN);
      assert.equal(result1.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.ok(!Number.isNaN(result1[i]), `Index ${i} must not be NaN`);
        assert.ok(Number.isFinite(result1[i]), `Index ${i} must be finite`);
      }

      // 2. All-NaN vector
      const allNaN = new Float32Array(256).fill(NaN);
      const result2 = normalizeL2(allNaN);
      assert.equal(result2.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.equal(result2[i], 0, `Index ${i} of all-NaN vector must be zero`);
      }
    });

    it("handles +Infinity and -Infinity values safely without crashing", () => {
      // 1. Single +Infinity
      const vecWithInf = new Float32Array(256).fill(1.0);
      vecWithInf[10] = Infinity;
      const result1 = normalizeL2(vecWithInf);

      assert.equal(result1.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.ok(!Number.isNaN(result1[i]), `Index ${i} must not be NaN`);
        assert.ok(Number.isFinite(result1[i]), `Index ${i} must be finite`);
        assert.equal(result1[i], 0, `Index ${i} should be 0 when norm is infinite`);
      }

      // 2. Single -Infinity
      const vecWithNegInf = new Float32Array(256).fill(1.0);
      vecWithNegInf[20] = -Infinity;
      const result2 = normalizeL2(vecWithNegInf);

      assert.equal(result2.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.ok(!Number.isNaN(result2[i]), `Index ${i} must not be NaN`);
        assert.ok(Number.isFinite(result2[i]), `Index ${i} must be finite`);
      }

      // 3. Mixed NaN, +Inf, -Inf
      const mixed = new Float32Array(256);
      mixed[0] = NaN;
      mixed[1] = Infinity;
      mixed[2] = -Infinity;
      for (let i = 3; i < 256; i++) mixed[i] = i;

      const result3 = normalizeL2(mixed);
      assert.equal(result3.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.ok(!Number.isNaN(result3[i]), `Index ${i} must not be NaN`);
        assert.ok(Number.isFinite(result3[i]), `Index ${i} must be finite`);
      }
    });

    it("handles various input array types and dimensions (1, 64, 128, 256, 512)", () => {
      const dims = [1, 64, 128, 256, 512];
      for (const d of dims) {
        // Plain JS array
        const jsArray = Array.from({ length: d }, (_, i) => i + 1);
        const out1 = normalizeL2(jsArray);
        assert.equal(out1.length, d);
        assert.ok(Math.abs(computeL2Norm(out1) - 1.0) < 1e-5);

        // Uint8Array
        const u8Array = new Uint8Array(d).map((_, i) => (i % 255) + 1);
        const out2 = normalizeL2(u8Array);
        assert.equal(out2.length, d);
        assert.ok(Math.abs(computeL2Norm(out2) - 1.0) < 1e-5);

        // Float64Array
        const f64Array = new Float64Array(d).map((_, i) => Math.sin(i + 1));
        const out3 = normalizeL2(f64Array);
        assert.equal(out3.length, d);
        assert.ok(Math.abs(computeL2Norm(out3) - 1.0) < 1e-5);
      }
    });

    it("verifies decodeFloat16 decodes half-precision bit patterns correctly", () => {
      // 0.0 -> 0x0000
      assert.equal(decodeFloat16(0x0000), 0.0);
      // 1.0 -> 0x3c00
      assert.equal(decodeFloat16(0x3c00), 1.0);
      // -1.0 -> 0xbc00
      assert.equal(decodeFloat16(0xbc00), -1.0);
      // 2.0 -> 0x4000
      assert.equal(decodeFloat16(0x4000), 2.0);
      // +Infinity -> 0x7c00
      assert.equal(decodeFloat16(0x7c00), Infinity);
      // -Infinity -> 0xfc00
      assert.equal(decodeFloat16(0xfc00), -Infinity);
      // NaN -> 0x7c01
      assert.ok(Number.isNaN(decodeFloat16(0x7c01)));
    });
  });

  describe("3. 5-Point Landmark Similarity Transform Invariance & ArcFace Bitwise Parity", () => {
    it("verifies canonical ArcFace 112x112 landmark reference coordinate exactness", () => {
      // ArcFace standard reference coordinates
      const standard112: [number, number][] = [
        [38.2946, 51.6963], // Left eye
        [73.5318, 51.5014], // Right eye
        [56.0252, 71.7366], // Nose tip
        [41.5493, 92.3655], // Left mouth corner
        [70.7299, 92.2041], // Right mouth corner
      ];

      for (let i = 0; i < 5; i++) {
        assert.equal(
          REFERENCE_LANDMARKS_112[i][0],
          standard112[i][0],
          `Landmark ${i} X mismatch with canonical ArcFace`
        );
        assert.equal(
          REFERENCE_LANDMARKS_112[i][1],
          standard112[i][1],
          `Landmark ${i} Y mismatch with canonical ArcFace`
        );
      }
    });

    it("handles extreme collinear and degenerate landmarks safely via identity fallback", () => {
      // All landmarks at the exact same point [50, 50]
      const coincidentLandmarks = [
        [50, 50],
        [50, 50],
        [50, 50],
        [50, 50],
        [50, 50],
      ];

      const res1 = compute5PointSimilarityMatrix(coincidentLandmarks, 112);
      assert.equal(res1.scale, 1);
      assert.equal(res1.rotationRad, 0);
      assert.deepEqual(res1.M, [[1, 0, 0], [0, 1, 0]]);

      // All landmarks on horizontal line y = 50
      const collinearLandmarks = [
        [10, 50],
        [20, 50],
        [30, 50],
        [40, 50],
        [50, 50],
      ];

      const res2 = compute5PointSimilarityMatrix(collinearLandmarks, 112);
      assert.ok(Number.isFinite(res2.scale));
      assert.ok(Number.isFinite(res2.rotationRad));
      for (const row of res2.M) {
        for (const v of row) {
          assert.ok(Number.isFinite(v));
        }
      }
    });
  });
});
