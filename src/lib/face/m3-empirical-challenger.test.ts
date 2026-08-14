import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeL2Norm,
  normalizeL2,
  decodeFloat16,
  extractEdgeFaceEmbedding,
} from "./edgeface.ts";
import {
  dotProduct256,
  cosineDistance256,
  cosineDistance,
  distanceToMatchPercent,
  rankPercentsFromDistances,
  type CelebrityEmbedding,
} from "./embeddings.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";
import { OnnxSessionManager } from "./onnx-engine.ts";

describe("Milestone 3 Empirical Challenger Stress Suite", () => {
  describe("1. IEEE 754 Float16 Decoding Empirical Oracle", () => {
    it("decodes zero representations (+0.0 and -0.0)", () => {
      assert.equal(decodeFloat16(0x0000), 0.0);
      assert.equal(decodeFloat16(0x8000), -0.0);
      assert.equal(Object.is(decodeFloat16(0x8000), -0.0), true);
    });

    it("decodes exact values: 1.0, -1.0, 0.5, -0.5, 2.0, 65504 (max normal)", () => {
      assert.equal(decodeFloat16(0x3c00), 1.0);
      assert.equal(decodeFloat16(0xbc00), -1.0);
      assert.equal(decodeFloat16(0x3800), 0.5);
      assert.equal(decodeFloat16(0xb800), -0.5);
      assert.equal(decodeFloat16(0x4000), 2.0);
      assert.equal(decodeFloat16(0x7bff), 65504);
    });

    it("decodes subnormal float16 numbers correctly", () => {
      // Smallest positive subnormal: 2^-14 * (1/1024) = 2^-24 ≈ 5.9604644775390625e-8
      const minSubnormal = decodeFloat16(0x0001);
      const expectedMinSub = Math.pow(2, -14) * (1 / 1024);
      assert.ok(Math.abs(minSubnormal - expectedMinSub) < 1e-15);

      // Largest subnormal: 0x03ff -> 2^-14 * (1023/1024) ≈ 6.097555160522461e-5
      const maxSubnormal = decodeFloat16(0x03ff);
      const expectedMaxSub = Math.pow(2, -14) * (1023 / 1024);
      assert.ok(Math.abs(maxSubnormal - expectedMaxSub) < 1e-10);
    });

    it("decodes float16 Infinities and NaNs", () => {
      assert.equal(decodeFloat16(0x7c00), Infinity);
      assert.equal(decodeFloat16(0xfc00), -Infinity);
      assert.ok(Number.isNaN(decodeFloat16(0x7c01)));
      assert.ok(Number.isNaN(decodeFloat16(0x7e00)));
      assert.ok(Number.isNaN(decodeFloat16(0xffff)));
    });
  });

  describe("2. L2 Normalization & Vector Sanitation Oracle", () => {
    it("enforces ||normalizeL2(v)||_2 === 1.0 for 1,000 random 256-d vectors", () => {
      for (let trial = 0; trial < 1000; trial++) {
        const v = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          v[i] = (Math.random() - 0.5) * 100;
        }
        const normVec = normalizeL2(v);
        assert.equal(normVec.length, 256);
        const n = computeL2Norm(normVec);
        assert.ok(
          Math.abs(n - 1.0) < 1e-5,
          `Trial ${trial}: expected norm 1.0, got ${n}`
        );
      }
    });

    it("sanitizes vectors with sub-threshold norm (< 1e-12) to all-zero vectors", () => {
      const tinyVec = new Float32Array(256).fill(1e-14);
      const out = normalizeL2(tinyVec);
      assert.equal(out.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.equal(out[i], 0);
      }
      assert.equal(computeL2Norm(out), 0);
    });

    it("sanitizes vectors containing NaN, Infinity, or -Infinity gracefully", () => {
      const badVec = new Float32Array(256);
      for (let i = 0; i < 256; i++) badVec[i] = i + 1;
      badVec[10] = NaN;
      badVec[50] = Infinity;
      badVec[100] = -Infinity;

      const out = normalizeL2(badVec);
      assert.equal(out.length, 256);
      for (let i = 0; i < 256; i++) {
        assert.ok(
          Number.isFinite(out[i]),
          `Non-finite element found at index ${i}: ${out[i]}`
        );
      }
    });
  });

  describe("3. 8-Way Unrolled Dot Product & Cosine Distance Oracle", () => {
    it("empirically verifies dotProduct256 against naive loop across 10,000 random vector pairs", () => {
      for (let trial = 0; trial < 10000; trial++) {
        const a = new Float32Array(256);
        const b = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
          a[i] = (Math.random() - 0.5) * 2;
          b[i] = (Math.random() - 0.5) * 2;
        }

        // Naive loop reference oracle
        let refDot = 0;
        for (let i = 0; i < 256; i++) {
          refDot += a[i]! * b[i]!;
        }

        const unrolledDot = dotProduct256(a, b);
        const diff = Math.abs(refDot - unrolledDot);
        assert.ok(
          diff < 1e-5,
          `Trial ${trial}: naive=${refDot}, unrolled=${unrolledDot}, diff=${diff}`
        );
      }
    });

    it("computes cosineDistance256 accurately for boundary vector geometric relationships", () => {
      // 1. Identical unit vectors -> d = 0.0
      const unitA = normalizeL2(new Float32Array(256).fill(1));
      assert.ok(Math.abs(cosineDistance256(unitA, unitA) - 0.0) < 1e-6);

      // 2. Parallel non-unit vectors -> d = 0.0 (if normalized first)
      const unitB = normalizeL2(new Float32Array(256).fill(5));
      assert.ok(Math.abs(cosineDistance256(unitA, unitB) - 0.0) < 1e-6);

      // 3. Orthogonal unit vectors -> d = 1.0
      const orthA = new Float32Array(256).fill(0);
      const orthB = new Float32Array(256).fill(0);
      orthA[0] = 1.0;
      orthB[1] = 1.0;
      assert.equal(cosineDistance256(orthA, orthB), 1.0);

      // 4. Antipodal unit vectors -> d = 2.0
      const antiA = new Float32Array(256).fill(0);
      const antiB = new Float32Array(256).fill(0);
      antiA[0] = 1.0;
      antiB[0] = -1.0;
      assert.equal(cosineDistance256(antiA, antiB), 2.0);
    });

    it("guarantees cosineDistance256 result is strictly clamped to [0.0, 2.0]", () => {
      // Over-saturated input (dot product > 1.0 due to un-normalized vector or float overflow)
      const overA = new Float32Array(256).fill(2.0);
      const overB = new Float32Array(256).fill(2.0);
      const dOver = cosineDistance256(overA, overB);
      assert.ok(dOver >= 0.0 && dOver <= 2.0, `Expected clamped d, got ${dOver}`);

      // Negative dot product < -1.0
      const negA = new Float32Array(256).fill(2.0);
      const negB = new Float32Array(256).fill(-2.0);
      const dNeg = cosineDistance256(negA, negB);
      assert.ok(dNeg >= 0.0 && dNeg <= 2.0, `Expected clamped d, got ${dNeg}`);
    });
  });

  describe("4. Recalibrated Hill Curve Monotonicity & Boundary Oracle", () => {
    it("verifies Hill Curve match percentages at critical milestone checkpoints", () => {
      // P(d) = 100 / (1 + (d / 0.38)^4.5)
      assert.equal(distanceToMatchPercent(0.0), 100.0);
      assert.equal(distanceToMatchPercent(0.38), 50.0);
      assert.equal(distanceToMatchPercent(0.20), 94.7);
      assert.equal(distanceToMatchPercent(0.30), 74.3);
      assert.equal(distanceToMatchPercent(0.45), 31.8);
      assert.equal(distanceToMatchPercent(0.50), 22.5);
    });

    it("evaluates strict monotonic decay over 10,000 fine-grained distance steps in [0.0, 2.0]", () => {
      let prevPct = distanceToMatchPercent(0.0);
      const step = 2.0 / 10000;
      for (let i = 1; i <= 10000; i++) {
        const d = i * step;
        const currPct = distanceToMatchPercent(d);
        assert.ok(
          currPct <= prevPct,
          `Monotonicity violation at d=${d}: P(${d - step})=${prevPct} < P(${d})=${currPct}`
        );
        prevPct = currPct;
      }
    });

    it("robustly handles invalid/boundary input numbers", () => {
      assert.equal(distanceToMatchPercent(-10), 100.0);
      assert.equal(distanceToMatchPercent(NaN), 0.0);
      assert.equal(distanceToMatchPercent(Infinity), 0.0);
      assert.equal(distanceToMatchPercent(-Infinity), 100.0);
    });
  });

  describe("5. End-to-End Matcher Stress & Gallery Scale Test", () => {
    it("ranks a 256-d query against a 1,000 celebrity gallery under 15ms", () => {
      // Construct synthetic 1,000 celebrity catalog
      const gallery: CelebrityEmbedding[] = [];
      for (let i = 0; i < 1000; i++) {
        const vec = new Float32Array(256);
        vec[i % 256] = 1.0;
        gallery.push({
          id: `celeb-${i}`,
          name: `Celebrity ${i}`,
          path: `/celeb-${i}.webp`,
          descriptor: vec,
          age: 20 + (i % 60),
          gender: i % 2 === 0 ? "male" : "female",
          genderProb: 0.9,
        });
      }

      const queryVec = new Float32Array(256);
      queryVec[42] = 1.0; // Match celeb-42, celeb-298, celeb-554, celeb-810

      const query: UserFaceQuery = {
        descriptor: queryVec,
        age: 62,
        gender: "male",
        genderProbability: 0.9,
        detConfidence: 0.95,
        sharpness: 85,
        faceCoverage: 0.25,
      };

      const t0 = performance.now();
      const results = rankByDescriptor(query, gallery, 5);
      const elapsed = performance.now() - t0;

      assert.equal(results.length, 5);
      assert.ok(elapsed < 15, `Matching 1,000 celebs took ${elapsed.toFixed(2)}ms (expected < 15ms)`);

      // Verify rank 1 match
      const topMatch = results[0]!;
      assert.equal(topMatch.celebrityId, "celeb-42");
      assert.equal(topMatch.matchPercent, 100.0);
      assert.equal(topMatch.distance, 0.0);

      // Verify remaining matches have lower matchPercent and higher distance
      for (let i = 1; i < results.length; i++) {
        assert.ok(
          results[i]!.distance! >= results[i - 1]!.distance!,
          `Distance ranking order broken at index ${i}`
        );
        assert.ok(
          results[i]!.matchPercent <= results[i - 1]!.matchPercent,
          `Match percent ranking order broken at index ${i}`
        );
      }
    });
  });

  describe("6. EdgeFace ONNX Session Run & Output Parsing (Mocked Float32 & Float16)", () => {
    it("extracts 256-d Float32 embedding from mock ONNX session", async () => {
      const mockRawData = new Float32Array(256);
      for (let i = 0; i < 256; i++) mockRawData[i] = i + 1;

      const mockSession = {
        inputNames: ["input"],
        outputNames: ["embedding"],
        run: async () => ({
          embedding: {
            data: mockRawData,
            dims: [1, 256],
            type: "float32",
          },
        }),
      };

      const manager = OnnxSessionManager.getInstance();
      const origGetSession = manager.getSession.bind(manager);
      manager.getSession = async () => mockSession as any;

      try {
        const dummyInput = new Float32Array(1 * 3 * 112 * 112).fill(0.5);
        const res = await extractEdgeFaceEmbedding(dummyInput, undefined, { modelPath: "/models/edgeface_m.onnx" });

        assert.equal(res.embedding.length, 256);
        const norm = computeL2Norm(res.embedding);
        assert.ok(Math.abs(norm - 1.0) < 1e-5, `Expected norm 1.0, got ${norm}`);
        assert.ok(res.latencyMs >= 0);
      } finally {
        manager.getSession = origGetSession;
      }
    });

    it("extracts 256-d Float16 embedding (Uint16Array) from mock WebGPU ONNX session", async () => {
      // Mock Uint16Array with Float16 encoded 1.0 values (0x3c00)
      const mockFloat16Data = new Uint16Array(256).fill(0x3c00);

      const mockSession = {
        inputNames: ["input"],
        outputNames: ["embedding"],
        run: async () => ({
          embedding: {
            data: mockFloat16Data,
            dims: [1, 256],
            type: "float16",
          },
        }),
      };

      const manager = OnnxSessionManager.getInstance();
      const origGetSession = manager.getSession.bind(manager);
      manager.getSession = async () => mockSession as any;

      try {
        const dummyInput = new Float32Array(1 * 3 * 112 * 112).fill(0.5);
        const res = await extractEdgeFaceEmbedding(dummyInput, undefined, { modelPath: "/models/edgeface_m.onnx" });

        assert.equal(res.embedding.length, 256);
        // Since all 256 elements are 1.0, normalized vector elements should each be 1 / sqrt(256) = 1/16 = 0.0625
        assert.ok(Math.abs(res.embedding[0]! - 0.0625) < 1e-5);
        const norm = computeL2Norm(res.embedding);
        assert.ok(Math.abs(norm - 1.0) < 1e-5, `Expected norm 1.0, got ${norm}`);
      } finally {
        manager.getSession = origGetSession;
      }
    });
  });
});
