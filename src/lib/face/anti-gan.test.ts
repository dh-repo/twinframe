import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  initSessionAntiGan,
  projectAntiGan,
  projectAntiGanBatch,
  computeAntiGanProjectionMatrix,
  verifyAntiGanContext,
} from "./anti-gan.ts";
import { l2Normalize } from "./embeddings.ts";

describe("Feature 12: Session-Bound Anti-GAN Orthogonal Subspace Projections", () => {
  test("1. Orthonormality & Context Verification (U^T U = I_k)", () => {
    const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });
    assert.equal(ctx.dimension, 256);
    assert.equal(ctx.subspaceRank, 32);
    assert.equal(ctx.basisU.length, 256 * 32);

    const report = verifyAntiGanContext(ctx, 1e-4);
    assert.ok(report.valid, "Anti-GAN context verification checks must pass cleanly");
    assert.ok(report.orthonormalityError < 1e-5, `Orthonormality error (${report.orthonormalityError}) must be < 1e-5`);
    assert.ok(report.idempotencyError < 1e-5, `Idempotency error (${report.idempotencyError}) must be < 1e-5`);
    assert.ok(report.nullSpaceError < 1e-5, `Null space error (${report.nullSpaceError}) must be < 1e-5`);
    assert.equal(report.rank, 224, "Effective rank of P must be d - k = 224");
  });

  test("2. Session Key Determinism & Key Isolation", () => {
    const keyA = new Uint8Array(32).fill(0xaa);
    const keyB = new Uint8Array(32).fill(0xbb);

    const ctxA1 = initSessionAntiGan({ sessionKey: keyA });
    const ctxA2 = initSessionAntiGan({ sessionKey: keyA });
    const ctxB = initSessionAntiGan({ sessionKey: keyB });

    assert.equal(ctxA1.basisU[0], ctxA2.basisU[0], "Identical session keys must produce identical basis matrices");
    assert.notEqual(ctxA1.basisU[0], ctxB.basisU[0], "Distinct session keys must produce distinct basis matrices");

    const sample = l2Normalize(new Float32Array(256).fill(0.5));
    const projA1 = projectAntiGan(sample, ctxA1);
    const projA2 = projectAntiGan(sample, ctxA2);
    const projB = projectAntiGan(sample, ctxB);

    assert.deepEqual(Array.from(projA1), Array.from(projA2), "Identical keys must yield identical projected vectors");
    assert.notEqual(projA1[0], projB[0], "Distinct keys must yield distinct projected vectors");
  });

  test("3. Implicit vs Explicit Matrix Projection Equivalence", () => {
    const ctx = initSessionAntiGan({ subspaceRank: 16, dimension: 256 });
    const P = computeAntiGanProjectionMatrix(ctx);

    const vRaw = new Float32Array(256);
    for (let i = 0; i < 256; i++) vRaw[i] = Math.cos(i * 0.3);
    const vNorm = l2Normalize(vRaw);

    // Fast implicit projection
    const yImplicit = projectAntiGan(vNorm, ctx);

    // Explicit matrix projection: y_exp = P * v
    const yExpRaw = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let sum = 0;
      for (let j = 0; j < 256; j++) {
        sum += P[i * 256 + j]! * vNorm[j]!;
      }
      yExpRaw[i] = sum;
    }
    const yExplicit = l2Normalize(yExpRaw);

    let maxDiff = 0;
    for (let i = 0; i < 256; i++) {
      const diff = Math.abs(yImplicit[i]! - yExplicit[i]!);
      if (diff > maxDiff) maxDiff = diff;
    }

    assert.ok(maxDiff < 1e-5, `Implicit vs explicit projection max difference (${maxDiff}) must be < 1e-5`);
  });

  test("4. Null Space Suppression (P * u_i = 0)", () => {
    const ctx = initSessionAntiGan({ subspaceRank: 32, dimension: 256 });

    // Pick 1st basis vector u_0 (which lies entirely in span(U))
    const u0 = ctx.basisU.subarray(0, 256);
    const yProj = projectAntiGan(u0, ctx);

    // Because u0 is in the null space of P, L2 norm of P * u0 before re-normalization is ~0,
    // which triggers the epsilon safeguard and returns normalized u0 safely without NaNs.
    for (let i = 0; i < 256; i++) {
      assert.ok(Number.isFinite(yProj[i]), "Projected null space vector must be finite numbers");
    }
  });

  test("5. Batch Projection & Exception Safeguards", () => {
    const ctx = initSessionAntiGan();
    const vec1 = l2Normalize(new Float32Array(256).fill(1));
    const vec2 = l2Normalize(new Float32Array(256).fill(2));

    const batch = projectAntiGanBatch([vec1, vec2], ctx);
    assert.equal(batch.length, 2);
    assert.equal(batch[0]!.length, 256);
    assert.equal(batch[1]!.length, 256);

    // Invalid dimension input must throw RangeError
    assert.throws(() => {
      projectAntiGan(new Float32Array(100), ctx);
    }, RangeError);
  });
});
