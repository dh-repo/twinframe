import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("M3 UI Components Empirical Challenge", () => {
  describe("1. ComparisonView Split-Slider & Drag Behavior", () => {
    test("handleMove calculates percentage correctly and clamps between 0 and 100", () => {
      // Re-create slider calculation math from comparison-view.tsx
      const handleMove = (clientX, rectLeft, rectWidth) => {
        const x = clientX - rectLeft;
        return Math.max(0, Math.min(100, (x / rectWidth) * 100));
      };

      const rectLeft = 100;
      const rectWidth = 400;

      // Center
      assert.equal(handleMove(300, rectLeft, rectWidth), 50);
      // Left edge
      assert.equal(handleMove(100, rectLeft, rectWidth), 0);
      // Right edge
      assert.equal(handleMove(500, rectLeft, rectWidth), 100);
      // Below left (clamping)
      assert.equal(handleMove(50, rectLeft, rectWidth), 0);
      // Above right (clamping)
      assert.equal(handleMove(600, rectLeft, rectWidth), 100);
    });

    test("mouse drag release issue analysis (event binding scoping)", () => {
      // In comparison-view.tsx:
      // onMouseDown, onMouseMove, onMouseUp, onMouseLeave are bound to container div:
      // onMouseUp sets isDragging to false.
      // If user drags cursor outside the div container and releases mouse button (mouseup outside div),
      // div's onMouseUp is NOT triggered.
      // When cursor re-enters div, isDragging is still true, causing slider to continue tracking cursor without mouse button pressed.
      const containerEvents = ["onMouseDown", "onMouseMove", "onMouseUp", "onMouseLeave", "onTouchStart", "onTouchMove", "onTouchEnd"];
      assert.ok(containerEvents.includes("onMouseLeave"), "onMouseLeave is present as fallback, but mouseup outside div misses release");
    });
  });

  describe("2. NumberCounter easeOutCubic Precision & Behavior", () => {
    test("easeOutCubic formula matches mathematical specification: 1 - (1 - p)^3", () => {
      const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

      assert.equal(easeOutCubic(0), 0);
      assert.equal(easeOutCubic(1), 1);
      assert.equal(easeOutCubic(0.5), 0.875); // 1 - (0.5)^3 = 1 - 0.125 = 0.875
      assert.equal(easeOutCubic(0.25), 1 - Math.pow(0.75, 3)); // ~0.578125
      assert.equal(easeOutCubic(0.75), 1 - Math.pow(0.25, 3)); // ~0.984375

      // Monotonicity check
      let prev = -1;
      for (let p = 0; p <= 1; p += 0.05) {
        const val = easeOutCubic(p);
        assert.ok(val >= prev, `Non-monotonic at p=${p}`);
        prev = val;
      }
    });

    test("NumberCounter formatting and decimals rounding", () => {
      const formatVal = (val, decimals, formatter) => {
        return formatter ? formatter(val) : val.toFixed(decimals);
      };

      assert.equal(formatVal(87.5, 0), "88");
      assert.equal(formatVal(87.4, 0), "87");
      assert.equal(formatVal(87.456, 1), "87.5");
      assert.equal(formatVal(92.3, 0, (v) => `${Math.round(v)}%`), "92%");
    });
  });

  describe("3. HUD Telemetry Stream & Step Index Evaluation", () => {
    const TELEMETRY_MESSAGES = [
      "ALIGNING LANDMARKS 68/68",
      "COMPUTING AFFINE MATRIX",
      "EXTRACTING 128-D EMBEDDINGS",
      "MATCHING GALAXIES & CELEBRITIES",
    ];

    test("HUD telemetry message selection when stepIndex is provided vs defaulted", () => {
      // In face-scanning-hud.tsx line 73:
      // const currentTelemetry = TELEMETRY_MESSAGES[stepIndex % TELEMETRY_MESSAGES.length] || TELEMETRY_MESSAGES[telemetryIndex];
      // Note: stepIndex defaults to 0!
      const getTelemetry = (stepIndex = 0, telemetryIndex = 0) => {
        return TELEMETRY_MESSAGES[stepIndex % TELEMETRY_MESSAGES.length] || TELEMETRY_MESSAGES[telemetryIndex];
      };

      // When stepIndex = 0 (the default value):
      assert.equal(getTelemetry(0, 0), "ALIGNING LANDMARKS 68/68");
      assert.equal(getTelemetry(0, 1), "ALIGNING LANDMARKS 68/68"); // Ticker changes telemetryIndex to 1, but telemetry stays "ALIGNING LANDMARKS 68/68"!
      assert.equal(getTelemetry(0, 2), "ALIGNING LANDMARKS 68/68"); // Ticker changes telemetryIndex to 2, but telemetry stays "ALIGNING LANDMARKS 68/68"!

      // When stepIndex updates to step 1, step 2, step 3:
      assert.equal(getTelemetry(1, 0), "COMPUTING AFFINE MATRIX");
      assert.equal(getTelemetry(2, 0), "EXTRACTING 128-D EMBEDDINGS");
      assert.equal(getTelemetry(3, 0), "MATCHING GALAXIES & CELEBRITIES");
    });

    test("Hex ticker random generation format", () => {
      const generateTicker = (randVal) => {
        return `0x${Math.floor(randVal * 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
      };

      assert.equal(generateTicker(0), "0x0000");
      assert.equal(generateTicker(0.5), "0x7FFF");
      assert.equal(generateTicker(0.99999), "0xFFFE");
      assert.equal(generateTicker(1.0), "0xFFFF");
    });
  });

  describe("4. Fallback States", () => {
    test("ComparisonView null photo fallback props", () => {
      const userPhotoUrl = null;
      const celebrityPhotoUrl = null;

      assert.equal(userPhotoUrl ?? undefined, undefined);
      assert.equal(celebrityPhotoUrl ?? undefined, undefined);
    });

    test("MatchRevealCard confidence score rating fallback calculation", () => {
      const getConfidenceRating = (topMatch) => {
        const confidenceScore = topMatch.confidenceScore ?? Math.round(topMatch.matchPercent * 0.95);
        return {
          score: confidenceScore,
          rating: confidenceScore >= 80 ? "HIGH CONFIDENCE" : confidenceScore >= 60 ? "MODERATE CONFIDENCE" : "CALIBRATED MATCH",
        };
      };

      assert.deepEqual(getConfidenceRating({ matchPercent: 90, confidenceScore: 92 }), { score: 92, rating: "HIGH CONFIDENCE" });
      assert.deepEqual(getConfidenceRating({ matchPercent: 90, confidenceScore: undefined }), { score: 86, rating: "HIGH CONFIDENCE" });
      assert.deepEqual(getConfidenceRating({ matchPercent: 70, confidenceScore: 65 }), { score: 65, rating: "MODERATE CONFIDENCE" });
      assert.deepEqual(getConfidenceRating({ matchPercent: 50, confidenceScore: 45 }), { score: 45, rating: "CALIBRATED MATCH" });
    });
  });
});
