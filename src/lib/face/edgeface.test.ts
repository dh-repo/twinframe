import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeL2Norm,
  normalizeL2,
  decodeFloat16,
  extractEdgeFaceEmbedding,
  extractPlanarTensorFromCanvas,
} from "./edgeface.ts";
import { OnnxSessionManager } from "./onnx-engine.ts";

describe("EdgeFace-M 256-d Feature Extraction Unit Suite", () => {
  describe("1. Vector L2 Normalization & Math", () => {
    it("computes L2 norm correctly", () => {
      const v = new Float32Array([3, 4]);
      assert.equal(computeL2Norm(v), 5);
    });

    it("normalizes a 256-d vector so ||v_hat||_2 is strictly 1.0", () => {
      const v = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        v[i] = (i + 1) * 0.01;
      }
      const normVec = normalizeL2(v);
      assert.equal(normVec.length, 256);

      const norm = computeL2Norm(normVec);
      assert.ok(Math.abs(norm - 1.0) < 1e-6, `Expected norm 1.0, got ${norm}`);
    });

    it("safely handles zero vector inputs without throwing or producing NaNs", () => {
      const zeroVec = new Float32Array(256);
      const out = normalizeL2(zeroVec);
      assert.equal(out.length, 256);

      for (let i = 0; i < 256; i++) {
        assert.equal(out[i], 0);
        assert.ok(!Number.isNaN(out[i]));
      }
      assert.equal(computeL2Norm(out), 0);
    });

    it("safely handles near-zero or non-finite inputs (NaN / Infinity)", () => {
      const badVec = new Float32Array(256);
      badVec[0] = NaN;
      badVec[1] = Infinity;
      badVec[2] = 1e-15;

      const out = normalizeL2(badVec);
      assert.equal(out.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.ok(Number.isFinite(out[i]), `Non-finite value at index ${i}: ${out[i]}`);
      }
    });
  });

  describe("2. Float16 Bit Decoding (IEEE 754 Half Precision)", () => {
    it("decodes Float16 zero, positive one, negative one, and half", () => {
      assert.equal(decodeFloat16(0x0000), 0.0);
      assert.equal(decodeFloat16(0x3c00), 1.0);
      assert.equal(decodeFloat16(0xbc00), -1.0);
      assert.equal(decodeFloat16(0x3800), 0.5);
    });

    it("decodes Float16 infinity and NaN correctly", () => {
      assert.equal(decodeFloat16(0x7c00), Infinity);
      assert.equal(decodeFloat16(0xfc00), -Infinity);
      assert.ok(Number.isNaN(decodeFloat16(0x7e00)));
    });
  });

  describe("3. Planar NCHW Preprocessing", () => {
    it("extracts NCHW Float32Array [1, 3, 112, 112] tensor of size 37632", () => {
      if (typeof document === "undefined") return; // DOM environment check
      const canvas = document.createElement("canvas");
      canvas.width = 112;
      canvas.height = 112;
      const tensor = extractPlanarTensorFromCanvas(canvas, 112);
      assert.equal(tensor.length, 37632);
      for (let i = 0; i < tensor.length; i++) {
        assert.ok(tensor[i]! >= -1.0 && tensor[i]! <= 1.0);
      }
    });
  });

  describe("4. extractEdgeFaceEmbedding ONNX Session Run", () => {
    it("runs ONNX session and returns 256-d L2-normalized embedding", async () => {
      // Mock session in OnnxSessionManager
      const mockEmbeddingData = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        mockEmbeddingData[i] = (i % 10) + 1;
      }

      const mockSession = {
        inputNames: ["input"],
        outputNames: ["embedding"],
        run: async () => ({
          embedding: {
            data: mockEmbeddingData,
            dims: [1, 256],
            type: "float32",
          },
        }),
      };

      const manager = OnnxSessionManager.getInstance();
      const origGetSession = manager.getSession.bind(manager);
      manager.getSession = async () => mockSession as any;

      try {
        const inputTensor = new Float32Array(1 * 3 * 112 * 112).fill(0.1);
        const res = await extractEdgeFaceEmbedding(inputTensor, undefined, { modelPath: "/models/edgeface_m.onnx" });

        assert.equal(res.embedding.length, 256);
        const norm = computeL2Norm(res.embedding);
        assert.ok(Math.abs(norm - 1.0) < 1e-5, `Expected norm 1.0, got ${norm}`);
        assert.ok(res.latencyMs >= 0);
      } finally {
        manager.getSession = origGetSession;
      }
    });
  });
});
