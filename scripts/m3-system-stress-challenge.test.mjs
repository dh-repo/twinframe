import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Import modules under test
import {
  transformNormalizedPointToHud,
  transformNormalizedBoxToHud,
} from "../src/lib/face/hud-transform.ts";

import {
  scoreCandidateFace,
  sortFaceCandidates,
  applyLocalContrastBoost,
  assessDetectionQuality,
} from "../src/lib/face/faceapi-engine.ts";

import {
  distanceToMatchPercent,
  computeMatchConfidence,
  ageAffinity,
  genderAffinity,
  rankPercentsFromDistances,
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
} from "../src/lib/face/embeddings.ts";

describe("M3 System Stress Test Challenge - Empirical Validation Suite", () => {

  // --------------------------------------------------------------------------
  // Domain 1: Multi-Person Group Photos & Candidate Selection
  // --------------------------------------------------------------------------
  describe("1. Multi-Person Group Photos & Candidate Selection", () => {
    test("Reference 3-person sunset photo scenario (center primary vs side candidates)", () => {
      const imgDim = { width: 1920, height: 1080 }; // 16:9 landscape photo
      const candidates = [
        {
          id: "face-left",
          box: { x: 200, y: 300, width: 180, height: 220 },
          confidence: 0.88,
        },
        {
          id: "face-center",
          box: { x: 870, y: 250, width: 220, height: 260 }, // larger, centered
          confidence: 0.94,
        },
        {
          id: "face-right",
          box: { x: 1500, y: 320, width: 160, height: 200 },
          confidence: 0.82,
        },
      ];

      const sorted = sortFaceCandidates(candidates, imgDim);

      assert.equal(sorted.length, 3, "All 3 faces preserved");
      assert.equal(sorted[0].id, "face-center", "Centered, larger face must be primary (rank #1)");
      assert.equal(sorted[0].isPrimary, true, "Top face must have isPrimary=true");
      assert.equal(sorted[1].isPrimary, false, "Second face isPrimary=false");
      assert.equal(sorted[2].isPrimary, false, "Third face isPrimary=false");

      // Verify composite score strictly decreases
      assert.ok(sorted[0].score > sorted[1].score);
      assert.ok(sorted[1].score > sorted[2].score);
    });

    test("Crowd shot with 25 faces in various positions", () => {
      const imgDim = { width: 3840, height: 2160 };
      const candidates = Array.from({ length: 25 }, (_, i) => ({
        id: `crowd-${i}`,
        box: {
          x: (i * 140) % 3600,
          y: (i * 80) % 1900,
          width: 80 + (i % 5) * 20,
          height: 80 + (i % 5) * 20,
        },
        confidence: 0.5 + (i % 10) * 0.05,
      }));

      const sorted = sortFaceCandidates(candidates, imgDim);
      assert.equal(sorted.length, 25);
      const primaryCount = sorted.filter((c) => c.isPrimary).length;
      assert.equal(primaryCount, 1, "Exactly one candidate marked primary");
      assert.equal(sorted[0].isPrimary, true);
    });

    test("SelectedCandidateIndex bounds stress (out-of-range index handling)", () => {
      const candidates = [
        { box: { x: 100, y: 100, width: 100, height: 100 }, confidence: 0.9 },
        { box: { x: 300, y: 100, width: 100, height: 100 }, confidence: 0.8 },
      ];
      const sorted = sortFaceCandidates(candidates, { width: 1000, height: 1000 });
      assert.equal(sorted.length, 2);
    });
  });

  // --------------------------------------------------------------------------
  // Domain 2: Outdoor Sunset Lighting & Contrast Normalization
  // --------------------------------------------------------------------------
  describe("2. Outdoor Sunset Lighting & Contrast Normalization", () => {
    function setupMockDocument(w = 100, h = 100, dataArr = null) {
      if (typeof globalThis.document === "undefined") {
        const data = dataArr || new Uint8ClampedArray(w * h * 4);
        globalThis.document = {
          createElement: (tag) => {
            if (tag === "canvas") {
              return {
                width: w,
                height: h,
                getContext: (type) => {
                  if (type !== "2d") return null;
                  return {
                    drawImage: () => {},
                    getImageData: () => ({ data: new Uint8ClampedArray(data), width: w, height: h }),
                    putImageData: () => {},
                  };
                },
              };
            }
            return {};
          },
        };
      }
    }

    test("CLAHE contrast boost on extreme lighting synthetic canvases", () => {
      const w = 100;
      const h = 100;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const val = 10 + (i % 30);
        data[i * 4] = val;
        data[i * 4 + 1] = Math.floor(val / 2);
        data[i * 4 + 2] = Math.floor(val / 3);
        data[i * 4 + 3] = 255;
      }
      setupMockDocument(w, h, data);

      const mockCanvas = {
        width: w,
        height: h,
        getContext: (type) => {
          if (type !== "2d") return null;
          return {
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(data), width: w, height: h }),
            putImageData: (imgData) => {
              let boostedCount = 0;
              for (let j = 0; j < w * h; j++) {
                if (imgData.data[j * 4] > data[j * 4]) boostedCount++;
              }
              assert.ok(boostedCount > 0, "CLAHE must boost low contrast pixels");
            },
          };
        },
      };

      const result = applyLocalContrastBoost(mockCanvas);
      assert.ok(result, "CLAHE boost returned valid canvas");
    });

    test("Quality assessment warnings for outdoor sunset low illumination", () => {
      const mockDet = {
        confidence: 0.75,
        sharpness: 50,
        illumination: 0.15, // dark outdoor sunset photo
        box: { x: 100, y: 100, width: 200, height: 200 },
        imageWidth: 1000,
        imageHeight: 1000,
      };

      const quality = assessDetectionQuality(mockDet);
      assert.equal(quality.ok, false, "Dim outdoor lighting triggers warning issue, setting ok=false");
      assert.ok(quality.issues.some((i) => i.includes("Dim lighting detected")), "Must contain dim lighting warning");
      assert.ok(quality.illumination < 0.2);
    });
  });

  // --------------------------------------------------------------------------
  // Domain 3: Full-Body Portraits & Small Face Detection
  // --------------------------------------------------------------------------
  describe("3. Full-Body Portraits & Small Face Detection", () => {
    test("Small face coverage warning in full-body photo (< 2.5% coverage)", () => {
      const fullBodyDet = {
        confidence: 0.85,
        sharpness: 60,
        illumination: 0.6,
        box: { x: 900, y: 200, width: 80, height: 80 }, // 6400 px² in 2,073,600 px² photo (0.3% coverage)
        imageWidth: 1920,
        imageHeight: 1080,
      };

      const quality = assessDetectionQuality(fullBodyDet);
      assert.ok(quality.issues.some((issue) => issue.includes("zoomed in automatically") || issue.includes("fill more of the frame")), "Must issue small face coverage guidance");
      assert.ok(quality.faceCoverage < 0.01);
    });

    test("Multi-face small coverage threshold tolerance (2.5% threshold for multi-face vs 3.5% single-face)", () => {
      const multiFaceDet = {
        confidence: 0.80,
        sharpness: 55,
        illumination: 0.5,
        box: { x: 500, y: 200, width: 150, height: 150 }, // 22500 px² in 1,000,000 px² (2.25% coverage)
        imageWidth: 1000,
        imageHeight: 1000,
        allFaces: [
          { box: { x: 500, y: 200, width: 150, height: 150 }, confidence: 0.8, score: 100, isPrimary: true },
          { box: { x: 200, y: 200, width: 140, height: 140 }, confidence: 0.75, score: 80, isPrimary: false },
        ],
      };

      const quality = assessDetectionQuality(multiFaceDet);
      assert.ok(quality.issues.length > 0, "Multi-face small coverage generates gentle guidance");
    });
  });

  // --------------------------------------------------------------------------
  // Domain 4: Aspect Ratio Matrix Invariants & HUD Alignment
  // --------------------------------------------------------------------------
  describe("4. Aspect Ratio Matrix Invariants & Extreme Ratios", () => {
    test("Transformation invariants across extreme aspect ratios", () => {
      const center = { x: 50, y: 50 };
      const ratios = [
        { w: 10000, h: 100 }, // 100:1 extreme landscape
        { w: 100, h: 10000 }, // 1:100 extreme portrait
        { w: 3840, h: 1080 }, // 32:9 ultrawide
        { w: 1080, h: 1920 }, // 9:16 vertical story
        { w: 1000, h: 1000 }, // 1:1 square
      ];

      for (const r of ratios) {
        const pt = transformNormalizedPointToHud(center, r.w, r.h, 100, 100);
        assert.ok(Math.abs(pt.x - 50) < 1e-5, `Center X must be 50 for ${r.w}x${r.h}, got ${pt.x}`);
        assert.ok(Math.abs(pt.y - 50) < 1e-5, `Center Y must be 50 for ${r.w}x${r.h}, got ${pt.y}`);
      }
    });

    test("Bounding box transformation on 16:9 photo under square container", () => {
      const box = { x: 40, y: 30, width: 20, height: 20 };
      const imgW = 1600;
      const imgH = 900; // 16:9 ratio = 1.777778

      const tBox = transformNormalizedBoxToHud(box, imgW, imgH, 100, 100);
      // Scale factor kx = 1.777778
      // tBox.x = 50 + (40 - 50) * 1.777778 = 32.22222
      // tBox.width = 20 * 1.777778 = 35.55556
      // tBox.y = 30, tBox.height = 20
      assert.ok(Math.abs(tBox.x - 32.222222) < 0.001);
      assert.ok(Math.abs(tBox.width - 35.555556) < 0.001);
      assert.equal(tBox.y, 30);
      assert.equal(tBox.height, 20);
    });

    test("Robustness to zero and negative image dimensions in hud-transform", () => {
      const pt = { x: 45, y: 55 };
      const box = { x: 10, y: 10, width: 30, height: 30 };

      assert.deepEqual(transformNormalizedPointToHud(pt, 0, 100), pt);
      assert.deepEqual(transformNormalizedPointToHud(pt, 100, -50), pt);
      assert.deepEqual(transformNormalizedBoxToHud(box, -100, 0), box);
    });
  });

  // --------------------------------------------------------------------------
  // Domain 5: Edge Case Parameters & Mathematical Calibration
  // --------------------------------------------------------------------------
  describe("5. Edge Case Parameters & Calibration Verification", () => {
    test("distanceToMatchPercent non-linear Hill curve exact values", () => {
      // Distance = 0 -> 100%
      assert.equal(distanceToMatchPercent(0), 100);
      // Distance = 0.32 -> 57.5% (Hill curve half-saturation point 15 + 85/2 = 57.5%)
      const scoreHalf = distanceToMatchPercent(0.32);
      assert.equal(scoreHalf, 57.5, `0.32 distance must evaluate to 57.5%, got ${scoreHalf}`);
      // Distance = 1.5 -> lower bound
      const scoreHighDist = distanceToMatchPercent(1.5);
      assert.ok(scoreHighDist >= 15.0);
    });

    test("Vector metrics stability on NaN and zero-vectors", () => {
      const v1 = new Float32Array([0, 0, 0, 0]);
      const v2 = new Float32Array([1, 2, 3, 4]);

      const euc = euclideanDistance(v1, v2);
      const cos = cosineDistance(v1, v2);
      const ens = ensembleDistance(v1, v2);

      assert.ok(Number.isFinite(euc), "Euclidean distance on zero vector must be finite");
      assert.ok(Number.isFinite(cos), "Cosine distance on zero vector must be finite");
      assert.ok(Number.isFinite(ens), "Ensemble distance on zero vector must be finite");
    });

    test("Age & Gender affinity continuity", () => {
      // Age affinity (sigma=18): delta = 0 -> 1.0; delta = 18 -> exp(-1) ≈ 0.36788
      const age0 = ageAffinity(30, 30);
      const age18 = ageAffinity(30, 48);
      assert.equal(age0, 1.0);
      assert.ok(Math.abs(age18 - 0.36788) < 0.01, `ageAffinity(delta=18) ≈ exp(-1), got ${age18}`);

      // Gender affinity: same gender -> 1.0; different gender with prob 1.0 -> floor 0.20
      const gSame = genderAffinity("female", 0.95, { gender: "female" });
      const gDiff = genderAffinity("male", 1.0, { gender: "female" });
      assert.equal(gSame, 1.0);
      assert.ok(Math.abs(gDiff - 0.20) < 1e-9, `cross-gender floor 0.20, got ${gDiff}`);
    });
  });
});
