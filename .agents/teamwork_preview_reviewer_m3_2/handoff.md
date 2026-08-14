# Handoff Report: Milestone 3 Review (EdgeFace-M 256-d Feature Extraction & Metric Recalibration)

## 1. Observation

### Codebase Changes Inspected
- **`src/lib/face/edgeface.ts`**:
  - `computeL2Norm(v)` (lines 21–28): Computes $\|\mathbf{v}\|_2 = \sqrt{\sum v_i^2}$.
  - `normalizeL2(embedding)` (lines 34–45): Applies $L_2$ normalization $\hat{\mathbf{v}} = \mathbf{v} / \|\mathbf{v}\|_2$. Contains numerical zero-vector & non-finite fallback:
    ```ts
    if (!Number.isFinite(norm) || norm < 1e-12) {
      return out; // Return zeroed Float32Array(256)
    }
    ```
    Per-element assignment includes `Number.isFinite(val) ? val : 0`.
  - `decodeFloat16(val)` (lines 50–62): Decodes IEEE 754 half-precision bits (`Uint16`) to single-precision float (`number`), handling zero, denormals, subnormals, Infinities, and NaNs.
  - `extractPlanarTensorFromCanvas(source, targetSize)` (lines 68–112): Prepares NCHW planar `Float32Array[1, 3, 112, 112]` (37,632 float elements) with standardized `(pixel - 127.5) / 128.0` scaling.
  - `extractEdgeFaceEmbedding(source, landmarks, options)` (lines 118–178): Runs ONNX Runtime Web session (`/models/edgeface_m.onnx`) with WebGPU WGSL / WASM SIMD execution, extracts output, decodes Float16/Float32, and returns $L_2$-normalized 256-d embedding with execution latency `latencyMs`.

- **`src/lib/face/embeddings.ts`**:
  - `dotProduct256(a, b)` (lines 243–265): 8-way loop unrolling with 8 independent accumulators (`sum0` through `sum7`) for 256-d Float32 vectors to break instruction dependency latency chains.
  - `cosineDistance256(a, b)` (lines 271–278): Pure $L_2$-normalized Cosine distance $d = 1 - \hat{\mathbf{a}}^T \hat{\mathbf{b}}$. Clamps raw dot product to $[-1.0, 1.0]$ and distance to $[0.0, 2.0]$.
  - `distanceToMatchPercent(distance)` (lines 318–324): Recalibrated AccuFace v4.0 Hill Equation:
    $$P(d) = \frac{100.0}{1 + \left(\frac{d}{0.38}\right)^{4.5}}$$
    - $P(0.0) = 100.0\%$
    - $P(0.38) = 50.0\%$ (half-saturation decision boundary)
    - NaN fallback: `if (Number.isNaN(distance)) return 0.0;`
    - Lower bound clamping: `Math.max(0, distance)`
    - Output bounds clamping: `Math.max(0.0, Math.min(100.0, hill))`

- **`src/lib/face/match.ts`**:
  - `rankByDescriptor(user, gallery, topK)` (lines 33–90): Calculates distance using `cosineDistance256(user.descriptor, celeb.descriptor)` and applies recalibrated match percentage mapping.

- **`src/lib/face/pipeline.ts`**:
  - `analyzeFaceSource(...)` (lines 56–237): Integrates Stage 3 `extractEdgeFaceEmbedding(alignedTensor ?? source, scrfdResult?.primary?.landmarks)`, updates `det.descriptor` with 256-d vector, and sets `det.telemetry.latencies.embeddingPassMs` and `embeddingMs`.

- **`src/lib/face/types.ts`**:
  - `FaceStageLatencies` interface (lines 120–141): Includes `embeddingPassMs?: number` alongside `embeddingMs: number`.

### Unit Test Suites Inspected
- `src/lib/face/edgeface.test.ts`: 8 test cases verifying L2 normalization, zero-vector fallbacks, IEEE 754 Float16 bit decoding, NCHW planar tensor extraction, and ONNX session execution.
- `src/lib/face/m3-pipeline-integration.test.ts`: 9 test cases verifying 256-d vector math, 8-way unrolled dot product, bounds clamping $d \in [0.0, 2.0]$, Hill curve $P(0.38) = 50.0\%$, monotonicity across $[0.0, 2.0]$, boundary values (`-0.5`, `Infinity`, `NaN`), and telemetry latency fields.

### Verification Commands & Results Executed
1. `npm run typecheck`:
   ```text
   > typecheck
   > tsc --noEmit
   (Exit code 0, 0 errors)
   ```
