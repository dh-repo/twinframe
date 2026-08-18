import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeCentroidEmbedding } from "./gallery-dedupe.ts";
import { normalizeL2 } from "./edgeface.ts";
import {
  BURST_CAPTURE_COUNT,
  BURST_KEEP_MAX,
  BURST_KEEP_MIN,
  averageQueryEmbeddings,
  burstKeepCount,
  rankBurstCandidates,
  scoreBurstCandidate,
  scoreBurstImageData,
} from "./query-burst.ts";

function imageDataFromPattern(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

describe("query burst ranking", () => {
  it("exports a 10-frame capture / keep 3–5 contract", () => {
    assert.equal(BURST_CAPTURE_COUNT, 10);
    assert.equal(BURST_KEEP_MIN, 3);
    assert.equal(BURST_KEEP_MAX, 5);
    assert.equal(burstKeepCount(10), 5);
    assert.equal(burstKeepCount(4), 4);
    assert.equal(burstKeepCount(2), 2);
    assert.equal(burstKeepCount(0), 0);
  });

  it("ranks higher sharpness ahead of a blurrier frame at equal coverage", () => {
    const ranked = rankBurstCandidates([
      { id: "soft", sharpness: 0.22, coverage: 0.8 },
      { id: "crisp", sharpness: 0.91, coverage: 0.8 },
      { id: "mid", sharpness: 0.55, coverage: 0.8 },
    ]);
    assert.deepEqual(
      ranked.map((r) => r.id),
      ["crisp", "mid", "soft"],
    );
  });

  it("uses coverage to break a sharpness tie", () => {
    const ranked = rankBurstCandidates([
      { id: "tight", sharpness: 0.6, coverage: 0.25 },
      { id: "filled", sharpness: 0.6, coverage: 0.92 },
    ]);
    assert.equal(ranked[0]?.id, "filled");
    assert.ok(
      scoreBurstCandidate({ sharpness: 0.6, coverage: 0.92 }) >
        scoreBurstCandidate({ sharpness: 0.6, coverage: 0.25 }),
    );
  });

  it("keeps the top 5 of 10 scored frames", () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({
      id: `f${i}`,
      sharpness: i / 10,
      coverage: 0.5,
    }));
    const ranked = rankBurstCandidates(frames, { keep: burstKeepCount(frames.length) });
    assert.equal(ranked.length, 5);
    assert.equal(ranked[0]?.id, "f9");
    assert.equal(ranked[4]?.id, "f5");
  });

  it("scores a checkerboard sharper than a flat wash via Laplacian quality", () => {
    const sharp = imageDataFromPattern(64, 64, (x, y) =>
      (x + y) % 2 === 0 ? [255, 255, 255] : [0, 0, 0],
    );
    const blurry = imageDataFromPattern(64, 64, () => [128, 128, 128]);
    const sharpScore = scoreBurstImageData(sharp);
    const blurryScore = scoreBurstImageData(blurry);
    assert.ok(
      sharpScore.sharpness > blurryScore.sharpness,
      `expected checkerboard ${sharpScore.sharpness} > wash ${blurryScore.sharpness}`,
    );
    const ranked = rankBurstCandidates([
      { id: "wash", ...blurryScore },
      { id: "check", ...sharpScore },
    ]);
    assert.equal(ranked[0]?.id, "check");
  });
});

describe("query burst centroid", () => {
  it("L2-averages two identical unit vectors to the same vector", () => {
    const v = normalizeL2(new Float32Array([0.3, -0.8, 0.4, 0.2]));
    const centroid = averageQueryEmbeddings([v, v]);
    assert.equal(centroid.length, v.length);
    for (let i = 0; i < v.length; i++) {
      assert.ok(
        Math.abs((centroid[i] ?? 0) - (v[i] ?? 0)) < 1e-6,
        `dim ${i}: ${centroid[i]} vs ${v[i]}`,
      );
    }
    const viaDedupe = computeCentroidEmbedding([v, v]);
    for (let i = 0; i < v.length; i++) {
      assert.ok(Math.abs((viaDedupe[i] ?? 0) - (centroid[i] ?? 0)) < 1e-6);
    }
  });
});
