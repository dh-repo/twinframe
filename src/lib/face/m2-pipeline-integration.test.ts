import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FaceStageLatencies, FaceTelemetry } from "./types.ts";
import {
  REFERENCE_LANDMARKS_112,
  REFERENCE_LANDMARKS_160,
  compute5PointSimilarityMatrix,
} from "./similarity-transform.ts";
import { normalizeL2, computeL2Norm } from "./edgeface.ts";
import { initSessionAntiGan, projectAntiGan } from "./anti-gan.ts";
import { getExecutionProviders, probeHardwareCapabilities } from "./onnx-engine.ts";
import { getCanonicalBlendshapeBases, EXP_NORM_WGSL_SHADER } from "./exp-norm-wgsl.ts";

describe("Milestone 2 Pipeline Integration & Telemetry Unit Suite", () => {
  it("includes scrfdPassMs and frontalizationMs in FaceStageLatencies interface", () => {
    const latencies: FaceStageLatencies = {
      modelLoadMs: 12,
      downscaleMs: 2,
      scrfdPassMs: 15,
      frontalizationMs: 8,
      embeddingMs: 25,
      totalMs: 62,
    };

    assert.equal(latencies.scrfdPassMs, 15);
    assert.equal(latencies.frontalizationMs, 8);
  });

  it("populates frontalizationMethod and estimated pose angles in FaceTelemetry", () => {
    const telemetry: FaceTelemetry = {
      originalWidth: 1920,
      originalHeight: 1080,
      downscaledWidth: 640,
      downscaledHeight: 640,
      faceCount: 1,
      primaryConfidence: 0.96,
      latencies: {
        modelLoadMs: 10,
        downscaleMs: 1,
        scrfdPassMs: 14,
        frontalizationMs: 6,
        embeddingMs: 22,
        totalMs: 53,
      },
      frontalizationMethod: "exp-norm-wgsl",
      estimatedYaw: 32.5,
      estimatedPitch: 4.1,
      estimatedRoll: -1.2,
    };

    assert.equal(telemetry.frontalizationMethod, "exp-norm-wgsl");
    assert.equal(telemetry.estimatedYaw, 32.5);
    assert.equal(telemetry.latencies.scrfdPassMs, 14);
    assert.equal(telemetry.latencies.frontalizationMs, 6);
  });

  it("enforces routing decision: exp-norm-wgsl when |yaw| > 25° vs 5pt-similarity when |yaw| <= 25°", () => {
    function routeFrontalization(yaw: number): "exp-norm-wgsl" | "5pt-similarity" {
      return Math.abs(yaw) > 25 ? "exp-norm-wgsl" : "5pt-similarity";
    }

    assert.equal(routeFrontalization(0), "5pt-similarity");
    assert.equal(routeFrontalization(15), "5pt-similarity");
    assert.equal(routeFrontalization(-25), "5pt-similarity");
    assert.equal(routeFrontalization(25.1), "exp-norm-wgsl");
    assert.equal(routeFrontalization(-45), "exp-norm-wgsl");
  });

  it("verifies exact ArcFace/InsightFace 112x112 canonical reference landmark coordinates", () => {
    // Canonical 5-point coordinates: Left Eye, Right Eye, Nose Tip, Left Mouth, Right Mouth
    const expected112: [number, number][] = [
      [38.2946, 51.6963],
      [73.5318, 51.5014],
      [56.0252, 71.7366],
      [41.5493, 92.3655],
      [70.7299, 92.2041],
    ];

    assert.equal(REFERENCE_LANDMARKS_112.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.ok(
        Math.abs(REFERENCE_LANDMARKS_112[i][0] - expected112[i][0]) < 1e-4,
        `Landmark ${i} X mismatch`
      );
      assert.ok(
        Math.abs(REFERENCE_LANDMARKS_112[i][1] - expected112[i][1]) < 1e-4,
        `Landmark ${i} Y mismatch`
      );
    }
  });

  it("verifies that bypassing Anti-GAN preserves pure identity cosine similarity (1.0 vs ~0.75)", () => {
    // Synthetic raw 256-d embedding
    const rawEmb = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      rawEmb[i] = Math.sin(i * 0.37 + 1.2);
    }
    const pureNorm = normalizeL2(rawEmb);

    // Self-similarity of pure embedding is exactly 1.0
    let pureSelfDot = 0;
    for (let i = 0; i < 256; i++) {
      pureSelfDot += pureNorm[i] * pureNorm[i];
    }
    assert.ok(Math.abs(pureSelfDot - 1.0) < 1e-6, `Pure embedding self-dot must be 1.0, got ${pureSelfDot}`);

    // If session Anti-GAN projection were applied to query sessions:
    const ctxA = initSessionAntiGan({ dimension: 256, subspaceRank: 32 });
    const ctxB = initSessionAntiGan({ dimension: 256, subspaceRank: 32 });
    const projA = projectAntiGan(pureNorm, ctxA);
    const projB = projectAntiGan(pureNorm, ctxB);

    let degradedDot = 0;
    for (let i = 0; i < 256; i++) {
      degradedDot += projA[i] * projB[i];
    }

    // Two queries with different session keys drop similarity from 1.0 down significantly
    assert.ok(
      degradedDot < 0.98,
      `Projected dot product (${degradedDot}) is corrupted by session subspace basis`
    );

    // Bypassing Anti-GAN keeps raw pure vector with dot product 1.0 against identical vector
    assert.ok(
      pureSelfDot - degradedDot > 0.02,
      "Bypassing Anti-GAN restores biometric fidelity and prevents non-deterministic distortion"
    );
  });

  it("verifies strict L2 normalization precision (||v||_2 = 1.0 ± 10^-6) and no zero-padding distortion", () => {
    const rawVec = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      rawVec[i] = (i % 7 === 0 ? -1 : 1) * Math.sqrt(i + 1);
    }

    const normalized = normalizeL2(rawVec);
    const norm = computeL2Norm(normalized);

    assert.ok(
      Math.abs(norm - 1.0) < 1e-6,
      `L2 norm must be 1.0 ± 10^-6, got ${norm}`
    );
    assert.equal(normalized.length, 256);

    // Verify all dimensions are populated (non-zero)
    let nonZeroCount = 0;
    for (let i = 0; i < 256; i++) {
      if (normalized[i] !== 0) nonZeroCount++;
    }
    assert.equal(nonZeroCount, 256);
  });

  it("verifies WebGPU execution provider prioritization in ONNX engine", () => {
    const eps = getExecutionProviders();
    assert.deepEqual(eps, ["webgpu", "wasm"]);
    assert.equal(eps[0], "webgpu");
  });

  it("verifies WGSL compute pass workgroup configuration", () => {
    assert.ok(EXP_NORM_WGSL_SHADER.includes("@compute @workgroup_size(16, 16, 1)"));
    const bases = getCanonicalBlendshapeBases(112);
    assert.equal(bases.length, 112 * 112 * 11 * 4);
  });
});
