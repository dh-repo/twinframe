# Handoff Report — Milestone 1 Empirical Verification & Stress Testing

**Agent**: `challenger_m1_2` (teamwork_preview_challenger)  
**Role**: Empirical Challenger Lead  
**Working Directory**: `/Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_challenger_m1_2`  
**Date**: 2026-08-11  

---

## Explicit Verdict: REJECT

---

## 1. Observation

Direct observations from empirical test execution and code analysis:

1. **TypeScript Typecheck**:
   - Command: `npm run typecheck`
   - Output: Exit code 0, 0 TypeScript errors.

2. **Full Unit Test Suite Execution**:
   - Command: `npm test`
   - Output: Executed 254 unit tests across 90 test suites. All 254 unit tests passed cleanly (0 failures, duration ~448ms), including our newly added empirical verification suite (`src/lib/face/m1-challenger-verification.test.ts`).

3. **Requirement 1 — ONNX Engine WebGPU Fallback Logic**:
   - Code inspected: `src/lib/face/onnx-engine.ts`.
   - `createInferenceSession()` sets `executionProviders: ["webgpu", "wasm"]`. When WebGPU creation throws an error, the `catch (webgpuError)` block logs a warning and retries with `executionProviders: ["wasm"]`.
   - `probeHardwareCapabilities()` catches errors when querying `navigator.gpu.requestAdapter()`, setting `webgpuAvailable: false` and `activeExecutionProvider: "wasm"` without throwing.
   - Empirically verified via tests 1.1, 1.2, 1.3, and 1.4 in `src/lib/face/m1-challenger-verification.test.ts`.

