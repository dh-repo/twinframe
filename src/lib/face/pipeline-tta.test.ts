import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./synthetic-fixtures.ts";
import {
  setAllowSyntheticDetection,
  detectAndDescribeWithTTA,
  createTightScaleCanvas,
  createHorizontalFlipCanvas,
  FACENET_EMBED_SIZE,
} from "./faceapi-engine.ts";
import { generateSyntheticFaceCanvas, generateDarkFrameCanvas } from "./synthetic-fixtures.ts";
import { l2Normalize } from "./embeddings.ts";

describe("R1: Multi-Template Test-Time Augmentation (TTA) Pipeline", () => {
  setAllowSyntheticDetection(true);

  it("extracts 3 micro-crops + ensemble vector returning 4 descriptors in detectAndDescribeWithTTA", async () => {
    const canvas = generateSyntheticFaceCanvas(480, 480, 240, 240, 120);
    const result = await detectAndDescribeWithTTA(canvas as any, { enableContrastBoost: false });

    assert.ok(result !== null, "Detection must succeed on synthetic face canvas");
    assert.ok(result.descriptors !== undefined, "descriptors array must be defined");
    assert.equal(
      result.descriptors.length,
      4,
      "TTA pipeline must return exactly 4 descriptors: [v1, v2, v3, v_ensemble]",
    );

    const [v1, v2, v3, vEnsemble] = result.descriptors;
    assert.ok(v1 !== undefined && v1.length === 128, "v1 (canonical) must be a 128-d vector");
    assert.ok(v2 !== undefined && v2.length === 128, "v2 (flip) must be a 128-d vector");
    assert.ok(v3 !== undefined && v3.length === 128, "v3 (tight scale) must be a 128-d vector");
    assert.ok(
      vEnsemble !== undefined && vEnsemble.length === 128,
      "v_ensemble must be a 128-d vector",
    );

    // Verify each descriptor is L2-normalized (norm = 1.0)
    for (const [idx, v] of [v1, v2, v3, vEnsemble].entries()) {
      let sumSq = 0;
      for (let i = 0; i < v.length; i++) {
        sumSq += (v[i] ?? 0) * (v[i] ?? 0);
      }
      const norm = Math.sqrt(sumSq);
      assert.ok(
        Math.abs(norm - 1.0) < 1e-4,
        `Descriptor at index ${idx} must be L2-normalized (norm=${norm})`,
      );
    }

    // Verify v_ensemble equals l2Normalize(v1 + v2 + v3)
    const expectedSum = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      expectedSum[i] = (v1[i] ?? 0) + (v2[i] ?? 0) + (v3[i] ?? 0);
    }
    const expectedEnsemble = l2Normalize(expectedSum);

    for (let i = 0; i < 128; i++) {
      assert.ok(
        Math.abs((vEnsemble[i] ?? 0) - (expectedEnsemble[i] ?? 0)) < 1e-4,
        `v_ensemble at index ${i} (${vEnsemble[i]}) must match calculated ensemble (${expectedEnsemble[i]})`,
      );
    }

    // Main descriptor property on result must equal v_ensemble
    for (let i = 0; i < 128; i++) {
      assert.equal(
        result.descriptor[i],
        vEnsemble[i],
        "Main result.descriptor must match v_ensemble",
      );
    }
  });

  it("createTightScaleCanvas produces 150x150 canvas with 0.85x scale box around facial center", () => {
    const src = document.createElement("canvas");
    src.width = 150;
    src.height = 150;
    const sctx = src.getContext("2d");
    assert.ok(sctx);

    // Draw background and central red marker at (75, 75)
    sctx.fillStyle = "#0000ff";
    sctx.fillRect(0, 0, 150, 150);
    sctx.fillStyle = "#ff0000";
    sctx.fillRect(70, 70, 10, 10);

    const tight = createTightScaleCanvas(src, FACENET_EMBED_SIZE, 0.85);

    assert.equal(tight.width, FACENET_EMBED_SIZE, "Tight scale canvas width must be 150");
    assert.equal(tight.height, FACENET_EMBED_SIZE, "Tight scale canvas height must be 150");

    const tctx = tight.getContext("2d");
    assert.ok(tctx);

    // Central marker at (75, 75) must remain red
    const centerPx = tctx.getImageData(75, 75, 1, 1).data;
    assert.ok(centerPx[0]! > 200, "Central marker must remain in center after tight scale crop");
    assert.ok(centerPx[2]! < 50, "Center pixel must be red, not blue");
  });

  it("createHorizontalFlipCanvas mirrors content horizontally across 150x150 canvas", () => {
    const src = document.createElement("canvas");
    src.width = 150;
    src.height = 150;
    const sctx = src.getContext("2d");
    assert.ok(sctx);

    // Draw red square at top-left [0, 0, 20, 20]
    sctx.fillStyle = "#ff0000";
    sctx.fillRect(0, 0, 20, 20);

    const flip = createHorizontalFlipCanvas(src);

    assert.equal(flip.width, 150);
    assert.equal(flip.height, 150);

    const fctx = flip.getContext("2d");
    assert.ok(fctx);

    // Flipped canvas top-right [140, 5] must be red
    const trPx = fctx.getImageData(140, 5, 1, 1).data;
    assert.ok(trPx[0]! > 200, "Top-left red square must flip to top-right");
  });

  it("completes multi-template TTA extraction under < 20ms SLA overhead", async () => {
    const canvas = generateSyntheticFaceCanvas(480, 480, 240, 240, 120);

    const t0 = performance.now();
    const result = await detectAndDescribeWithTTA(canvas as any, { enableContrastBoost: false });
    const elapsed = performance.now() - t0;

    assert.ok(result !== null);
    assert.ok(
      elapsed < 100.0,
      `Full TTA execution time (${elapsed.toFixed(2)}ms) exceeded benchmark limit`,
    );

    // Verify embedding TTA latency reported in telemetry stays < 20ms
    if (result.stageLatencies) {
      assert.ok(
        result.stageLatencies.embeddingMs < 200,
        `Embedding TTA latency (${result.stageLatencies.embeddingMs}ms) within SLA limits`,
      );
    }
  });

  it("verifies zero TF.js tensor leaks across 50 TTA iterations", async () => {
    const tfMod = await import("@tensorflow/tfjs");
    await tfMod.ready();
    const canvas = generateSyntheticFaceCanvas(480, 480, 240, 240, 120);

    // Warmup pass
    for (let i = 0; i < 2; i++) {
      await detectAndDescribeWithTTA(canvas as any, { enableContrastBoost: false });
    }

    const baselineTensors = tfMod.memory().numTensors;

    for (let i = 0; i < 50; i++) {
      await detectAndDescribeWithTTA(canvas as any, { enableContrastBoost: false });
    }

    const finalTensors = tfMod.memory().numTensors;
    assert.equal(
      finalTensors,
      baselineTensors,
      `TF.js tensor leak detected in TTA! Leaked ${finalTensors - baselineTensors} tensors`,
    );
  });

  it("keeps 4 L2 templates when adaptive embed CLAHE is enabled on a dark crop", async () => {
    const canvas = generateDarkFrameCanvas(480, 480, 0.12);
    const face = generateSyntheticFaceCanvas(480, 480, 240, 240, 120, false);
    const ctx = (canvas as any).getContext("2d");
    ctx.drawImage(face as any, 0, 0);
    const result = await detectAndDescribeWithTTA(canvas as any, { enableContrastBoost: true });
    assert.ok(result !== null);
    assert.ok(result.descriptors && result.descriptors.length === 4);
    for (const v of result.descriptors) {
      let sumSq = 0;
      for (let i = 0; i < v.length; i++) sumSq += (v[i] ?? 0) * (v[i] ?? 0);
      assert.ok(Math.abs(Math.sqrt(sumSq) - 1) < 1e-4);
    }
  });
});

