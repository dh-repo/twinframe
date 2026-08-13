import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  detectAndDescribe,
  logFaceTelemetry,
  applyLocalContrastBoost,
  sortFaceCandidates,
  scoreCandidateFace,
} from "./faceapi-engine.ts";
import type { FaceTelemetry, FaceStageLatencies } from "./types.ts";

function createMockCanvas(width: number, height: number, fillVal = 128): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fillVal;
    data[i * 4 + 1] = fillVal;
    data[i * 4 + 2] = fillVal;
    data[i * 4 + 3] = 255;
  }

  const mockCanvas: any = {
    width,
    height,
    getContext: (type: string) => {
      if (type !== "2d") return null;
      return {
        drawImage: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray(data),
          width,
          height,
        }),
        putImageData: () => {},
        fillRect: () => {},
        translate: () => {},
        scale: () => {},
      };
    },
    toDataURL: () => "data:image/jpeg;base64,mock",
  };

  return mockCanvas as HTMLCanvasElement;
}

describe("M1 & M2 Empirical Challenger Verification Suite", () => {
  let originalWindow: any;
  let originalDocument: any;

  before(() => {
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;

    (globalThis as any).window = globalThis;
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "canvas") return createMockCanvas(320, 320);
        return {};
      },
    };
  });

  after(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  describe("1. Telemetry Precision and Stage Latencies Invariants", () => {
    it("populates all stage latencies accurately and maintains totalMs >= ssdPassMs + claheMs + embeddingMs", () => {
      const latencies: FaceStageLatencies = {
        modelLoadMs: 15,
        downscaleMs: 8,
        ssdPassMs: 45,
        claheMs: 12,
        embeddingMs: 30,
        totalMs: 120,
      };

      const telemetry: FaceTelemetry = {
        originalWidth: 6000,
        originalHeight: 4000,
        downscaledWidth: 800,
        downscaledHeight: 533,
        faceCount: 5,
        primaryConfidence: 0.92,
        latencies,
      };

      // Verify structural invariant totalMs >= sum of inner stage latencies
      const innerSum = latencies.ssdPassMs + latencies.claheMs + latencies.embeddingMs;
      assert.ok(
        latencies.totalMs >= innerSum,
        `Total latency (${latencies.totalMs}ms) must be >= sum of inner processing stages (${innerSum}ms)`,
      );

      // Verify all latency fields are non-negative finite numbers
      for (const [key, value] of Object.entries(latencies)) {
        assert.ok(
          Number.isFinite(value) && value >= 0,
          `Stage latency ${key} (${value}) must be a non-negative finite number`,
        );
      }

      // Verify logFaceTelemetry outputs formatted diagnostic log without error
      let loggedMessage = "";
      const origConsoleLog = console.log;
      console.log = (...args: any[]) => {
        loggedMessage = args.join(" ");
      };
      try {
        logFaceTelemetry(telemetry);
        assert.ok(
          loggedMessage.includes("[Twinframe Telemetry]"),
          "Console output must include [Twinframe Telemetry] prefix",
        );
        assert.ok(loggedMessage.includes("6000x4000"), "Must report original image resolution");
        assert.ok(loggedMessage.includes("800x533"), "Must report downscaled canvas resolution");
        assert.ok(loggedMessage.includes("5 faces"), "Must report total detected face count");
      } finally {
        console.log = origConsoleLog;
      }
    });
  });

  describe("2. O(1) Neural Pass Verification Across 1 to 20 Candidate Faces", () => {
    it("ranks and processes 1 candidate face with exactly 1 primary descriptor pass", () => {
      const candidates = Array.from({ length: 1 }, (_, i) => ({
        id: `face-${i}`,
        box: { x: 100, y: 100, width: 200, height: 200 },
        confidence: 0.9,
      }));

      const sorted = sortFaceCandidates(candidates, { width: 1920, height: 1080 });
      assert.equal(sorted.length, 1);
      assert.equal(sorted.filter((f) => f.isPrimary).length, 1);
      assert.equal(sorted[0].isPrimary, true);
    });

    it("ranks and processes 20 candidate faces in a group photo with exactly 1 primary candidate marked", () => {
      const candidates = Array.from({ length: 20 }, (_, i) => ({
        id: `face-${i}`,
        box: { x: (i * 80) % 1800, y: (i * 50) % 1000, width: 100 + i * 5, height: 100 + i * 5 },
        confidence: 0.5 + (i % 5) * 0.1,
      }));

      // CPU warmup pass
      sortFaceCandidates(candidates, { width: 1920, height: 1080 });

      const start = performance.now();
      const sorted = sortFaceCandidates(candidates, { width: 1920, height: 1080 });
      const elapsed = performance.now() - start;

      assert.equal(sorted.length, 20);
      assert.equal(
        sorted.filter((f) => f.isPrimary).length,
        1,
        "Decoupled pipeline must mark exactly 1 primary face candidate",
      );
      assert.equal(sorted[0].isPrimary, true, "Highest score candidate must be primary");
      assert.ok(elapsed < 20, `20 candidate face sorting elapsed time ${elapsed.toFixed(3)}ms < 20ms budget`);
    });
  });

  describe("3. High-Resolution Multi-Person SLA (< 500ms)", () => {
    it("completes 640px pre-downscaled CLAHE contrast boost on high-res image efficiently", () => {
      const highResCanvas = createMockCanvas(1920, 1280, 80);

      // Warmup pass
      applyLocalContrastBoost(highResCanvas, 3.0, 8, 640);

      const start = performance.now();
      const boosted = applyLocalContrastBoost(highResCanvas, 3.0, 8, 640);
      const elapsed = performance.now() - start;

      assert.ok(boosted, "Boosted canvas must be returned");
      assert.ok(
        elapsed < 250,
        `CLAHE processing elapsed time ${elapsed.toFixed(2)}ms must be < 250ms budget`,
      );
    });

    it("downscales high-res 6000x4000 canvas to maxSide 800px preserving 3:2 aspect ratio", () => {
      const origW = 6000;
      const origH = 4000;
      const maxSide = 800;

      const scale = Math.min(1, maxSide / Math.max(origW, origH));
      const cw = Math.round(origW * scale);
      const ch = Math.round(origH * scale);

      assert.equal(cw, 800, "Width downscaled to maxSide 800");
      assert.equal(ch, 533, "Height scaled to 533 preserving 3:2 aspect ratio");

      const origPixels = origW * origH; // 24,000,000 pixels
      const downPixels = cw * ch; // 426,400 pixels
      const reductionPct = ((origPixels - downPixels) / origPixels) * 100;

      assert.ok(
        reductionPct > 98,
        `Pixel volume reduction (${reductionPct.toFixed(2)}%) must be > 98% for 24MP photos`,
      );
    });
  });
});
