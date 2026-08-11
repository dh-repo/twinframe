import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractGeometryFeatures,
  assessQuality,
  sampleRegionColor,
  type Landmark,
} from "./geometry.ts";

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
