## 2026-08-11T18:39:27Z
You are worker_m1 (teamwork_preview_worker).
Your working directory is `/Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_worker_m1`.
Create your working directory if it does not exist.

Your mission: Implement Milestone 1 (ONNX Runtime WebGPU/WASM Client Execution Engine, WebWorker Zero-Copy Architecture, 1 Euro Filter Smoothing & Stage Latency Instrumentation) for Twinframe AccuFace v4.0.

Read the authoritative user request at `/Volumes/LaCie/GitHub/twinframe/.agents/ORIGINAL_REQUEST.md` and project spec at `/Volumes/LaCie/GitHub/twinframe/PROJECT.md`.
Read the Explorer strategy reports at:
- `/Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_explorer_m1_1/handoff.md` (and `analysis.md`)
- `/Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_explorer_m1_2/handoff.md` (and `analysis.md`)
- `/Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_explorer_m1_3/handoff.md` (and `analysis.md`)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Tasks to implement:
1. Package & Assets: Update `package.json` to add `"onnxruntime-web": "^1.20.1"`, create `scripts/copy-ort-assets.mjs` (or npm postinstall/build script) to copy ONNX Runtime WASM assets (`ort-wasm*.wasm`) into `public/models/ort/`.
2. ONNX Execution Engine (`src/lib/face/onnx-engine.ts`): Implement `onnxruntime-web` loader with WebGPU WGSL compute shader provider (`executionProviders: ["webgpu", "wasm"]`), multi-threaded WASM SIMD fallback with dynamic COOP/COEP isolation check (`self.crossOriginIsolated ? 4 : 1`), singleton session manager, and hardware diagnostic micro-benchmarking probe (`probeHardwareCapabilities()`).
3. WebWorker Architecture & Zero-Copy Transfers (`src/lib/face/face-worker.ts`, `src/lib/face/worker-client.ts`): Implement WebWorker message protocol, zero-copy `OffscreenCanvas` / `ImageBitmap` transfers using `postMessage(data, [transferable])`, mandatory `bitmap.close()` cleanup, correlation map request-response tracking, frame dropping, and timeout/error handling.
4. 1 Euro Filter Smoothing (`src/lib/face/smoothing.ts`): Implement `OneEuroFilter` scalar and `LandmarkSmoother` multi-dimensional landmark temporal smoothing with adaptive cutoff parameters ($f_{c,\min} = 1.0\text{ Hz}$, $\beta = 0.007$, $f_{c,\text{der}} = 1.0\text{ Hz}$).
5. Types & Telemetry (`src/lib/face/types.ts`, `src/lib/face/pipeline.ts`): Extend `FaceStageLatencies` interface to record `modelLoadMs`, `downscaleMs`, `scrfdPassMs`, `frontalizationMs`, `embeddingMs`, `biohashMs`, and `totalMs`. Instrument `analyzeFaceSource()` stage boundary high-resolution timers (`performance.now()`).
6. Unit Tests: Implement unit tests in `src/lib/face/onnx-engine.test.ts`, `src/lib/face/face-worker.test.ts`, and `src/lib/face/smoothing.test.ts`.

Verification requirements:
Run `npm run typecheck`, `npm test`, and `npm run build` after completing changes. Document all commands and results in your handoff report `/Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_worker_m1/handoff.md` and changes summary `/Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_worker_m1/changes.md`.
When done, send a message to parent with your completion status and report paths.