2. `npm test`:
   ```text
   ℹ tests 298
   ℹ suites 105
   ℹ pass 298
   ℹ fail 0
   (Exit code 0, 100% pass)
   ```
3. `npm run build`:
   ```text
   [ORT Build] Copied 5 ONNX Runtime WASM assets to public/models/ort/
   ✓ built in 1.28s
   ✓ built in 831ms
   [nitro] ✔ Generated public .vercel/output/static
   (Exit code 0, Vercel Nitro build succeeded)
   ```

---

## 2. Logic Chain

1. **Numerical Stability & Zero-Vector Fallbacks**:
   - In `edgeface.ts`, `normalizeL2()` evaluates `computeL2Norm(embedding)`. If `norm < 1e-12` or non-finite, it returns a zeroed `Float32Array(256)`. Each vector element division is verified finite (`Number.isFinite(val) ? val : 0`), preventing `NaN` or `Infinity` from entering downstream calculations.
   - In `embeddings.ts`, `cosineDistance256()` checks for invalid or empty inputs (returning `1.0`). Clamping `rawDot` to `[-1.0, 1.0]` before evaluating `1.0 - dot` prevents single-precision floating-point rounding errors (e.g. $1.0000001$) from yielding negative distances $d < 0$.
   - In `distanceToMatchPercent()`, clamping $d \ge 0$ prevents `Math.pow(negative, 4.5)` from producing `NaN`.

2. **Recalibrated Hill Curve Sigmoid Parameters**:
   - The Hill equation parameters $d_0 = 0.38$ and exponent $n = 4.5$ are correctly parameterized in `distanceToMatchPercent`:
     `100.0 / (1 + Math.pow(d / 0.38, 4.5))`.
   - At $d = 0$, $P(0) = 100.0 / (1 + 0) = 100.0\%$.
   - At $d = 0.38$, $P(0.38) = 100.0 / (1 + 1^{4.5}) = 50.0\%$.
   - Strict monotonicity is verified across $d \in [0.0, 2.0]$ in `m3-pipeline-integration.test.ts`.

3. **Pipeline & Telemetry Integration**:
   - `analyzeFaceSource` in `pipeline.ts` executes `extractEdgeFaceEmbedding()` following SCRFD-2.5G face detection and WGSL ExpNorm / 5-point similarity frontalization.
   - `embeddingPassMs` is recorded in `det.telemetry.latencies` and propagated through `logFaceTelemetry()`.

4. **Integrity & Code Quality Check**:
   - No hardcoded test results, facade implementations, or fake shortcuts exist in `edgeface.ts`, `embeddings.ts`, `match.ts`, or `pipeline.ts`.
   - All tests run real calculations against actual functions.

---

## 3. Caveats

- **Runtime ONNX Model Weights**: Real WebGPU execution relies on `/models/edgeface_m.onnx`. Unit test suites mock `OnnxSessionManager.getSession()` for fast offline CI testing, while E2E / browser smoke tests test real execution.
- **Gallery Format**: Full 512-bit Biohash migration of the celebrity catalog takes place in Milestone 4. In Milestone 3, descriptor matching handles both 256-d Float32Array descriptors and legacy arrays.

---

## 4. Conclusion

**Verdict: APPROVE**

Milestone 3 (EdgeFace-M 256-d Feature Extraction & Metric Recalibration) satisfies all requirements:
1. Feature extraction in `edgeface.ts` produces $L_2$-normalized 256-d vectors with zero-vector and Float16 fallbacks.
2. Distance metric in `embeddings.ts` uses 8-way loop unrolling for Cosine distance $d = 1 - \hat{\mathbf{a}}^T \hat{\mathbf{b}}$ with double-tier bounds clamping $[0.0, 2.0]$.
3. Match percentage mapping correctly implements the AccuFace v4.0 Hill Equation ($d_0 = 0.38, n = 4.5$), placing the decision threshold at $P(0.38) = 50.0\%$.
4. Stage latencies (`embeddingPassMs`) are fully integrated into telemetry and pipeline orchestration.
5. `npm run typecheck`, `npm test` (298/298 passed), and `npm run build` all pass with zero errors.

---

## 5. Verification Method

To re-verify this assessment:

1. **TypeScript Type Check**:
   ```bash
   npm run typecheck
   ```
   *Expected result*: Exit code 0, zero errors.

2. **Unit Test Suite**:
   ```bash
   npm test
   ```
   *Expected result*: 298 / 298 tests pass across 105 test suites.

3. **Production Build**:
   ```bash
   npm run build
   ```
   *Expected result*: Nitro production build completes with exit code 0.
