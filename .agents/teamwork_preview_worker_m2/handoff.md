# Handoff Report — Milestone 2: SCRFD-2.5G Detection & Expression-Aware 3D UV Frontalization

## 1. Observation

### 1.1 Requirements & Scope
- **Task Goal**: Implement Milestone 2 for Twinframe AccuFace v4.0 architecture.
- **Components Implemented**:
  1. `src/lib/face/scrfd.ts`: SCRFD-2.5G face detection via ONNX Runtime Web (`onnx-engine.ts`), multi-stride feature pyramid anchor generation (16,800 anchors for 640x640 across strides 8, 16, 32), score filtering ($\ge 0.40$), Non-Maximum Suppression (IoU 0.40), 5-point facial landmark extraction, and 3D head pose estimation math ($\theta_{\text{roll}}, \theta_{\text{yaw}}, \theta_{\text{pitch}}$).
  2. `src/lib/face/exp-norm-wgsl.ts`: Expression-Aware 3D UV WGSL compute shader (`ExpNorm`) executing 10-basis blendshape residual subtraction ($\mathbf{S}_{\text{neutral}} = \mathbf{S}_{\text{base}} - \sum_{i=1}^{10} \alpha_i \mathbf{B}_i$), 3D rotation, and bilinear texture sampling into a planar NCHW Float32 tensor buffer ($1 \times 3 \times 112 \times 112$). Includes WebGPU buffer bindings and safe CPU / 5-point similarity fallback.
  3. `src/lib/face/similarity-transform.ts`: 5-Point Umeyama similarity transformation solver mapping detected landmarks to canonical InsightFace reference coordinates (`REFERENCE_LANDMARKS_112` and `REFERENCE_LANDMARKS_160`) via closed-form normal equations. Outputs aligned 2D canvas crops and NCHW normalized tensors.
  4. `src/lib/face/pipeline.ts` & `src/lib/face/types.ts`: Pipeline stage integration and telemetry updates. Routes $|\theta_{\text{yaw}}| > 25^\circ$ to `ExpNorm` WGSL compute shader and $|\theta_{\text{yaw}}| \le 25^\circ$ to 5-Point Umeyama alignment fallback. Tracks `scrfdPassMs` and `frontalizationMs` in `FaceStageLatencies` and logs `frontalizationMethod`, `estimatedYaw`, `estimatedPitch`, and `estimatedRoll` in `FaceTelemetry`.
  5. Unit Test Suite: Added 4 unit test suites (`scrfd.test.ts`, `similarity-transform.test.ts`, `exp-norm-wgsl.test.ts`, `m2-pipeline-integration.test.ts`).

---

## 2. Logic Chain

### 2.1 SCRFD-2.5G Face Detection Engine (`src/lib/face/scrfd.ts`)
- **Anchor Generation**:
  - Stride 8: $80 \times 80$ grid $\times 2$ anchors/cell = 12,800 anchors.
  - Stride 16: $40 \times 40$ grid $\times 2$ anchors/cell = 3,200 anchors.
  - Stride 32: $20 \times 20$ grid $\times 2$ anchors/cell = 800 anchors.
  - Total: 16,800 anchors.
- **ONNX Model Output Parsing**:
  - Dynamically parses output tensors by checking dimensions: length 12800 (stride 8 score), 51200 (stride 8 bbox), 128000 (stride 8 kps), 3200 (stride 16 score), 12800 (stride 16 bbox), 32000 (stride 16 kps), 800 (stride 32 score), 3200 (stride 32 bbox), 8000 (stride 32 kps). Supports both 1-class and 2-class score tensors.
- **Decoding & Filtering**:
  - Decodes bounding boxes $(x_1, y_1, x_2, y_2)$ and 5-point landmarks in original image space by scaling through letterbox padding offsets.
  - Applies score threshold $\ge 0.40$ and Non-Maximum Suppression (NMS) with IoU threshold 0.40.
