import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hudBoxFromScrfd,
  hudLandmarksFromScrfd,
  toHudPercent,
  unpadScrfdDetections,
  detectionFromAccuFace,
} from "./accuface-detection.ts";
import type { SCRFDDetectionResult } from "./types.ts";

function fakeDetection(overrides: Partial<SCRFDDetectionResult> = {}): SCRFDDetectionResult {
  return {
    bbox: { x: 40, y: 50, width: 80, height: 100 },
    normalizedBox: { x: 0.1, y: 0.125, width: 0.2, height: 0.25 },
    score: 0.9,
    confidence: 0.9,
    landmarks: Float32Array.from([50, 70, 90, 70, 70, 95, 55, 120, 85, 120]),
    normalizedLandmarks: [
      { x: 0.125, y: 0.175 },
      { x: 0.225, y: 0.175 },
      { x: 0.175, y: 0.2375 },
      { x: 0.1375, y: 0.3 },
      { x: 0.2125, y: 0.3 },
    ],
    pose: { yaw: 4, pitch: -2, roll: 1 },
    smile: { smileRatio: 0.8, commissureElevation: 1, smileIntensity: 0.4 },
    ...overrides,
  };
}

describe("accuface detection HUD mapping", () => {
  it("scales unit SCRFD coords into HUD percents", () => {
    assert.equal(toHudPercent(0), 0);
    assert.equal(toHudPercent(0.5), 50);
    assert.equal(toHudPercent(1), 100);
    assert.equal(toHudPercent(48), 48);
  });

  it("converts SCRFD boxes and 5-pt landmarks to HUD percents", () => {
    const box = hudBoxFromScrfd({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    assert.deepEqual(box, { x: 10, y: 20, width: 30, height: 40 });
    const pts = hudLandmarksFromScrfd([{ x: 0.25, y: 0.5 }]);
    assert.deepEqual(pts, [{ x: 25, y: 50 }]);
  });

  it("unpads padded-canvas detections back onto the original crop", () => {
    const padded = fakeDetection({
      bbox: { x: 140, y: 150, width: 80, height: 100 },
      normalizedBox: { x: 140 / 600, y: 150 / 600, width: 80 / 600, height: 100 / 600 },
      landmarks: Float32Array.from([150, 170, 190, 170, 170, 195, 155, 220, 185, 220]),
    });
    const [unpadded] = unpadScrfdDetections([padded], 100, 400, 400);
    assert.ok(unpadded);
    assert.equal(unpadded.bbox.x, 40);
    assert.equal(unpadded.bbox.y, 50);
    assert.equal(unpadded.landmarks[0], 50);
    assert.equal(unpadded.landmarks[1], 70);
  });

  it("builds a FaceAPI-shaped result without calling FaceAPI", () => {
    const primary = fakeDetection();
    const source = { width: 400, height: 400 } as HTMLCanvasElement;
    const det = detectionFromAccuFace({
      source,
      embedding: new Float32Array(512).fill(0.01),
      detections: [primary],
      primary,
      latencies: {
        modelLoadMs: 0,
        downscaleMs: 0,
        scrfdPassMs: 12,
        frontalizationMs: 3,
        embeddingMs: 20,
        biohashMs: 1,
        totalMs: 40,
      },
      frontalizationMethod: "5pt-similarity",
    });
    assert.equal(det.gender, "unknown");
    assert.equal(Number.isFinite(det.age), false);
    assert.equal(det.descriptor.length, 512);
    assert.equal(det.normalizedBox?.x, 10);
    assert.equal(det.normalizedLandmarks?.length, 5);
    assert.equal(det.candidateBoxes?.[0]?.isPrimary, true);
    assert.equal(det.telemetry?.frontalizationMethod, "5pt-similarity");
  });
});
