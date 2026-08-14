# Handoff Report — Milestone 2: SCRFD-2.5G Detection & ExpNorm 3D UV Frontalization

## Empirical Challenge Verdict: APPROVE

**Milestone**: M2 (SCRFD-2.5G Face Detection & Expression-Aware 3D UV WGSL Frontalization)  
**Target Path**: `src/lib/face/scrfd.ts`, `src/lib/face/exp-norm-wgsl.ts`, `src/lib/face/similarity-transform.ts`, `src/lib/face/pipeline.ts`  
**Verdict**: **APPROVE**

---

## 1. Observation

Direct empirical observations from source code inspection, custom stress-harness execution, and project commands:

1. **Source File `src/lib/face/scrfd.ts`**:
   - Lines 18–44: `generateAnchors` precomputes multi-stride feature pyramid anchors across strides 8, 16, and 32 for $640 \times 640$ inputs.
     - Stride 8: $80 \times 80 \times 2 = 12,800$ anchors.
     - Stride 16: $40 \times 40 \times 2 = 3,200$ anchors.
     - Stride 32: $20 \times 20 \times 2 = 800$ anchors.
     - Total: 16,800 anchors.
   - Lines 50–109: `estimateHeadPose` computes 3D head pose angles ($\theta_{\text{roll}}, \theta_{\text{yaw}}, \theta_{\text{pitch}}$) from 5-point facial landmarks using inter-ocular distance (IOD) and un-rolled nose/mouth displacement ratios.
   - Lines 135–158: `nmsFaceBoxes` filters candidate detection boxes using IoU threshold $0.40$ sorted by confidence score descending.
   - Lines 171–382: `detectSCRFD` letterboxes inputs to $640 \times 640$, normalizes pixels via $(x - 127.5) / 128.0$, executes ONNX model session `scrfd_2.5g`, parses output tensors, decodes bounding boxes/landmarks, and estimates pose.

2. **Source File `src/lib/face/exp-norm-wgsl.ts`**:
   - Lines 4–86: `EXP_NORM_WGSL_SHADER` defines WGSL compute shader with `struct ExpNormParams`, 10-basis blendshape residual subtraction ($\mathbf{S}_{\text{neutral}} = \mathbf{S}_{\text{base}} - \sum_{i=1}^{10} \alpha_i \mathbf{B}_i$), 3D rotation matrix $R(\text{yaw}, \text{pitch}, \text{roll})$, bilinear texture sampling, and planar NCHW Float32 output tensor buffer ($1 \times 3 \times 112 \times 112$).
   - Lines 95–134: `getCanonicalBlendshapeBases` precomputes canonical 3D base mesh vertices and 10 blendshape residual basis vectors for $112 \times 112$ ($2,207,744$ bytes) and $160 \times 160$ grids.
   - Lines 263–418: `runExpNormFrontalizationWGSL` executes WGSL compute pass on GPU with fail-safe fallback to 5-point Umeyama similarity alignment or CPU reference execution.

3. **Source File `src/lib/face/similarity-transform.ts`**:
   - Lines 32–151: `compute5PointSimilarityMatrix` solves normal equations $(A^T A) X = A^T B$ for 2D similarity transform matrix $M = \begin{bmatrix} a & -b & t_x \\ b & a & t_y \end{bmatrix}$ mapping detected 5-point landmarks to InsightFace reference landmarks (`REFERENCE_LANDMARKS_112` & `160`).
   - Lines 212–236: `align5PointSimilarityTensor` renders aligned face crop as normalized NCHW Float32Array tensor.

4. **Source File `src/lib/face/pipeline.ts`**:
   - Lines 85–104: Enforces frontalization routing decision: if $|\theta_{\text{yaw}}| > 25^\circ$, routes to ExpNorm WGSL compute shader; if $|\theta_{\text{yaw}}| \le 25^\circ$, routes to 5-point similarity transformation fallback.
   - Lines 113–123: Populates telemetry with `scrfdPassMs`, `frontalizationMs`, `frontalizationMethod`, and estimated pose angles (`estimatedYaw`, `estimatedPitch`, `estimatedRoll`).

5. **Empirical Execution Commands & Results**:
   - `npm run typecheck`: Executed `tsc --noEmit` cleanly with exit code 0 and 0 errors.
   - `npm test`: Executed `node --experimental-strip-types --test ...` with 277/277 unit tests passing across 95 test suites (100% pass rate, 0 failures, 0 skipped).
   - `npm run build`: Executed Vercel Nitro build (`copy-ort-assets`, Vite client/SSR bundles, Vercel output) cleanly with exit code 0.
   - Empirical Challenger Harness (`src/lib/face/m2-empirical-challenger.test.ts`):
     - Confirmed exact multi-stride anchor count: 16,800 total.
     - Confirmed head pose estimation: frontal ($\text{yaw} \approx 0^\circ$), turn left ($\text{yaw} > 25^\circ$), turn right ($\text{yaw} < -25^\circ$), roll ($45^\circ$).
     - Confirmed 5-point Umeyama similarity transformation exact reconstruction of scale ($1/S$), rotation ($-\theta$), and translation.

