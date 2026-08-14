import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  initSessionAntiGan,
  projectAntiGan,
  projectAntiGanBatch,
  computeAntiGanProjectionMatrix,
  verifyAntiGanContext,
  type SessionAntiGanContext,
} from "./anti-gan.ts";
import { l2Normalize, cosineDistance } from "./embeddings.ts";

describe("M4 Empirical Challenger 2: Session-Bound Anti-GAN & Numerical Stability Stress Suite", () => {
  describe("1. Modified Gram-Schmidt Basis Orthonormality (U^T U = I_k)", () => {
    it("verifies U^T U = I_k within tolerance 1e-6 for standard session initialization (d=256, k=32)", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const { basisU, dimension: d, subspaceRank: k } = ctx;

      let maxOrthogonalityErr = 0;
      let maxNormalizationErr = 0;

      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          let dot = 0;
          for (let m = 0; m < d; m++) {
            dot += basisU[i * d + m]! * basisU[j * d + m]!;
          }

          if (i === j) {
            const err = Math.abs(dot - 1.0);
            if (err > maxNormalizationErr) maxNormalizationErr = err;
          } else {
            const err = Math.abs(dot - 0.0);
            if (err > maxOrthogonalityErr) maxOrthogonalityErr = err;
          }
        }
      }

      assert.ok(
        maxNormalizationErr < 1e-6,
        `Basis column normalization error (${maxNormalizationErr}) must be < 1e-6`
      );
      assert.ok(
        maxOrthogonalityErr < 1e-6,
        `Basis column orthogonality error (${maxOrthogonalityErr}) must be < 1e-6`
      );
    });

    it("verifies orthonormality across various ranks (k in {1, 4, 16, 32, 64, 128}) and dimensions (d in {64, 128, 256, 512})", () => {
      const configs = [
        { d: 64, k: 8 },
        { d: 128, k: 16 },
        { d: 256, k: 1 },
        { d: 256, k: 32 },
        { d: 256, k: 128 },
        { d: 512, k: 64 },
      ];

      for (const { d, k } of configs) {
        const ctx = initSessionAntiGan({ dimension: d, subspaceRank: k });
        const report = verifyAntiGanContext(ctx, 1e-5);
        assert.ok(report.valid, `Verification failed for d=${d}, k=${k}`);
        assert.ok(
          report.orthonormalityError < 1e-5,
          `Orthonormality error (${report.orthonormalityError}) for d=${d}, k=${k} must be < 1e-5`
        );
        assert.equal(report.rank, d - k, `Rank must be d - k = ${d - k}`);
      }
    });

    it("verifies full-rank canonicalBasis inputs produce strictly orthonormal basis U", () => {
      const d = 256;
      const k = 4;
      const fullRankBasis = new Float32Array(d * k);
      for (let col = 0; col < k; col++) {
        const freq = (col + 1) * 0.05;
        for (let m = 0; m < d; m++) {
          fullRankBasis[col * d + m] = Math.sin((m + 1) * freq);
        }
      }

      const ctx = initSessionAntiGan({
        dimension: d,
        subspaceRank: k,
        canonicalBasis: fullRankBasis,
      });

      const report = verifyAntiGanContext(ctx, 1e-4);
      assert.ok(report.valid, "Full-rank canonicalBasis must produce valid orthonormal basis U");
      assert.ok(report.orthonormalityError < 1e-5);
      assert.equal(report.rank, d - k);
    });

    it("evaluates empirical behavior of linearly dependent canonicalBasis fallback", () => {
      const d = 256;
      const k = 4;
      const degBasis = new Float32Array(d * k);
      // Column 0: non-zero
      for (let m = 0; m < d; m++) degBasis[m] = Math.sin(m);
      // Column 1: identical to column 0 (linearly dependent)
      for (let m = 0; m < d; m++) degBasis[d + m] = Math.sin(m);
      // Column 2 & 3: distinct non-zero vectors
      for (let m = 0; m < d; m++) degBasis[2 * d + m] = Math.cos(m * 0.5);
      for (let m = 0; m < d; m++) degBasis[3 * d + m] = Math.cos(m * 1.5);

      const ctx = initSessionAntiGan({
        dimension: d,
        subspaceRank: k,
        canonicalBasis: degBasis,
      });

      // MGS fallback assigns e_1 when column 1 residual norm < 1e-6.
      // We empirically verify that basis vectors are normalized and non-NaN.
      for (let col = 0; col < k; col++) {
        const uCol = ctx.basisU.subarray(col * d, (col + 1) * d);
        let normSq = 0;
        for (let m = 0; m < d; m++) normSq += uCol[m]! * uCol[m]!;
        assert.ok(Math.abs(Math.sqrt(normSq) - 1.0) < 1e-5, `Column ${col} norm must be 1.0`);
      }
    });
  });

  describe("2. Projection Idempotency (P^2 = P)", () => {
    it("verifies explicit projection matrix idempotency ||P^2 - P||_max < 1e-6", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const P = computeAntiGanProjectionMatrix(ctx);
      const d = 256;

      let maxDiff = 0;
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) {
          let p2ij = 0;
          for (let m = 0; m < d; m++) {
            p2ij += P[i * d + m]! * P[m * d + j]!;
          }
          const diff = Math.abs(p2ij - P[i * d + j]!);
          if (diff > maxDiff) maxDiff = diff;
        }
      }

      assert.ok(
        maxDiff < 1e-6,
        `Explicit projection matrix idempotency max error (${maxDiff}) must be < 1e-6`
      );
    });

    it("verifies explicit projection matrix symmetry P^T = P", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const P = computeAntiGanProjectionMatrix(ctx);
      const d = 256;

      let maxDiff = 0;
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) {
          const diff = Math.abs(P[i * d + j]! - P[j * d + i]!);
          if (diff > maxDiff) maxDiff = diff;
        }
      }

      assert.ok(maxDiff < 1e-6, `Symmetry error (${maxDiff}) must be < 1e-6`);
    });

    it("verifies raw implicit projection idempotency P_imp(P_imp(x)) = P_imp(x) with error < 1e-6", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const d = ctx.dimension;
      const k = ctx.subspaceRank;
      const U = ctx.basisU;

      // Raw implicit projection helper (un-normalized)
      function rawImplicitProj(x: Float32Array): Float32Array {
        const c = new Float32Array(k);
        for (let i = 0; i < k; i++) {
          let dot = 0;
          for (let j = 0; j < d; j++) dot += U[i * d + j]! * x[j]!;
          c[i] = dot;
        }
        const y = new Float32Array(d);
        for (let j = 0; j < d; j++) {
          let sub = 0;
          for (let i = 0; i < k; i++) sub += c[i]! * U[i * d + j]!;
          y[j] = x[j]! - sub;
        }
        return y;
      }

      const vec = new Float32Array(d);
      for (let i = 0; i < d; i++) vec[i] = Math.sin(i * 0.4 + 1.2);

      const p1 = rawImplicitProj(vec);
      const p2 = rawImplicitProj(p1);

      let maxDiff = 0;
      for (let i = 0; i < d; i++) {
        const diff = Math.abs(p2[i]! - p1[i]!);
        if (diff > maxDiff) maxDiff = diff;
      }

      assert.ok(
        maxDiff < 1e-6,
        `Raw implicit projection idempotency error (${maxDiff}) must be < 1e-6`
      );
    });

    it("verifies full projectAntiGan idempotency: project(project(x)) === project(x)", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const vec = l2Normalize(new Float32Array(256).map((_, i) => Math.cos(i * 0.17)));

      const p1 = projectAntiGan(vec, ctx);
      const p2 = projectAntiGan(p1, ctx);

      let maxDiff = 0;
      for (let i = 0; i < 256; i++) {
        const diff = Math.abs(p2[i]! - p1[i]!);
        if (diff > maxDiff) maxDiff = diff;
      }

      assert.ok(
        maxDiff < 1e-6,
        `Normalized projectAntiGan idempotency error (${maxDiff}) must be < 1e-6`
      );
    });
  });

  describe("3. Null Space Nullification (P * u_i = 0)", () => {
    it("verifies P * u_i = 0 for all basis vectors u_i in span(U)", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const P = computeAntiGanProjectionMatrix(ctx);
      const d = 256;
      const k = 32;

      let maxNullErr = 0;
      for (let i = 0; i < k; i++) {
        const ui = ctx.basisU.subarray(i * d, (i + 1) * d);
        for (let row = 0; row < d; row++) {
          let sum = 0;
          for (let col = 0; col < d; col++) {
            sum += P[row * d + col]! * ui[col]!;
          }
          const absVal = Math.abs(sum);
          if (absVal > maxNullErr) maxNullErr = absVal;
        }
      }

      assert.ok(
        maxNullErr < 1e-6,
        `Null space nullification max error (${maxNullErr}) must be < 1e-6`
      );
    });

    it("verifies P * v = 0 for arbitrary linear combinations v = sum c_i * u_i", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const P = computeAntiGanProjectionMatrix(ctx);
      const d = 256;
      const k = 32;

      // Construct random synthetic GAN reconstruction vector in span(U)
      const syntheticManifoldVec = new Float32Array(d);
      for (let i = 0; i < k; i++) {
        const coeff = Math.sin(i * 3.7 + 0.5);
        const ui = ctx.basisU.subarray(i * d, (i + 1) * d);
        for (let j = 0; j < d; j++) {
          syntheticManifoldVec[j] += coeff * ui[j]!;
        }
      }

      let maxNullErr = 0;
      for (let row = 0; row < d; row++) {
        let sum = 0;
        for (let col = 0; col < d; col++) {
          sum += P[row * d + col]! * syntheticManifoldVec[col]!;
        }
        const absVal = Math.abs(sum);
        if (absVal > maxNullErr) maxNullErr = absVal;
      }

      assert.ok(
        maxNullErr < 1e-6,
        `Synthetic GAN manifold vector nullification error (${maxNullErr}) must be < 1e-6`
      );
    });
  });

  describe("4. Implicit vs Explicit Matrix Projection Equivalence (< 10^-6 error)", () => {
    it("verifies numerical equivalence between implicit O(d*k) and explicit O(d^2) matrix projections over 100 test vectors", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const P = computeAntiGanProjectionMatrix(ctx);
      const d = 256;
      const k = 32;
      const U = ctx.basisU;

      let globalMaxDiffRaw = 0;
      let globalMaxDiffNormalized = 0;

      for (let testIdx = 0; testIdx < 100; testIdx++) {
        const vec = new Float32Array(d);
        for (let j = 0; j < d; j++) {
          vec[j] = Math.cos(testIdx * 0.31 + j * 0.19);
        }

        // Implicit raw: y_imp = vec - U (U^T vec)
        const c = new Float32Array(k);
        for (let i = 0; i < k; i++) {
          let dot = 0;
          for (let j = 0; j < d; j++) dot += U[i * d + j]! * vec[j]!;
          c[i] = dot;
        }
        const yImp = new Float32Array(d);
        for (let j = 0; j < d; j++) {
          let sub = 0;
          for (let i = 0; i < k; i++) sub += c[i]! * U[i * d + j]!;
          yImp[j] = vec[j]! - sub;
        }

        // Explicit raw: y_exp = P * vec
        const yExp = new Float32Array(d);
        for (let i = 0; i < d; i++) {
          let sum = 0;
          for (let j = 0; j < d; j++) {
            sum += P[i * d + j]! * vec[j]!;
          }
          yExp[i] = sum;
        }

        // Compare raw projections
        for (let j = 0; j < d; j++) {
          const diff = Math.abs(yImp[j]! - yExp[j]!);
          if (diff > globalMaxDiffRaw) globalMaxDiffRaw = diff;
        }

        // Compare normalized outputs
        const projImpNorm = projectAntiGan(vec, ctx);
        const projExpNorm = l2Normalize(yExp);

        for (let j = 0; j < d; j++) {
          const diff = Math.abs(projImpNorm[j]! - projExpNorm[j]!);
          if (diff > globalMaxDiffNormalized) globalMaxDiffNormalized = diff;
        }
      }

      assert.ok(
        globalMaxDiffRaw < 1e-6,
        `Implicit vs Explicit raw projection max error (${globalMaxDiffRaw}) must be < 1e-6`
      );
      assert.ok(
        globalMaxDiffNormalized < 1e-6,
        `Implicit vs Explicit normalized projection max error (${globalMaxDiffNormalized}) must be < 1e-6`
      );
    });
  });

  describe("5. Session Key Determinism & Isolation", () => {
    it("verifies identical session keys produce bitwise identical projection matrices and projected vectors", () => {
      const key = new Uint8Array(32).map((_, i) => (i * 13 + 7) & 0xff);
      const ctx1 = initSessionAntiGan({ sessionKey: key });
      const ctx2 = initSessionAntiGan({ sessionKey: key });

      assert.equal(ctx1.sessionId, ctx2.sessionId);
      assert.deepEqual(Array.from(ctx1.basisU), Array.from(ctx2.basisU));

      const P1 = computeAntiGanProjectionMatrix(ctx1);
      const P2 = computeAntiGanProjectionMatrix(ctx2);
      assert.deepEqual(Array.from(P1), Array.from(P2));

      const sampleVec = l2Normalize(new Float32Array(256).fill(0.123));
      const proj1 = projectAntiGan(sampleVec, ctx1);
      const proj2 = projectAntiGan(sampleVec, ctx2);

      assert.deepEqual(Array.from(proj1), Array.from(proj2));
    });

    it("verifies distinct session keys produce isolated, distinct subspaces and projected vectors", () => {
      const keyA = new Uint8Array(32).fill(0x01);
      const keyB = new Uint8Array(32).fill(0x02);

      const ctxA = initSessionAntiGan({ sessionKey: keyA });
      const ctxB = initSessionAntiGan({ sessionKey: keyB });

      assert.notEqual(ctxA.sessionId, ctxB.sessionId);

      const sampleVec = l2Normalize(new Float32Array(256).map((_, i) => Math.sin(i * 0.1)));
      const projA = projectAntiGan(sampleVec, ctxA);
      const projB = projectAntiGan(sampleVec, ctxB);

      const dist = cosineDistance(projA, projB);
      assert.ok(dist > 0.01, `Projected vectors under distinct keys must differ significantly (got dist=${dist})`);
    });
  });

  describe("6. L2 Re-normalization Epsilon Safeguard & Numerical Stability Stress", () => {
    it("prevents zero division and NaN propagation on all-zero vectors", () => {
      const ctx = initSessionAntiGan();
      const zeroVec = new Float32Array(256).fill(0);

      const result = projectAntiGan(zeroVec, ctx);

      assert.equal(result.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.ok(!Number.isNaN(result[i]), `Component ${i} must not be NaN`);
        assert.ok(Number.isFinite(result[i]), `Component ${i} must be finite`);
        assert.equal(result[i], 0, `Component ${i} of zero vector projection should be 0`);
      }
    });

    it("prevents zero division and NaN propagation on vectors in the synthetic GAN null space", () => {
      const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
      const d = 256;
      const k = 32;

      // Pure synthetic GAN vector in span(U): raw y = x - U(U^T x) evaluates to zero vector
      const u0 = ctx.basisU.subarray(0, d);

      const result = projectAntiGan(u0, ctx);

      assert.equal(result.length, d);
      for (let i = 0; i < d; i++) {
        assert.ok(!Number.isNaN(result[i]), `Null space projection component ${i} must not be NaN`);
        assert.ok(Number.isFinite(result[i]), `Null space projection component ${i} must be finite`);
      }

      // Epsilon safeguard should fall back to l2Normalize(u0), which for a unit vector u0 is u0
      const dist = cosineDistance(result, u0);
      assert.ok(dist < 1e-5, `Fallback on null space vector should preserve normalized original vector (got dist=${dist})`);
    });

    it("handles tiny subnormal and near-zero norm vectors without underflow NaN/Infinity", () => {
      const ctx = initSessionAntiGan();
      const tinyScales = [1e-8, 1e-15, 1e-25, 1e-35];

      for (const scale of tinyScales) {
        const vec = new Float32Array(256);
        for (let i = 0; i < 256; i++) vec[i] = scale * Math.sin(i);

        const result = projectAntiGan(vec, ctx);

        for (let i = 0; i < 256; i++) {
          assert.ok(!Number.isNaN(result[i]), `Scale ${scale}: Component ${i} is NaN`);
          assert.ok(Number.isFinite(result[i]), `Scale ${scale}: Component ${i} is non-finite`);
        }
      }
    });

    it("handles large magnitude vectors without overflow NaN/Infinity", () => {
      const ctx = initSessionAntiGan();
      const largeScales = [1e8, 1e15, 1e25];

      for (const scale of largeScales) {
        const vec = new Float32Array(256);
        for (let i = 0; i < 256; i++) vec[i] = scale * Math.cos(i);

        const result = projectAntiGan(vec, ctx);

        for (let i = 0; i < 256; i++) {
          assert.ok(!Number.isNaN(result[i]), `Scale ${scale}: Component ${i} is NaN`);
          assert.ok(Number.isFinite(result[i]), `Scale ${scale}: Component ${i} is non-finite`);
        }

        // Resulting vector should be unit-normalized
        let normSq = 0;
        for (let i = 0; i < 256; i++) normSq += result[i]! * result[i]!;
        const norm = Math.sqrt(normSq);
        assert.ok(Math.abs(norm - 1.0) < 1e-5, `Projected vector norm (${norm}) must be 1.0`);
      }
    });

    it("validates boundary inputs for subspaceRank >= dimension", () => {
      assert.throws(() => {
        initSessionAntiGan({ subspaceRank: 256, dimension: 256 });
      }, /Subspace rank k \(256\) must be strictly less than dimension d \(256\)/);

      assert.throws(() => {
        initSessionAntiGan({ subspaceRank: 300, dimension: 256 });
      }, /Subspace rank k \(300\) must be strictly less than dimension d \(256\)/);
    });
  });
});