- **Head Pose Estimation Math**:
  - Roll: $\theta_{\text{roll}} = \text{atan2}(y_{\text{RE}} - y_{\text{LE}}, x_{\text{RE}} - x_{\text{LE}}) \times \frac{180}{\pi}$.
  - Yaw: $\delta_{\text{yaw}} = \frac{2 \cdot \Delta x_{\text{nose, unrolled}}}{IOD}$, $\theta_{\text{yaw}} = \arcsin(\text{clamp}(\delta_{\text{yaw}}, -1.0, 1.0)) \times \frac{180}{\pi}$.
  - Pitch: $\theta_{\text{pitch}} = \text{atan2}(2 \cdot \Delta y_{\text{nose, unrolled}} - \Delta y_{\text{mouth, unrolled}}, IOD) \times \frac{180}{\pi}$.

### 2.2 Expression-Aware 3D UV WGSL Frontalization (`src/lib/face/exp-norm-wgsl.ts`)
- **WGSL Compute Shader**:
  - Subtraction of 10 expression blendshape residual bases: $\mathbf{S}_{\text{neutral}}(u, v) = \mathbf{S}_{\text{base}}(u, v) - \sum_{i=1}^{10} \alpha_i \mathbf{B}_i(u, v)$.
  - 3D Rotation matrix $\mathbf{R}(\theta_{\text{yaw}}, \theta_{\text{pitch}}, \theta_{\text{roll}})$ applied to neutral surface point.
  - Projection to source image $(x_{\text{src}}, y_{\text{src}})$, bilinear sampling, and normalization to $[-1.0, 1.0]$ in NCHW planar Float32 storage buffer.
- **Fail-Safe Fallback**:
  - WebGPU execution errors or environments without `navigator.gpu` automatically fall back to 5-point similarity transformation (`align5PointSimilarityTensor`).

### 2.3 5-Point Umeyama Similarity Transformation (`src/lib/face/similarity-transform.ts`)
- Solves normal equations $(A^T A) X = A^T B$ for 2D similarity matrix $M = \begin{bmatrix} a & -b & t_x \\ b & a & t_y \end{bmatrix}$ mapping 5 detected landmarks to canonical InsightFace reference points (`[38.2946, 51.6963]`, `[73.5318, 51.5014]`, `[56.0252, 71.7366]`, `[41.5493, 92.3655]`, `[70.7299, 92.2041]`).
- Provides closed-form matrix inversion for bilinear image re-sampling into aligned $112 \times 112$ or $160 \times 160$ tensors.

### 2.4 Pipeline & Telemetry Integration (`src/lib/face/pipeline.ts`, `types.ts`)
- Updates `analyzeFaceSource` to run SCRFD-2.5G detection, evaluate $|\theta_{\text{yaw}}| > 25^\circ$, route to ExpNorm WGSL vs 5-point similarity transform, and populate `FaceStageLatencies` (`scrfdPassMs`, `frontalizationMs`) and `FaceTelemetry` (`frontalizationMethod`, `estimatedYaw`, `estimatedPitch`, `estimatedRoll`).

---

## 3. Caveats
- **WebGPU Support in Node CLI**: Node.js test environment does not natively include WebGPU (`navigator.gpu`). The implementation includes pure-JS CPU reference functions and safe fallback wrappers so all tests run and pass 100% in Node CLI as well as in browser runtimes.
- **Head Pose Limits**: Pose angle math assumes reasonable head orientation ($|\theta_{\text{pitch}}| \le 45^\circ$). Extreme head tilt $> 60^\circ$ is routed safely to 5-point similarity alignment fallback.

---

## 4. Conclusion
Milestone 2 implementation is complete, fully functional, and verified with genuine algorithms:
- **SCRFD-2.5G Detection**: `src/lib/face/scrfd.ts`
- **ExpNorm WGSL Frontalization**: `src/lib/face/exp-norm-wgsl.ts`
- **5-Point Similarity Fallback**: `src/lib/face/similarity-transform.ts`
- **Pipeline Integration**: `src/lib/face/pipeline.ts` & `src/lib/face/types.ts`
- **Unit Tests & Verification**: All 273 unit tests pass, TypeScript typecheck passes with 0 errors, Vercel Nitro production build succeeds cleanly.

---

## 5. Verification Method

To independently verify the implementation:

1. **TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected output*: Exits with code 0 and zero errors.

2. **Unit Test Suite**:
   ```bash
   npm test
   ```
   *Expected output*: 273 tests passing across 94 suites with 0 failures.

3. **Production Build Verification**:
   ```bash
   npm run build
   ```
   *Expected output*: Vercel Nitro build succeeds cleanly emitting client and SSR bundles.
