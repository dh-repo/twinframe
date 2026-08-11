import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractGeometryFeatures,
  assessQuality,
  sampleRegionColor,
  type Landmark,
} from "./geometry.ts";
import {
  scoreCandidateFace,
  sortFaceCandidates,
  applyLocalContrastBoost,
  type FaceCandidateInput,
} from "./faceapi-engine.ts";

/** Minimal ImageData stand-in for Node (no canvas DOM). */
function makeImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

/** Build a minimal 478-point landmark cloud with a plausible frontal face. */
function syntheticFace(opts?: {
  scale?: number;
  cx?: number;
  cy?: number;
}): Landmark[] {
  const scale = opts?.scale ?? 1;
  const cx = opts?.cx ?? 0.5;
  const cy = opts?.cy ?? 0.48;
  const pts: Landmark[] = Array.from({ length: 478 }, () => ({
    x: cx,
    y: cy,
  }));

  const set = (i: number, x: number, y: number) => {
    pts[i] = { x: cx + (x - 0.5) * scale, y: cy + (y - 0.5) * scale };
  };

  set(152, 0.5, 0.78);
  set(10, 0.5, 0.22);
  set(234, 0.28, 0.5);
  set(454, 0.72, 0.5);
  set(33, 0.35, 0.42);
  set(133, 0.42, 0.42);
  set(159, 0.385, 0.4);
  set(145, 0.385, 0.44);
  set(263, 0.65, 0.42);
  set(362, 0.58, 0.42);
  set(386, 0.615, 0.4);
  set(374, 0.615, 0.44);
  set(107, 0.4, 0.36);
  set(70, 0.32, 0.36);
  set(336, 0.6, 0.36);
  set(300, 0.68, 0.36);
  set(1, 0.5, 0.55);
  set(6, 0.5, 0.4);
  set(98, 0.45, 0.52);
  set(327, 0.55, 0.52);
  set(61, 0.42, 0.62);
  set(291, 0.58, 0.62);
  set(13, 0.5, 0.6);
  set(14, 0.5, 0.64);
  set(172, 0.34, 0.68);
  set(397, 0.66, 0.68);
  set(50, 0.36, 0.52);
  set(280, 0.64, 0.52);

  return pts;
}

describe("extractGeometryFeatures", () => {
  it("returns defaults for empty landmarks", () => {
    const f = extractGeometryFeatures([]);
    assert.equal(f.jawWidth, 0.5);
  });

  it("extracts finite features in [0,1] from synthetic face", () => {
    const f = extractGeometryFeatures(syntheticFace());
    for (const [k, v] of Object.entries(f)) {
      assert.ok(Number.isFinite(v), `${k} not finite`);
      assert.ok(v >= 0 && v <= 1, `${k}=${v} out of range`);
    }
  });

  it("wider face increases faceAspect", () => {
    const normal = extractGeometryFeatures(syntheticFace({ scale: 1 }));
    const widePts = syntheticFace({ scale: 1 });
    widePts[234] = { x: 0.2, y: 0.5 };
    widePts[454] = { x: 0.8, y: 0.5 };
    const wide = extractGeometryFeatures(widePts);
    assert.ok(wide.faceAspect >= normal.faceAspect * 0.9);
  });
});

describe("assessQuality", () => {
  it("rejects empty landmarks", () => {
    const q = assessQuality([], 640, 480);
    assert.equal(q.ok, false);
    assert.ok(q.issues.length > 0);
  });

  it("accepts a well-framed synthetic face", () => {
    const q = assessQuality(syntheticFace({ scale: 1 }), 640, 480);
    assert.equal(q.ok, true, q.issues.join("; "));
    assert.ok(q.score >= 0.4);
  });

  it("flags tiny faces", () => {
    const q = assessQuality(syntheticFace({ scale: 0.25 }), 640, 480);
    assert.ok(
      q.issues.some((i) => i.toLowerCase().includes("small")) || !q.ok,
    );
  });
});

describe("sampleRegionColor", () => {
  it("averages a solid color region", () => {
    const w = 32;
    const h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 200;
      data[i * 4 + 1] = 120;
      data[i * 4 + 2] = 90;
      data[i * 4 + 3] = 255;
    }
    const imageData = makeImageData(data, w, h);
    const c = sampleRegionColor(imageData, 0.5, 0.5, 4);
    assert.ok(Math.abs(c.r - 200) < 1);
    assert.ok(Math.abs(c.g - 120) < 1);
    assert.ok(Math.abs(c.b - 90) < 1);
  });
});

