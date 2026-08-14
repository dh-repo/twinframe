import type { WorkerRequestMessage, WorkerResponseMessage } from "./worker-protocol";
import { initOnnxEngine, probeHardwareCapabilities } from "./onnx-engine";
import { LandmarkSmoother } from "./smoothing";
import { analyzeFaceSource } from "./pipeline";

let isEngineInitialized = false;
let activeBackend: "webgpu" | "wasm" = "wasm";
const landmarkSmoother = new LandmarkSmoother();

if (typeof self !== "undefined" && typeof (self as any).postMessage === "function") {
  const workerScope = self as any;

  workerScope.onmessage = async (event: MessageEvent<WorkerRequestMessage>) => {
    const msg = event.data;
    if (!msg || !msg.id || !msg.type) return;

    try {
      switch (msg.type) {
        case "INIT_ENGINE": {
          initOnnxEngine();
          const caps = await probeHardwareCapabilities();
          isEngineInitialized = true;
          activeBackend = caps.activeExecutionProvider;

          postResponse({
            id: msg.id,
            type: "ENGINE_READY",
            payload: {
              backend: activeBackend,
              simdSupported: caps.wasmSimdSupported,
              benchmarkLatencyMs: caps.warmupLatencyMs,
              workerId: "accuface-worker-1",
            },
            timestamp: Date.now(),
          });
          break;
        }

        case "ANALYZE_FRAME": {
          if (!isEngineInitialized) {
            // Auto-initialize if not called explicitly
            initOnnxEngine();
            isEngineInitialized = true;
          }

          const { bitmap, topK = 5, smoothLandmarks, timestampSec = Date.now() / 1000 } = msg.payload;

          try {
            const result = await analyzeFaceSource(bitmap as any, {
              topK,
              selectedCandidateIndex: msg.payload.selectedCandidateIndex,
              selectedBox: msg.payload.selectedBox,
              onProgress: (stepIndex, progressPct, details) => {
                postResponse({
                  id: msg.id,
                  type: "PROGRESS",
                  payload: { stepIndex, progressPct, details: details as any },
                  timestamp: Date.now(),
                });
              },
            });

            // Extract face crop using OffscreenCanvas if supported
            let facePreviewBitmap: ImageBitmap | undefined = undefined;
            if (typeof OffscreenCanvas !== "undefined" && bitmap.width > 0 && bitmap.height > 0) {
              try {
                const offscreen = new OffscreenCanvas(112, 112);
                const ctx = offscreen.getContext("2d");
                if (ctx) {
                  ctx.drawImage(bitmap as any, 0, 0, 112, 112);
                  if (typeof offscreen.transferToImageBitmap === "function") {
                    facePreviewBitmap = offscreen.transferToImageBitmap();
                  }
                }
              } catch (cropErr) {
                console.warn("[Worker] OffscreenCanvas crop failed:", cropErr);
              }
            }

            const transfer: Transferable[] = [];
            if (facePreviewBitmap) {
              transfer.push(facePreviewBitmap);
            }

            postResponse(
              {
                id: msg.id,
                type: "ANALYSIS_RESULT",
                payload: {
                  result,
                  facePreviewBitmap,
                },
                timestamp: Date.now(),
              },
              transfer
            );
          } finally {
            // MANDATORY ZERO-COPY RESOURCE CLEANUP
            if (bitmap && typeof bitmap.close === "function") {
              try {
                bitmap.close();
              } catch (closeErr) {
                // Ignore if already closed
              }
            }
          }
          break;
        }

        case "UPDATE_SMOOTHING": {
          if (msg.payload) {
            landmarkSmoother.reset();
          }
          postResponse({
            id: msg.id,
            type: "SMOOTHING_UPDATED",
            payload: { updated: true, success: true },
            timestamp: Date.now(),
          });
          break;
        }

        case "PING": {
          postResponse({
            id: msg.id,
            type: "PONG",
            payload: { echoTimestamp: msg.timestamp },
            timestamp: Date.now(),
          });
          break;
        }

        case "TERMINATE": {
          isEngineInitialized = false;
          landmarkSmoother.reset();
          workerScope.close();
          break;
        }
      }
    } catch (err: any) {
      postResponse({
        id: msg.id,
        type: "ERROR",
        payload: {
          message: err?.message || "Unknown worker error",
          code: err?.code || "WORKER_INTERNAL_ERROR",
          stack: err?.stack,
        },
        timestamp: Date.now(),
      });
    }
  };
}

function postResponse(response: WorkerResponseMessage, transfer?: Transferable[]) {
  if (typeof self !== "undefined" && typeof (self as any).postMessage === "function") {
    if (transfer && transfer.length > 0) {
      (self as any).postMessage(response, transfer);
    } else {
      (self as any).postMessage(response);
    }
  }
}
