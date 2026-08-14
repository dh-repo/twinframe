import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractGeometryFeatures,
  extractGeometryFeatures68,
  extractAnatomicalFeatures,
  extractAnatomicalFeatures68,
  CANONICAL_ANATOMICAL_DEFAULTS,
  type Landmark,
} from "./geometry.ts";
import { CANONICAL_FACE_3D } from "./pose.ts";
import type { FaceFeatures, ExtendedAnatomicalFeatures } from "./types.ts";

/** Helper to construct a synthetic 478-point MediaPipe landmark cloud. */
function createSynthetic478(scale = 1.0, cx = 0.5, cy = 0.48): Landmark[] {
  const pts: Landmark[] = Array.from({ length: 478 }, () => ({
    x: cx,
    y: cy,
    z: 0,
  }));

  const set = (i: number, x: number, y: number, z = 0) => {
    pts[i] = {
      x: cx + (x - 0.5) * scale,
      y: cy + (y - 0.5) * scale,
      z: z * scale,
    };
  };

  set(152, 0.5, 0.78, 0.02);  // chin
  set(10, 0.5, 0.22, -0.01);  // forehead
  set(234, 0.28, 0.5, 0.05);  // left cheek
  set(454, 0.72, 0.5, 0.05);  // right cheek
  set(33, 0.35, 0.42, 0.01);  // left eye outer
  set(133, 0.42, 0.42, 0.01); // left eye inner
  set(159, 0.385, 0.4, 0.01);
  set(145, 0.385, 0.44, 0.01);
  set(263, 0.65, 0.42, 0.01); // right eye outer
  set(362, 0.58, 0.42, 0.01); // right eye inner
  set(386, 0.615, 0.4, 0.01);
  set(374, 0.615, 0.44, 0.01);
  set(107, 0.4, 0.36, 0.0);   // left brow inner
  set(70, 0.32, 0.35, 0.0);   // left brow outer
  set(336, 0.6, 0.36, 0.0);   // right brow inner
  set(300, 0.68, 0.35, 0.0);  // right brow outer
  set(1, 0.5, 0.5, -0.05);    // nose tip
  set(6, 0.5, 0.42, -0.02);   // nose bridge
  set(98, 0.45, 0.52, -0.02);  // nose left
  set(327, 0.55, 0.52, -0.02); // nose right
  set(61, 0.42, 0.62, -0.01);  // mouth left
  set(291, 0.58, 0.62, -0.01); // mouth right
  set(13, 0.5, 0.60, -0.01);  // upper lip
  set(14, 0.5, 0.64, -0.01);  // lower lip
  set(172, 0.32, 0.68, 0.03); // jaw left
  set(397, 0.68, 0.68, 0.03); // jaw right
  set(50, 0.30, 0.52, 0.04);  // left cheekbone
  set(280, 0.70, 0.52, 0.04); // right cheekbone
  set(2, 0.5, 0.56, -0.01);   // subnasale
  set(164, 0.5, 0.58, -0.01); // philtrum groove
  set(37, 0.48, 0.58, -0.005);
  set(267, 0.52, 0.58, -0.005);

  return pts;
}

/** Assert that an ExtendedAnatomicalFeatures object contains zero NaN or Infinity values. */
function assertNoNaNsInAnatomical(anat: ExtendedAnatomicalFeatures, label: string) {
  assert.ok(anat, `${label}: anatomical is null/undefined`);
  assert.ok(Number.isFinite(anat.upperThirdRatio), `${label}: upperThirdRatio=${anat.upperThirdRatio}`);
  assert.ok(Number.isFinite(anat.middleThirdRatio), `${label}: middleThirdRatio=${anat.middleThirdRatio}`);
  assert.ok(Number.isFinite(anat.lowerThirdRatio), `${label}: lowerThirdRatio=${anat.lowerThirdRatio}`);

  assert.ok(Array.isArray(anat.lateralFifthsRatios), `${label}: lateralFifthsRatios is not array`);
  assert.equal(anat.lateralFifthsRatios.length, 5, `${label}: lateralFifthsRatios length != 5`);
  anat.lateralFifthsRatios.forEach((val, i) => {
    assert.ok(Number.isFinite(val), `${label}: lateralFifthsRatios[${i}]=${val}`);
  });

  assert.ok(Number.isFinite(anat.interCanthalDistance), `${label}: interCanthalDistance=${anat.interCanthalDistance}`);
  assert.ok(Number.isFinite(anat.canthalTiltAngleDeg), `${label}: canthalTiltAngleDeg=${anat.canthalTiltAngleDeg}`);
  assert.ok(Number.isFinite(anat.nasalIndex), `${label}: nasalIndex=${anat.nasalIndex}`);
  assert.ok(Number.isFinite(anat.bigonialToBizygomaticRatio), `${label}: bigonialToBizygomaticRatio=${anat.bigonialToBizygomaticRatio}`);
  assert.ok(Number.isFinite(anat.gonialJawlineAngleDeg), `${label}: gonialJawlineAngleDeg=${anat.gonialJawlineAngleDeg}`);
  assert.ok(Number.isFinite(anat.lipVermilionHeightRatio), `${label}: lipVermilionHeightRatio=${anat.lipVermilionHeightRatio}`);
  assert.ok(Number.isFinite(anat.philtrumDepth), `${label}: philtrumDepth=${anat.philtrumDepth}`);
}