4. **Requirement 2 — FaceWorkerClient Timeouts, Frame Dropping & Memory Leaks**:
   - Code inspected: `src/lib/face/worker-client.ts` and `src/lib/face/face-worker.ts`.
   - Timeout handling: Requests set a `setTimeout` timer. On timeout, the promise rejects and `this.pendingRequests.delete(msg.id)` removes the request from the correlation map.
   - Frame dropping: `analyzeFrame(..., { dropIfBusy: true })` throws `FRAME_DROPPED: Worker is currently processing another frame.` when `isBusy` is `true`.
   - Correlation map cleanup: Verified cleanup on `ENGINE_READY`, `ANALYSIS_RESULT`, `PONG`, `ERROR`, `onerror`, and `terminate()`.
   - **CRITICAL DEFECT FOUND (Defect #1)**: `client.updateSmoothing()` ALWAYS TIMES OUT.
     - In `face-worker.ts` (line 141-152), handling `"UPDATE_SMOOTHING"` calls `postResponse` with `type: "PROGRESS"`.
     - In `worker-client.ts` (line 307-314), `case "PROGRESS"` only triggers `pending.onProgress?.()`. It DOES NOT call `pending.resolve()`, clear the `timeoutTimer`, or delete the request from `pendingRequests`.
     - Result: Any caller invoking `client.updateSmoothing()` hangs for 5,000ms until the timeout timer fires, rejecting the promise with `Worker request 'UPDATE_SMOOTHING' timed out after 5000ms`.
     - Empirically verified in test 2.7 of `src/lib/face/m1-challenger-verification.test.ts`.
   - **MEDIUM DEFECT FOUND (Defect #2)**: `isBusy` flag desynchronizes under concurrent frame requests.
     - `isBusy` is a simple boolean. When frame A completes, its `onSuccess` callback unconditionally sets `this.isBusy = false`.
     - If frame B was sent while frame A was running (`dropIfBusy: false`), frame B is STILL running when frame A finishes. When frame A sets `isBusy = false`, a new frame C with `dropIfBusy: true` will see `isBusy === false` and bypass the busy drop guard while frame B is still executing.

5. **Requirement 3 — Zero-Copy Transferable Protocol & `bitmap.close()` Cleanup**:
   - Code inspected: `src/lib/face/worker-client.ts` and `src/lib/face/face-worker.ts`.
   - `FaceWorkerClient.analyzeFrame` transfers `[bitmap]` in the `transfer` list when calling `transport.postMessage(msg, transferables)`.
   - `face-worker.ts` executes `bitmap.close()` inside a `finally` block for BOTH successful frame processing and when frame processing throws an unhandled error.
   - `face-worker.ts` transfers `[facePreviewBitmap]` in the `transfer` list when sending `ANALYSIS_RESULT`.
   - Empirically verified via tests 3.1, 3.2, and 3.3 in `src/lib/face/m1-challenger-verification.test.ts`.

---

## 2. Logic Chain

1. **TypeScript & Test Suite Execution**: `npm run typecheck` and `npm test` execute cleanly with 0 type errors and 254 passing tests.
2. **ONNX Engine Fallback Verification**: `createInferenceSession()` handles WebGPU initialization failures by catching the error and re-instantiating with `["wasm"]`. Hardware capability probing gracefully defaults to WASM when WebGPU context is unavailable.
3. **Zero-Copy Memory Disposal**: `ImageBitmap` buffers are passed via Transferables to avoid main-thread serialization cost ($O(1)$ transfer), and `bitmap.close()` in `finally` blocks prevents VRAM memory accumulation.
4. **Defect #1 Causality**: When `client.updateSmoothing()` is called:
   - `worker-client.ts` registers a pending request in `this.pendingRequests` expecting a resolution.
   - `face-worker.ts` responds with `type: "PROGRESS"`.
   - `worker-client.ts` receives `"PROGRESS"`, treats it as an intermediate status update, and leaves the promise pending.
   - After 5000ms, `timeoutTimer` fires and rejects the promise. This protocol defect renders 1 Euro Filter dynamic parameter re-configuration broken across the worker bridge.
5. **Verdict Rationale**: Milestone 1 cannot be approved with a broken worker protocol command. Verdict is **REJECT**.

---

## 3. Caveats

- **WebGPU Shader Runtime**: WebGPU compute shaders were verified via API mocks and hardware fallback logic in Node.js test environment; end-to-end WGSL shader rendering requires live browser invocation (`node scripts/browser-smoke.mjs`).
- **Impact of Defect #1**: `updateSmoothing()` is non-fatal to standard single-frame analysis (`analyzeFrame()`), but breaks any UI or pipeline component attempting to update filter cutoffs dynamically during video tracking.

---

## 4. Conclusion

Milestone 1 is **REJECTED** due to a critical protocol defect in WebWorker landmark smoothing configuration:

### Required Remediation Items:

1. **Fix Defect #1 (CRITICAL - Protocol Mismatch)**:
   - Option A: In `src/lib/face/face-worker.ts`, update `UPDATE_SMOOTHING` handler to post a response that resolves the request (e.g. `type: "PROGRESS"` handled as completion or a new response type `type: "SMOOTHING_UPDATED"`).
   - Option B: In `src/lib/face/worker-client.ts`, update `bindTransportEvents()` so that `UPDATE_SMOOTHING` requests resolve when the `"PROGRESS"` response (or completion response) arrives.

2. **Fix Defect #2 (MEDIUM - `isBusy` State Tracking)**:
   - In `src/lib/face/worker-client.ts`, replace `isBusy: boolean` with `activeFrameCount: number` or `isBusy = pendingFrameCount > 0` so that `isBusy` remains `true` until ALL pending frame analysis requests have completed.

---

## 5. Verification Method

To independently verify these findings:

1. **Run TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected output*: Exit code 0, 0 errors.

2. **Run Full Test Suite**:
   ```bash
   npm test
   ```
   *Expected output*: 254 passing tests across 90 suites.

3. **Empirically Verify Defect #1 (updateSmoothing Timeout)**:
   - Inspect `src/lib/face/m1-challenger-verification.test.ts` test `2.7. EMPIRICAL BUG AUDIT: verifies updateSmoothing protocol message handling`.
   - Run specific test:
     ```bash
     node --experimental-strip-types --test src/lib/face/m1-challenger-verification.test.ts
     ```
