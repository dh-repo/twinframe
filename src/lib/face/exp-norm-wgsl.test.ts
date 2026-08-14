import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXP_NORM_WGSL_SHADER,
  getCanonicalBlendshapeBases,
  isWebGPUFrontalizationSupported,
  runExpNormFrontalizationCPU,
  runExpNormFrontalizationWGSL,
} from "./exp-norm-wgsl.ts";
import type { SCRFDBoundingBox, SCRFDPose } from "./types.ts";

describe("ExpNorm 3D UV WGSL Frontalization Unit Suite", () => {
  it("contains valid WGSL compute shader source with ExpNormParams struct and workgroup size", () => {
    assert.equal(EXP_NORM_WGSL_SHADER.includes("struct ExpNormParams"), true);
    assert.equal(EXP_NORM_WGSL_SHADER.includes("@compute @workgroup_size(16, 16, 1)"), true);
    assert.equal(EXP_NORM_WGSL_SHADER.includes("blendshapeBases"), true);
    assert.equal(EXP_NORM_WGSL_SHADER.includes("outputTensor"), true);
  });

  it("generates canonical 3D blendshape bases buffer for 112x112 grid (2.2MB)", () => {
    const bases112 = getCanonicalBlendshapeBases(112);
    const expectedLength = 112 * 112 * 11 * 4;

    assert.equal(bases112.length, expectedLength);
    // 112*112*11*4 * 4 bytes/float = 2,207,744 bytes (~2.2MB)
    assert.equal(bases112.byteLength, 2207744);

    // Verify non-zero depth at nose center
    const centerIdx = (56 * 112 + 56) * 44;
    assert.equal(bases112[centerIdx + 2] > 0, true, "Expected z > 0 at nose center");
  });

  it("executes CPU ExpNorm frontalization and outputs Planar NCHW Float32 tensor [1, 3, 112, 112]", () => {
    const bbox: SCRFDBoundingBox = { x: 50, y: 50, width: 200, height: 200 };
    const pose: SCRFDPose = { yaw: 30, pitch: 5, roll: 0 };
    const blendshapes = new Float32Array([0.1, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);

    // Mock OffscreenCanvas source
    let source: any;
    if (typeof OffscreenCanvas !== "undefined") {
      source = new OffscreenCanvas(400, 400);
      const ctx = source.getContext("2d");
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 400, 400);
    } else {
      source = { width: 400, height: 400 };
    }

    const tensor = runExpNormFrontalizationCPU(source, bbox, pose, blendshapes, 112);

    assert.equal(tensor.length, 1 * 3 * 112 * 112);
    assert.equal(Number.isNaN(tensor[0]), false);
  });

  it("gracefully executes safe similarity fallback when WebGPU is unavailable", async () => {
    const bbox: SCRFDBoundingBox = { x: 50, y: 50, width: 200, height: 200 };
    const pose: SCRFDPose = { yaw: 35, pitch: 0, roll: 0 };
    const landmarks = new Float32Array([
      38, 50, 74, 50, 56, 70, 42, 90, 70, 90
    ]);

    let source: any;
    if (typeof OffscreenCanvas !== "undefined") {
      source = new OffscreenCanvas(400, 400);
    } else {
      source = { width: 400, height: 400 };
    }

    const tensor = await runExpNormFrontalizationWGSL(
      source,
      bbox,
      pose,
      landmarks,
      undefined,
      { outputSize: 112 }
    );

    assert.equal(tensor.length, 1 * 3 * 112 * 112);
    assert.equal(Number.isNaN(tensor[0]), false);
  });

  it("queries WebGPU support status without throwing", async () => {
    const supported = await isWebGPUFrontalizationSupported();
    assert.equal(typeof supported, "boolean");
  });
});