/** Assert that a FaceFeatures object contains zero NaN or Infinity values across all fields. */
function assertNoNaNsInFaceFeatures(f: FaceFeatures, label: string) {
  assert.ok(f, `${label}: FaceFeatures is null/undefined`);
  const numericKeys: (keyof Omit<FaceFeatures, "anatomical">)[] = [
    "faceAspect", "jawWidth", "chinSharpness", "foreheadHeight",
    "eyeSpacing", "eyeOpenness", "eyeSlant", "browHeight",
    "noseLength", "noseWidth", "mouthWidth", "lipFullness",
    "cheekboneProminence", "faceRoundness",
    "skinL", "skinA", "skinB", "hairL", "hairA", "hairB",
    "masculine", "feminine", "youthfulness",
  ];

  for (const k of numericKeys) {
    const val = f[k];
    assert.ok(Number.isFinite(val), `${label}: FaceFeatures.${k}=${val}`);
  }

  if (f.anatomical) {
    assertNoNaNsInAnatomical(f.anatomical, label);
  }
}

describe("Challenger 2 Empirical Harness (M2 Latency & Pathological Safety)", () => {
  describe("1. Execution Latency Benchmark (10,000 Iterations)", () => {
    it("benchmarks 10,000 iterations of extractGeometryFeatures (478 pts) with < 15ms per-frame latency (target < 1ms)", () => {
      const landmarks478 = createSynthetic478();
      const iterations = 10000;

      // Warmup pass
      for (let i = 0; i < 100; i++) {
        extractGeometryFeatures(landmarks478);
      }

      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        extractGeometryFeatures(landmarks478);
      }
      const totalMs = performance.now() - t0;
      const perFrameMs = totalMs / iterations;

      console.log(`[PERF] extractGeometryFeatures (478 pts): ${totalMs.toFixed(2)}ms total for ${iterations} iterations (${perFrameMs.toFixed(4)}ms/frame)`);

      assert.ok(perFrameMs < 15.0, `Per-frame latency ${perFrameMs.toFixed(4)}ms exceeds 15.0ms SLA`);
      assert.ok(perFrameMs < 1.0, `Per-frame latency ${perFrameMs.toFixed(4)}ms exceeds 1.0ms target`);
    });

    it("benchmarks 10,000 iterations of extractGeometryFeatures68 (68 pts) with < 15ms per-frame latency (target < 1ms)", () => {
      const landmarks68 = CANONICAL_FACE_3D;
      const iterations = 10000;

      // Warmup pass
      for (let i = 0; i < 100; i++) {
        extractGeometryFeatures68(landmarks68);
      }

      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        extractGeometryFeatures68(landmarks68);
      }
      const totalMs = performance.now() - t0;
      const perFrameMs = totalMs / iterations;

      console.log(`[PERF] extractGeometryFeatures68 (68 pts): ${totalMs.toFixed(2)}ms total for ${iterations} iterations (${perFrameMs.toFixed(4)}ms/frame)`);

      assert.ok(perFrameMs < 15.0, `Per-frame latency ${perFrameMs.toFixed(4)}ms exceeds 15.0ms SLA`);
      assert.ok(perFrameMs < 1.0, `Per-frame latency ${perFrameMs.toFixed(4)}ms exceeds 1.0ms target`);
    });

    it("benchmarks 10,000 iterations of extractAnatomicalFeatures directly with < 15ms per-frame latency", () => {
      const landmarks478 = createSynthetic478();
      const iterations = 10000;

      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        const anat = extractAnatomicalFeatures(landmarks478);
        assertNoNaNsInAnatomical(anat, `iter ${i}`);
      }
      const totalMs = performance.now() - t0;
      const perFrameMs = totalMs / iterations;

      console.log(`[PERF] extractAnatomicalFeatures (478 pts): ${totalMs.toFixed(2)}ms total for ${iterations} iterations (${perFrameMs.toFixed(4)}ms/frame)`);

      assert.ok(perFrameMs < 15.0, `Per-frame latency ${perFrameMs.toFixed(4)}ms exceeds 15.0ms SLA`);
    });

    it("benchmarks 10,000 iterations of extractAnatomicalFeatures68 directly with < 15ms per-frame latency", () => {
      const landmarks68 = CANONICAL_FACE_3D;
      const iterations = 10000;

      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        const anat = extractAnatomicalFeatures68(landmarks68);
        assertNoNaNsInAnatomical(anat, `iter ${i}`);
      }
      const totalMs = performance.now() - t0;
      const perFrameMs = totalMs / iterations;

      console.log(`[PERF] extractAnatomicalFeatures68 (68 pts): ${totalMs.toFixed(2)}ms total for ${iterations} iterations (${perFrameMs.toFixed(4)}ms/frame)`);

      assert.ok(perFrameMs < 15.0, `Per-frame latency ${perFrameMs.toFixed(4)}ms exceeds 15.0ms SLA`);
    });
  });

  describe("2. Pathological Input Safety & Zero NaN Leaks", () => {
    it("handles empty landmark arrays [] without exceptions or NaN leaks", () => {
      const emptyArray: Landmark[] = [];

      assert.doesNotThrow(() => {
        const f = extractGeometryFeatures(emptyArray);
        assertNoNaNsInFaceFeatures(f, "extractGeometryFeatures([])");
      });

      assert.doesNotThrow(() => {
        const f68 = extractGeometryFeatures68(emptyArray);
        assertNoNaNsInFaceFeatures(f68, "extractGeometryFeatures68([])");
      });

      assert.doesNotThrow(() => {
        const anat = extractAnatomicalFeatures(emptyArray);
        assertNoNaNsInAnatomical(anat, "extractAnatomicalFeatures([])");
      });

      assert.doesNotThrow(() => {
        const anat68 = extractAnatomicalFeatures68(emptyArray);
        assertNoNaNsInAnatomical(anat68, "extractAnatomicalFeatures68([])");
      });
    });

    it("handles underconstrained/missing landmarks (partial array length) without exceptions or NaN leaks", () => {
      const partial1 = Array.from({ length: 5 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
      const partial67 = CANONICAL_FACE_3D.slice(0, 67);
      const partial399 = createSynthetic478().slice(0, 399);

      assert.doesNotThrow(() => {
        const f = extractGeometryFeatures(partial399);
        assertNoNaNsInFaceFeatures(f, "partial399 MediaPipe");
      });

      assert.doesNotThrow(() => {
        const f68 = extractGeometryFeatures68(partial67);
        assertNoNaNsInFaceFeatures(f68, "partial67 dlib");
      });

      assert.doesNotThrow(() => {
        const anat = extractAnatomicalFeatures(partial1);
        assertNoNaNsInAnatomical(anat, "partial1");
      });

      assert.doesNotThrow(() => {
        const anat68 = extractAnatomicalFeatures68(partial67);
        assertNoNaNsInAnatomical(anat68, "partial67");
      });
    });

    it("handles all-zero coordinates without exceptions or NaN leaks", () => {
      const zeros68 = Array.from({ length: 68 }, () => ({ x: 0, y: 0, z: 0 }));
      const zeros478 = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));

      assert.doesNotThrow(() => {
        const f = extractGeometryFeatures(zeros478);
        assertNoNaNsInFaceFeatures(f, "zeros478");
      });

      assert.doesNotThrow(() => {
        const f68 = extractGeometryFeatures68(zeros68);
        assertNoNaNsInFaceFeatures(f68, "zeros68");
      });

      assert.doesNotThrow(() => {
        const anat = extractAnatomicalFeatures(zeros478);
        assertNoNaNsInAnatomical(anat, "zeros478 anat");
      });

      assert.doesNotThrow(() => {
        const anat68 = extractAnatomicalFeatures68(zeros68);
        assertNoNaNsInAnatomical(anat68, "zeros68 anat");
      });
    });

    it("handles NaN / Infinity / -Infinity coordinates without exceptions or NaN leaks", () => {
      const nanInfs68 = Array.from({ length: 68 }, (_, i) => {
        if (i % 3 === 0) return { x: NaN, y: Infinity, z: -Infinity };
        if (i % 3 === 1) return { x: Infinity, y: NaN, z: 0 };
        return { x: 0.5, y: -Infinity, z: NaN };
      });

      const nanInfs478 = Array.from({ length: 478 }, (_, i) => {
        if (i % 3 === 0) return { x: NaN, y: Infinity, z: -Infinity };
        if (i % 3 === 1) return { x: Infinity, y: NaN, z: 0 };
        return { x: 0.5, y: -Infinity, z: NaN };
      });

      assert.doesNotThrow(() => {
        const f = extractGeometryFeatures(nanInfs478);
        assertNoNaNsInFaceFeatures(f, "nanInfs478");
      });

      assert.doesNotThrow(() => {
        const f68 = extractGeometryFeatures68(nanInfs68);
        assertNoNaNsInFaceFeatures(f68, "nanInfs68");
      });

      assert.doesNotThrow(() => {
        const anat = extractAnatomicalFeatures(nanInfs478);
        assertNoNaNsInAnatomical(anat, "nanInfs478 anat");
      });

      assert.doesNotThrow(() => {
        const anat68 = extractAnatomicalFeatures68(nanInfs68);
        assertNoNaNsInAnatomical(anat68, "nanInfs68 anat");
      });
    });

    it("handles degenerate geometry (all points coincident / zero bounding box) without exceptions or NaN leaks", () => {
      const coincident68 = Array.from({ length: 68 }, () => ({ x: 0.5, y: 0.5, z: 0.5 }));
      const coincident478 = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0.5 }));

      assert.doesNotThrow(() => {
        const f = extractGeometryFeatures(coincident478);
        assertNoNaNsInFaceFeatures(f, "coincident478");
      });

      assert.doesNotThrow(() => {
        const f68 = extractGeometryFeatures68(coincident68);
        assertNoNaNsInFaceFeatures(f68, "coincident68");
      });

      assert.doesNotThrow(() => {
        const anat = extractAnatomicalFeatures(coincident478);
        assertNoNaNsInAnatomical(anat, "coincident478 anat");
      });

      assert.doesNotThrow(() => {
        const anat68 = extractAnatomicalFeatures68(coincident68);
        assertNoNaNsInAnatomical(anat68, "coincident68 anat");
      });
    });

    it("handles degenerate collinear geometry (all points along a single line) without exceptions or NaN leaks", () => {
      const collinear68 = Array.from({ length: 68 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.5, z: 0 }));
      const collinear478 = Array.from({ length: 478 }, (_, i) => ({ x: 0.1 + i * 0.001, y: 0.5, z: 0 }));

      assert.doesNotThrow(() => {
        const f = extractGeometryFeatures(collinear478);
        assertNoNaNsInFaceFeatures(f, "collinear478");
      });

      assert.doesNotThrow(() => {
        const f68 = extractGeometryFeatures68(collinear68);
        assertNoNaNsInFaceFeatures(f68, "collinear68");
      });
    });

    it("handles null / undefined elements inside landmark arrays without exceptions or NaN leaks", () => {
      const corruptedArr: any[] = CANONICAL_FACE_3D.map((p, i) => {
        if (i === 0) return null;
        if (i === 1) return undefined;
        if (i === 2) return { x: NaN, y: 0.5 };
        if (i === 3) return { x: 0.5, y: Infinity };
        return p;
      });

      assert.doesNotThrow(() => {
        const f68 = extractGeometryFeatures68(corruptedArr);
        assertNoNaNsInFaceFeatures(f68, "corruptedArr68");
      });

      assert.doesNotThrow(() => {
        const anat68 = extractAnatomicalFeatures68(corruptedArr);
        assertNoNaNsInAnatomical(anat68, "corruptedArr68 anat");
      });
    });

    it("handles extreme scale and floating point values (MAX_VALUE, 1e300, 1e-300) without exceptions or NaN leaks", () => {
      const extreme68 = Array.from({ length: 68 }, (_, i) => ({
        x: i % 2 === 0 ? Number.MAX_VALUE : -Number.MAX_VALUE,
        y: i % 3 === 0 ? 1e300 : -1e300,
        z: i % 5 === 0 ? 1e-300 : 0,
      }));

      assert.doesNotThrow(() => {
        const f68 = extractGeometryFeatures68(extreme68);
        assertNoNaNsInFaceFeatures(f68, "extreme68");
      });

      assert.doesNotThrow(() => {
        const anat68 = extractAnatomicalFeatures68(extreme68);
        assertNoNaNsInAnatomical(anat68, "extreme68 anat");
      });
    });
  });
});
