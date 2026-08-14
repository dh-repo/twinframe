import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dotProduct256,
  cosineDistance256,
  cosineDistance,
  distanceToMatchPercent,
  l2Normalize,
} from "./embeddings.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";
import { extractEdgeFaceEmbedding, normalizeL2, computeL2Norm } from "./edgeface.ts";
import type { FaceStageLatencies, FaceTelemetry } from "./types.ts";

describe("Milestone 3 Phase 3 AccuFace v4.0 Pipeline & Metric Recalibration Suite", () => {
  describe("1. EdgeFace-M 256-d Vector Normalization & ONNX Extraction", () => {
    it("ensures extracted embeddings are Float32Array of dimension 256", () => {
      const raw = new Float32Array(256);
      for (let i = 0; i < 256; i++) raw[i] = (i + 1) * 0.05;
      const normalized = normalizeL2(raw);

      assert.equal(normalized.length, 256);
      const norm = computeL2Norm(normalized);
      assert.ok(Math.abs(norm - 1.0) < 1e-6, `Norm must be 1.0, got ${norm}`);
    });

    it("handles zero vector gracefully during L2 normalization without NaN", () => {
      const zeroVec = new Float32Array(256);
      const normalized = normalizeL2(zeroVec);

      assert.equal(normalized.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.equal(normalized[i], 0);
      }
    });
  });

  describe("2. 8-Way Unrolled Cosine Distance & Clamping Bounds", () => {
    it("computes exact dot product using 8-way loop unrolling for 256-d vectors", () => {
      const a = new Float32Array(256).fill(1 / Math.sqrt(256));
      const b = new Float32Array(256).fill(1 / Math.sqrt(256));

      const dot = dotProduct256(a, b);
      assert.ok(Math.abs(dot - 1.0) < 1e-6, `Expected dot product 1.0, got ${dot}`);

      const dist = cosineDistance256(a, b);
      assert.ok(Math.abs(dist - 0.0) < 1e-6, `Expected distance 0.0 for identical unit vectors, got ${dist}`);
    });

    it("computes distance 1.0 for orthogonal 256-d unit vectors", () => {
      const a = new Float32Array(256).fill(0);
      const b = new Float32Array(256).fill(0);
      a[0] = 1.0;
      b[1] = 1.0;

      const dist = cosineDistance256(a, b);
      assert.equal(dist, 1.0, `Expected distance 1.0 for orthogonal vectors, got ${dist}`);
    });

    it("computes distance 2.0 for antipodal 256-d unit vectors", () => {
      const a = new Float32Array(256).fill(0);
      const b = new Float32Array(256).fill(0);
      a[0] = 1.0;
      b[0] = -1.0;

      const dist = cosineDistance256(a, b);
      assert.equal(dist, 2.0, `Expected distance 2.0 for antipodal vectors, got ${dist}`);
    });

    it("strictly clamps distance to [0.0, 2.0] even under floating-point precision overflow", () => {
      const a = new Float32Array(256).fill(1.000001);
      const b = new Float32Array(256).fill(1.000001);

      const dist = cosineDistance256(a, b);
      assert.ok(dist >= 0.0 && dist <= 2.0, `Distance ${dist} out of bounds [0.0, 2.0]`);
    });
  });

  describe("3. Recalibrated Hill Curve Parameters (d0 = 0.38, n = 4.5)", () => {
    it("returns exactly 100.0 at d = 0.0", () => {
      assert.equal(distanceToMatchPercent(0), 100.0);
    });

    it("returns exactly 50.0 at half-saturation decision boundary d = 0.38", () => {
      const p = distanceToMatchPercent(0.38);
      assert.equal(p, 50.0, `Expected 50.0 at d=0.38, got ${p}`);
    });

    it("evaluates expected recalibrated match percentages at key distance points", () => {
      assert.equal(distanceToMatchPercent(0.20), 94.7);
      assert.equal(distanceToMatchPercent(0.30), 74.3);
      assert.equal(distanceToMatchPercent(0.45), 31.8);
      assert.equal(distanceToMatchPercent(0.50), 22.5);
    });

    it("enforces strict monotonicity across distance range [0.0, 2.0]", () => {
      let prev = distanceToMatchPercent(0);
      for (let d = 0.01; d <= 2.0; d += 0.01) {
        const curr = distanceToMatchPercent(d);
        assert.ok(
          curr <= prev,
          `Monotonicity violation at d=${d}: P(${d - 0.01})=${prev} < P(${d})=${curr}`
        );
        prev = curr;
      }
    });

    it("handles boundary values (NaN, negative distance, Infinity) safely", () => {
      assert.equal(distanceToMatchPercent(-0.5), 100.0);
      assert.equal(distanceToMatchPercent(Infinity), 0.0);
      assert.equal(distanceToMatchPercent(NaN), 0.0);
    });
  });

  describe("4. Telemetry Schema & Stage Latency Tracking", () => {
    it("validates FaceStageLatencies interface containing embeddingPassMs property", () => {
      const latencies: FaceStageLatencies = {
        modelLoadMs: 15,
        downscaleMs: 2,
        scrfdPassMs: 8,
        frontalizationMs: 12,
        embeddingMs: 18,
        embeddingPassMs: 18,
        biohashMs: 4,
        totalMs: 59,
      };

      assert.equal(latencies.embeddingPassMs, 18);
      assert.equal(latencies.embeddingMs, 18);
      assert.ok(latencies.totalMs > 0);
    });

    it("executes rankByDescriptor with 256-d query vector and returns top matches", () => {
      const queryVector = new Float32Array(256);
      queryVector[0] = 1.0;

      const user: UserFaceQuery = {
        descriptor: queryVector,
        age: 30,
        gender: "female",
        genderProbability: 0.95,
        detConfidence: 0.98,
        sharpness: 90,
        faceCoverage: 0.3,
      };

      const mockGallery = [
        {
          id: "celeb-1",
          name: "Celeb One",
          path: "/photo1.jpg",
          descriptor: new Float32Array(256).fill(0.0), // orthogonal
          age: 30,
          gender: "female" as const,
          genderProb: 0.95,
        },
      ];
      mockGallery[0]!.descriptor[0] = 1.0; // match

      const matches = rankByDescriptor(user, mockGallery, 1);
      assert.equal(matches.length, 1);
      assert.equal(matches[0]!.celebrityId, "celeb-1");
      assert.equal(matches[0]!.matchPercent, 100.0);
    });
  });
});
