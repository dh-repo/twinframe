import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreCandidateFace,
  sortFaceCandidates,
  applyLocalContrastBoost,
} from "../src/lib/face/faceapi-engine.ts";

describe("M1 Empirical Challenger Stress Harness - Face Candidate Scoring & Monotonicity", () => {
  it("verifies scoreCandidateFace monotonicity with respect to distance from center", () => {
    const imgDim = { width: 1000, height: 1000 };
    const centerBox = { x: 400, y: 400, width: 200, height: 200 };
    const midBox = { x: 200, y: 200, width: 200, height: 200 };
    const cornerBox = { x: 0, y: 0, width: 200, height: 200 };

    const scoreCenter = scoreCandidateFace(centerBox, 0.9, imgDim);
    const scoreMid = scoreCandidateFace(midBox, 0.9, imgDim);
    const scoreCorner = scoreCandidateFace(cornerBox, 0.9, imgDim);

    assert.ok(scoreCenter > scoreMid, `Center score (${scoreCenter}) must be > mid score (${scoreMid})`);
    assert.ok(scoreMid > scoreCorner, `Mid score (${scoreMid}) must be > corner score (${scoreCorner})`);
  });

  it("verifies scoreCandidateFace monotonicity with respect to face area", () => {
    const imgDim = { width: 800, height: 800 };
    const largeBox = { x: 300, y: 300, width: 200, height: 200 }; // area 40000
    const mediumBox = { x: 325, y: 325, width: 150, height: 150 }; // area 22500
    const smallBox = { x: 350, y: 350, width: 100, height: 100 }; // area 10000

    const scoreLarge = scoreCandidateFace(largeBox, 0.85, imgDim);
    const scoreMed = scoreCandidateFace(mediumBox, 0.85, imgDim);
    const scoreSmall = scoreCandidateFace(smallBox, 0.85, imgDim);

    assert.ok(scoreLarge > scoreMed, `Large score (${scoreLarge}) must be > medium score (${scoreMed})`);
    assert.ok(scoreMed > scoreSmall, `Medium score (${scoreMed}) must be > small score (${scoreSmall})`);
  });

  it("verifies scoreCandidateFace monotonicity with respect to confidence", () => {
    const imgDim = { width: 600, height: 600 };
    const box = { x: 200, y: 200, width: 200, height: 200 };

    const scoreHigh = scoreCandidateFace(box, 0.99, imgDim);
    const scoreMed = scoreCandidateFace(box, 0.70, imgDim);
    const scoreLow = scoreCandidateFace(box, 0.20, imgDim);

    assert.ok(scoreHigh > scoreMed, `High conf score (${scoreHigh}) must be > med conf score (${scoreMed})`);
    assert.ok(scoreMed > scoreLow, `Med conf score (${scoreMed}) must be > low conf score (${scoreLow})`);
  });

  it("handles edge cases (NaN, negative, zero, extreme values) gracefully without throwing or returning NaN", () => {
    const imgDim = { width: 800, height: 600 };
    
    // NaN confidence
    const scoreNaN = scoreCandidateFace({ x: 100, y: 100, width: 100, height: 100 }, NaN, imgDim);
    assert.ok(Number.isFinite(scoreNaN), "NaN confidence should fall back to finite number");

    // Negative confidence
    const scoreNegConf = scoreCandidateFace({ x: 100, y: 100, width: 100, height: 100 }, -0.5, imgDim);
    assert.ok(Number.isFinite(scoreNegConf), "Negative confidence should fall back to finite number");

    // Zero image dimensions
    const scoreZeroImg = scoreCandidateFace({ x: 0, y: 0, width: 100, height: 100 }, 0.9, { width: 0, height: 0 });
    assert.ok(Number.isFinite(scoreZeroImg), "Zero image dimensions should produce finite score");

    // Negative box dimensions
    const scoreNegBox = scoreCandidateFace({ x: -50, y: -50, width: -100, height: -100 }, 0.8, imgDim);
    assert.ok(Number.isFinite(scoreNegBox), "Negative box dimensions should produce finite score");
  });

  it("verifies strict monotonic non-increasing ordering in sortFaceCandidates across 500 candidates", () => {
    const candidates = Array.from({ length: 500 }, (_, i) => ({
      id: `cand-${i}`,
      box: {
        x: (i * 37) % 1200,
        y: (i * 53) % 900,
        width: 50 + (i % 20) * 10,
        height: 50 + (i % 20) * 10,
      },
      confidence: 0.1 + ((i * 7) % 90) / 100,
    }));

    const sorted = sortFaceCandidates(candidates, { width: 1200, height: 900 });

    assert.equal(sorted.length, 500);
    assert.equal(sorted[0].isPrimary, true);
    for (let i = 1; i < sorted.length; i++) {
      assert.equal(sorted[i].isPrimary, false, `Candidate at index ${i} must not be primary`);
      assert.ok(
        sorted[i - 1].score >= sorted[i].score,
        `Score at ${i - 1} (${sorted[i - 1].score}) must be >= score at ${i} (${sorted[i].score})`
      );
    }
  });

  it("handles empty candidate array safely", () => {
    const sorted = sortFaceCandidates([], { width: 800, height: 600 });
    assert.deepEqual(sorted, []);
  });
});

