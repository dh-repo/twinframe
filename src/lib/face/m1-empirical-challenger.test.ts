import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OneEuroFilter, LandmarkSmoother, type Point2D, type Point3D } from "./smoothing.ts";
import { FaceWorkerClient, type WorkerTransport } from "./worker-client.ts";
import type { WorkerRequestMessage, WorkerResponseMessage } from "./worker-protocol.ts";

describe("M1 Empirical Challenger Stress & Verification Suite", () => {
  describe("1. 1 Euro Filter Dynamics: Low-Velocity Jitter vs High-Velocity Zero-Lag Adaptation", () => {
    it("suppresses high-frequency jitter under low velocity by > 75%", () => {
      const filter = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007, derCutoff: 1.0 });
      const fps = 60;
      const dt = 1.0 / fps;
      const totalFrames = 120;
      const trueValue = 100.0;
      const jitterAmplitude = 2.0;

      const rawInputs: number[] = [];
      const filteredOutputs: number[] = [];

      for (let i = 0; i < totalFrames; i++) {
        const t = i * dt;
        // Alternating high-frequency noise signal (+2, -2, +2, -2...) simulating sensor jitter
        const noise = (i % 2 === 0 ? 1 : -1) * jitterAmplitude;
        const noisyVal = trueValue + noise;
        rawInputs.push(noisyVal);

        const out = filter.filter(noisyVal, t);
        // Exclude initial warmup frames (first 5 frames) for steady-state metric
        if (i >= 5) {
          filteredOutputs.push(out);
        }
      }

      // Calculate sample standard deviation for raw noisy inputs vs filtered outputs
      const rawMean = rawInputs.slice(5).reduce((a, b) => a + b, 0) / rawInputs.slice(5).length;
      const rawStd = Math.sqrt(
        rawInputs.slice(5).reduce((sum, v) => sum + Math.pow(v - rawMean, 2), 0) / rawInputs.slice(5).length
      );

      const filtMean = filteredOutputs.reduce((a, b) => a + b, 0) / filteredOutputs.length;
      const filtStd = Math.sqrt(
        filteredOutputs.reduce((sum, v) => sum + Math.pow(v - filtMean, 2), 0) / filteredOutputs.length
      );

      const jitterReductionRatio = (rawStd - filtStd) / rawStd;

      assert.ok(
        jitterReductionRatio > 0.75,
        `Jitter reduction ratio (${(jitterReductionRatio * 100).toFixed(1)}%) must exceed 75%. Raw std: ${rawStd.toFixed(3)}, Filtered std: ${filtStd.toFixed(3)}`
      );
      assert.ok(
        Math.abs(filtMean - trueValue) < 0.1,
        `Filtered mean (${filtMean.toFixed(3)}) must remain unbiased and close to true value (${trueValue})`
      );
    });

    it("adapts dynamically with zero lag during high-velocity step displacement compared to static LPF", () => {
      const oneEuro = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007, derCutoff: 1.0 });
      const staticLpf = new OneEuroFilter({ minCutoff: 1.0, beta: 0.0, derCutoff: 1.0 });

      const fps = 60;
      const dt = 1.0 / fps;
      const initialVal = 100.0;
      const jumpVal = 200.0;
      const targetThreshold = initialVal + 0.9 * (jumpVal - initialVal); // 90% step threshold (190.0)

      // Warm up both filters at initial value 100.0 for 30 frames
      let t = 0;
      for (let i = 0; i < 30; i++) {
        t = i * dt;
        oneEuro.filter(initialVal, t);
        staticLpf.filter(initialVal, t);
      }

      // Execute sudden large step displacement at t = 30 * dt
      let oneEuroFramesToTarget = -1;
      let staticLpfFramesToTarget = -1;

      for (let stepFrame = 1; stepFrame <= 60; stepFrame++) {
        t += dt;
        const outEuro = oneEuro.filter(jumpVal, t);
        const outStatic = staticLpf.filter(jumpVal, t);

        if (oneEuroFramesToTarget === -1 && outEuro >= targetThreshold) {
          oneEuroFramesToTarget = stepFrame;
        }
        if (staticLpfFramesToTarget === -1 && outStatic >= targetThreshold) {
          staticLpfFramesToTarget = stepFrame;
        }
      }

      assert.ok(
        oneEuroFramesToTarget > 0 && oneEuroFramesToTarget <= 5,
        `1 Euro filter must reach 90% threshold within 5 frames (< 84ms). Actual: ${oneEuroFramesToTarget} frames`
      );
      assert.ok(
        staticLpfFramesToTarget > 12,
        `Static LPF must lag significantly (> 12 frames). Actual: ${staticLpfFramesToTarget} frames`
      );
    });

    it("tracks continuous high-speed movement (1200 px/s) with minimal steady-state position error", () => {
      const oneEuro = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007, derCutoff: 1.0 });
      const fps = 60;
      const dt = 1.0 / fps;
      const velocity = 1200.0; // 1200 pixels/sec high velocity motion

      let currentPos = 0;
      let t = 0;
      const errors: number[] = [];

      for (let i = 0; i < 60; i++) {
        t = i * dt;
        currentPos = i * dt * velocity;
        const filteredPos = oneEuro.filter(currentPos, t);
        if (i >= 10) {
          errors.push(Math.abs(currentPos - filteredPos));
        }
      }

      const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
      assert.ok(
        meanError < 25.0,
        `Mean tracking error during 1200px/s motion (${meanError.toFixed(2)}px) must be under 25px due to beta adaptation`
      );
    });
  });

  describe("2. Landmark Smoother Timestamp Gap / Video Pause Reset", () => {
    it("resets 2D facial landmarks immediately when timestamp delta dt > 1.0s", () => {
      const smoother = new LandmarkSmoother();

      // Sequence of 5-point SCRFD landmarks around position (100, 100)
      const frameA: Point2D[] = [
        { x: 100, y: 100 },
        { x: 150, y: 100 },
        { x: 125, y: 130 },
        { x: 110, y: 160 },
        { x: 140, y: 160 },
      ];

      // Frame 0 at t = 0.0s
      smoother.filterPoints2D(frameA, 0.0);
      // Frame 1 at t = 0.016s
      const frameA2 = frameA.map((p) => ({ x: p.x + 1, y: p.y + 1 }));
      smoother.filterPoints2D(frameA2, 0.016);

      // Simulate video pause / seek jump: next frame arrives at t = 2.500s (dt = 2.484s > 1.0s)
      // New face position is at (500, 500)
      const framePostGap: Point2D[] = [
        { x: 500, y: 500 },
        { x: 550, y: 500 },
        { x: 525, y: 530 },
        { x: 510, y: 560 },
        { x: 540, y: 560 },
      ];

      const outPostGap = smoother.filterPoints2D(framePostGap, 2.5);

      // Verify that after gap > 1.0s, returned points match framePostGap EXACTLY without trajectory overshooting/lag
      for (let i = 0; i < framePostGap.length; i++) {
        assert.equal(
          outPostGap[i]!.x,
          framePostGap[i]!.x,
          `Post-gap 2D x landmark at index ${i} must reset to exact raw value ${framePostGap[i]!.x}`
        );
        assert.equal(
          outPostGap[i]!.y,
          framePostGap[i]!.y,
          `Post-gap 2D y landmark at index ${i} must reset to exact raw value ${framePostGap[i]!.y}`
        );
      }
    });

    it("resets 3D landmarks and flat buffers cleanly when timestamp delta dt > 1.0s", () => {
      const smoother = new LandmarkSmoother();

      const p3dA: Point3D[] = [{ x: 10, y: 20, z: 30 }];
      smoother.filterPoints3D(p3dA, 0.0);
      smoother.filterPoints3D(p3dA, 0.016);

      // Gap > 1.0s
      const p3dGap: Point3D[] = [{ x: 900, y: 800, z: 700 }];
      const out3d = smoother.filterPoints3D(p3dGap, 3.0);
      assert.deepEqual(out3d, p3dGap, "3D landmarks must reset immediately after dt > 1.0s");

      // Flat buffer gap > 1.0s test
      const flatA = new Float32Array([5, 15, 25, 35]);
      smoother.filterFlat(flatA, 3.0);
      smoother.filterFlat(flatA, 3.016);

      const flatGap = new Float32Array([100, 200, 300, 400]);
      const outFlat = smoother.filterFlat(flatGap, 5.5); // dt = 2.484s > 1.0s
      assert.deepEqual(Array.from(outFlat), Array.from(flatGap), "Flat buffer landmarks must reset on dt > 1.0s");
    });

    it("resets filter state completely when explicit .reset() is invoked", () => {
      const smoother = new LandmarkSmoother();
      const pt: Point2D[] = [{ x: 50, y: 50 }];
      smoother.filterPoints2D(pt, 0.0);
      smoother.filterPoints2D([{ x: 52, y: 52 }], 0.016);

      smoother.reset();

      const freshPt: Point2D[] = [{ x: 999, y: 888 }];
      const outFresh = smoother.filterPoints2D(freshPt, 10.0);
      assert.deepEqual(outFresh, freshPt, "Explicit reset() must clear state and return exact initial value on next frame");
    });
  });

  describe("3. WebWorker Client Architecture & Memory Management Invariants", () => {
    it("correlates asynchronous worker messages correctly and rejects busy frames when dropIfBusy is true", async () => {
      let workerOnMessage: ((ev: MessageEvent) => void) | null = null;
      const sentMessages: any[] = [];
      let mockWorkerTerminated = false;

      const mockTransport: WorkerTransport = {
        postMessage: (msg: any) => {
          sentMessages.push(msg);
          // Simulate worker response asynchronously
          setTimeout(() => {
            if (!workerOnMessage) return;
            if (msg.type === "INIT_ENGINE") {
              workerOnMessage({
                data: {
                  id: msg.id,
                  type: "ENGINE_READY",
                  payload: {
                    backend: "wasm",
                    simdSupported: true,
                    benchmarkLatencyMs: 1.5,
                    workerId: "mock-worker",
                  },
                  timestamp: Date.now(),
                },
              } as MessageEvent);
            } else if (msg.type === "ANALYZE_FRAME") {
              workerOnMessage({
                data: {
                  id: msg.id,
                  type: "ANALYSIS_RESULT",
                  payload: {
                    result: { matchPercentage: 92.5 } as any,
                  },
                  timestamp: Date.now(),
                },
              } as MessageEvent);
            }
          }, 5);
        },
        get onmessage() {
          return workerOnMessage;
        },
        set onmessage(fn) {
          workerOnMessage = fn;
        },
        get onerror() {
          return null;
        },
        set onerror(_) {},
        terminate: () => {
          mockWorkerTerminated = true;
        },
      };

      const client = new FaceWorkerClient({ transport: mockTransport });
      assert.equal(client.ready, false);
      assert.equal(client.busy, false);

      await client.init({ preferredBackend: "wasm" });
      assert.equal(client.ready, true);

      // Create mock ImageBitmap with close spy
      let bitmapClosed = false;
      const mockBitmap: any = {
        width: 640,
        height: 480,
        close: () => {
          bitmapClosed = true;
        },
      };

      const analyzePromise = client.analyzeFrame(mockBitmap as unknown as ImageBitmap);
      assert.equal(client.busy, true, "Client must set busy flag while analyzing frame");

      // Attempt to send second frame with dropIfBusy: true
      await assert.rejects(
        async () => {
          await client.analyzeFrame(mockBitmap as unknown as ImageBitmap, { dropIfBusy: true });
        },
        {
          message: "FRAME_DROPPED: Worker is currently processing another frame.",
        }
      );

      const res = await analyzePromise;
      assert.equal(client.busy, false, "Client busy flag must reset after frame analysis completes");
      assert.equal((res.result as any).matchPercentage, 92.5);

      client.terminate();
      assert.equal(mockWorkerTerminated, true, "Transport terminate must be invoked");
    });
  });
});