---

## 2. Logic Chain

1. **Requirement R2 Alignment**:
   - R2 requires replacing legacy face detection with SCRFD-2.5G ONNX execution. Observation 1 confirms `src/lib/face/scrfd.ts` implements multi-stride anchor generation (16,800 anchors), tensor decoding, score filtering ($\ge 0.40$), NMS (IoU $0.40$), 5-point landmark extraction, and 3D head pose estimation.
   - R2 requires Expression-Aware 3D UV WGSL frontalization (`ExpNorm`) with 10-basis blendshape residual subtraction for high-pose inputs ($|\text{yaw}| > 25^\circ$) with 5-point similarity transformation fallback for low-pose inputs ($|\text{yaw}| \le 25^\circ$). Observations 2, 3, & 4 confirm `exp-norm-wgsl.ts`, `similarity-transform.ts`, and `pipeline.ts` implement exact WGSL compute shaders, 10-basis residual subtraction, 5-point Umeyama similarity transform, and routing logic.

2. **Empirical Verification of Core Algorithmic Claims**:
   - **Multi-stride Anchors**: Verified $12,800$ (stride 8) + $3,200$ (stride 16) + $800$ (stride 32) = $16,800$ anchors (Observation 5).
   - **Head Pose Estimation**: Tested 5-point landmark configurations for frontal, left turn ($\text{yaw} > 25^\circ$), right turn ($\text{yaw} < -25^\circ$), and roll tilt ($45^\circ$). All angle outputs were mathematically correct and bounded (Observation 5).
   - **Umeyama Similarity Transform**: Verified matrix solver $(A^T A) X = A^T B$ correctly recovers scale, rotation, and translation without NaNs or numerical degradation on degenerate inputs (Observation 3 & 5).
   - **ExpNorm Compute Shader**: Verified WGSL shader structure, uniform layout (128 bytes), canonical blendshape bases generation ($2,207,744$ bytes), and safe fallback execution (Observation 2 & 5).

3. **Build & Type Safety Integrity**:
   - Static type checking via `tsc --noEmit` passed with 0 errors.
   - Unit test suite executed 277 tests with 100% pass rate.
   - Nitro production build succeeded emitting Vercel static and SSR assets.

---

## 3. Caveats

- **WebGPU Runtimes**: Node.js CLI environment does not include native WebGPU (`navigator.gpu`). WebGPU execution was verified via mocked device interfaces and CPU reference function equality, while safe failover to 5-point similarity transform / CPU execution was verified empirically in the CLI.

---

## 4. Conclusion

### Explicit Verdict: APPROVE

Milestone 2 implementation satisfies all technical, architectural, and verification requirements specified in `PROJECT.md` and `ORIGINAL_REQUEST.md`. SCRFD-2.5G detection, pose estimation, ExpNorm WGSL 3D UV frontalization, 5-point Umeyama similarity fallback, typechecking, unit tests, and Vercel build have been empirically verified and pass cleanly.

---

## 5. Verification Method

To independently reproduce this verification:

1. **TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected result*: Exits with code 0 and 0 errors.

2. **Unit Test Suite**:
   ```bash
   npm test
   ```
   *Expected result*: 277 tests passing across 95 suites with 0 failures.

3. **Production Build Verification**:
   ```bash
   npm run build
   ```
   *Expected result*: Vercel Nitro build completes with exit code 0.

4. **Empirical Harness Execution**:
   ```bash
   node --experimental-strip-types --test src/lib/face/m2-empirical-challenger.test.ts
   ```
   *Expected result*: Passes all empirical anchor, pose, Umeyama, and WGSL shader consistency tests.

---

## Adversarial Review & Stress Test Results

### Challenge Summary
- **Overall Risk Assessment**: LOW
- **Assumptions Tested**:
  1. *Degenerate or collinear 5-point landmarks in Umeyama solver*: Handled gracefully via Gaussian elimination pivot checks ($|\text{pivot}| < 1e-10$), returning identity matrix fallback without NaNs or crashes.
  2. *Extreme yaw and pitch poses ($|\text{yaw}| > 60^\circ$)*: Pose estimation clamps $\delta_{\text{yaw}}$ into $[-1.0, 1.0]$ before computing $\arcsin$, preventing NaN angle values.
  3. *WebGPU device unavailability or shader execution failure*: `runExpNormFrontalizationWGSL` catches GPU errors and falls back to `align5PointSimilarityTensor` seamlessly.
  4. *Multi-stride anchor indexing for non-standard aspect ratios*: `generateAnchors` uses `Math.ceil(dim / stride)` to ensure full coverage of input image area.

- **Unchallenged Areas**: None within Milestone M2 scope.