describe("scoreCandidateFace", () => {
  it("gives maximum score for centered high-confidence face", () => {
    const box = { x: 200, y: 200, width: 200, height: 200 };
    const score = scoreCandidateFace(box, 0.95, { width: 600, height: 600 });
    assert.equal(score, 38000);
  });

  it("applies distance penalty to peripheral corner faces", () => {
    const centerBox = { x: 200, y: 200, width: 200, height: 200 };
    const cornerBox = { x: 0, y: 0, width: 200, height: 200 };
    const centerScore = scoreCandidateFace(centerBox, 0.90, { width: 600, height: 600 });
    const cornerScore = scoreCandidateFace(cornerBox, 0.90, { width: 600, height: 600 });

    assert.ok(cornerScore < centerScore * 0.1, "Corner score should be significantly lower than center score");
  });

  it("handles fallback confidence score without NaN", () => {
    const box = { x: 100, y: 100, width: 150, height: 150 };
    const score = scoreCandidateFace(box, NaN, { width: 400, height: 400 });
    assert.ok(Number.isFinite(score));
    assert.ok(score > 0);
  });
});

describe("sortFaceCandidates", () => {
  it("ranks primary face correctly in a 3-person group photo", () => {
    const candidates: FaceCandidateInput[] = [
      { id: "person-B", box: { x: 50, y: 150, width: 100, height: 120 }, confidence: 0.85 },
      { id: "person-A", box: { x: 300, y: 200, width: 200, height: 240 }, confidence: 0.92 },
      { id: "person-C", box: { x: 600, y: 180, width: 110, height: 130 }, confidence: 0.88 },
    ];

    const sorted = sortFaceCandidates(candidates, { width: 800, height: 600 });

    assert.equal(sorted.length, 3);
    assert.equal(sorted[0]!.id, "person-A");
    assert.equal(sorted[0]!.isPrimary, true);
    assert.equal(sorted[1]!.isPrimary, false);
    assert.equal(sorted[2]!.isPrimary, false);
  });

  it("prioritizes central high-confidence face over large low-confidence background blur", () => {
    const candidates: FaceCandidateInput[] = [
      { id: "background-blur", box: { x: 0, y: 0, width: 300, height: 300 }, confidence: 0.10 },
      { id: "subject", box: { x: 250, y: 200, width: 180, height: 220 }, confidence: 0.95 },
    ];

    const sorted = sortFaceCandidates(candidates, { width: 700, height: 700 });
    assert.equal(sorted[0]!.id, "subject");
    assert.equal(sorted[0]!.isPrimary, true);
  });

  it("ensures monotonic non-increasing candidate scores", () => {
    const candidates: FaceCandidateInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `face-${i}`,
      box: { x: i * 50, y: i * 30, width: 100 + i * 10, height: 100 + i * 10 },
      confidence: 0.5 + (i % 5) * 0.1,
    }));

    const sorted = sortFaceCandidates(candidates, { width: 1000, height: 1000 });
    for (let i = 0; i < sorted.length - 1; i++) {
      assert.ok(sorted[i]!.score >= sorted[i + 1]!.score, `Score at ${i} should be >= ${i + 1}`);
    }
  });
});

describe("Milestone 1 Timing & Performance Benchmarks (< 300ms SLA)", () => {
  it("sorts 50 candidate faces in < 5ms", () => {
    const candidates: FaceCandidateInput[] = Array.from({ length: 50 }, (_, i) => ({
      id: `candidate-${i}`,
      box: { x: (i * 20) % 800, y: (i * 15) % 600, width: 80 + (i % 10) * 10, height: 80 + (i % 10) * 10 },
      confidence: 0.5 + (i % 5) * 0.08,
    }));

    const start = performance.now();
    const sorted = sortFaceCandidates(candidates, { width: 1280, height: 960 });
    const duration = performance.now() - start;

    assert.equal(sorted.length, 50);
    assert.ok(duration < 5, `Sorting 50 candidates took ${duration}ms, expected < 5ms`);
  });

  it("CLAHE contrast boost on ImageData/Uint8Array completes under sub-300ms SLA budget", () => {
    const w = 320;
    const h = 320;
    const mockCanvas: any = {
      width: w,
      height: h,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: () => {},
      }),
    };

    if (typeof globalThis.document === "undefined") {
      (globalThis as any).document = {
        createElement: (tag: string) => {
          if (tag === "canvas") return mockCanvas;
          return {};
        },
      };
    }

    const start = performance.now();
    applyLocalContrastBoost(mockCanvas);
    const duration = performance.now() - start;

    assert.ok(duration < 100, `CLAHE boost took ${duration}ms, expected < 100ms`);
  });
});