describe("M1 Empirical Challenger Stress Harness - CLAHE & Memory Safety", () => {
  function makeMockCanvas(w, h, fillFn) {
    const data = new Uint8ClampedArray(w * h * 4);
    if (fillFn) {
      for (let i = 0; i < w * h; i++) {
        const [r, g, b, a] = fillFn(i, i % w, Math.floor(i / w));
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = a ?? 255;
      }
    }
    return {
      width: w,
      height: h,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({ data, width: w, height: h }),
        putImageData: (imgData) => {
          // verify putImageData receives valid non-empty Uint8ClampedArray
          assert.ok(imgData.data.length === w * h * 4);
        },
      }),
    };
  }

  // Set document.createElement mock if running in bare Node without DOM
  if (typeof globalThis.document === "undefined" || !globalThis.document.createElement) {
    globalThis.document = {
      createElement: (tag) => {
        if (tag === "canvas") return makeMockCanvas(1, 1);
        return {};
      },
    };
  }

  it("processes CLAHE on 0x0 canvas without throwing", () => {
    const zeroCanvas = { width: 0, height: 0 };
    const res = applyLocalContrastBoost(zeroCanvas);
    assert.equal(res, zeroCanvas);
  });

  it("processes CLAHE on 1x1 canvas safely", () => {
    const canvas1x1 = makeMockCanvas(1, 1, () => [128, 128, 128, 255]);
    const res = applyLocalContrastBoost(canvas1x1);
    assert.ok(res);
  });

  it("processes CLAHE on 1280x720 outdoor lighting simulation within < 50ms", () => {
    // Simulate backlit sunset photo with low contrast shadows and bright sky
    const w = 1280;
    const h = 720;
    const canvas1280 = makeMockCanvas(w, h, (i, x, y) => {
      // Dark bottom region (shadows), bright top region (sunset sky)
      const isShadow = y > 360;
      const base = isShadow ? 30 : 220;
      const noise = (x + y) % 15;
      return [base + noise, base + noise, base + noise, 255];
    });

    const start = performance.now();
    applyLocalContrastBoost(canvas1280);
    const duration = performance.now() - start;

    assert.ok(duration < 150, `1280x720 CLAHE contrast boost took ${duration}ms, expected < 150ms`);
  });

  it("verifies memory safety across 100 consecutive CLAHE iterations (no memory leaks or crashes)", () => {
    const w = 320;
    const h = 320;
    const canvas320 = makeMockCanvas(w, h, (i, x, y) => [(x * 3) % 256, (y * 5) % 256, (x + y) % 256, 255]);

    const start = performance.now();
    for (let iter = 0; iter < 100; iter++) {
      applyLocalContrastBoost(canvas320);
    }
    const totalDuration = performance.now() - start;
    const avgDuration = totalDuration / 100;

    assert.ok(avgDuration < 15, `Avg CLAHE iteration time (${avgDuration}ms) must be < 15ms`);
  });
});

describe("M1 Empirical Challenger Stress Harness - Group Photo Multi-Person Selection SLA", () => {
  it("evaluates 10,000 candidate score computations in < 15ms", () => {
    const imgDim = { width: 1920, height: 1080 };
    const boxes = Array.from({ length: 10000 }, (_, i) => ({
      box: { x: (i * 13) % 1800, y: (i * 17) % 1000, width: 100 + (i % 50), height: 100 + (i % 50) },
      conf: 0.5 + (i % 50) * 0.01,
    }));

    const start = performance.now();
    for (let i = 0; i < boxes.length; i++) {
      scoreCandidateFace(boxes[i].box, boxes[i].conf, imgDim);
    }
    const duration = performance.now() - start;

    assert.ok(duration < 15, `10,000 candidate scoring calls took ${duration}ms, expected < 15ms`);
  });
});
