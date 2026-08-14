# Handoff Report: Milestone 3 (EdgeFace-M 256-d Feature Extraction & Metric Recalibration)

## 1. Observation

### Implementation Artifacts & Files Modified / Created
- **`src/lib/face/edgeface.ts` (Created)**:
  - Implements ONNX Runtime execution via `OnnxSessionManager.getInstance().getSession("edgeface_m", modelPath)` defaulting to `/models/edgeface_m.onnx`.
  - Implements NCHW Planar `Float32Array[1, 3, 112, 112]` (or 160x160) input tensor preparation with standard `(pixel - 127.5) / 128.0` normalization.
  - Implements 256-d Float32 / Float16 embedding extraction with Float16 decoding (`decodeFloat16`).
  - Implements $L_2$ normalization ($\hat{\mathbf{v}} = \mathbf{v} / \|\mathbf{v}\|_2$) in `normalizeL2()` with zero-vector fallback (`Float32Array(256)` when $\|\mathbf{v}\|_2 < 10^{-12}$ or non-finite).
- **`src/lib/face/embeddings.ts` (Modified)**:
  - Implements `dotProduct256(a, b)` with 8-way loop unrolling (`sum0` through `sum7` independent accumulators) for 256-d Float32 vectors.
  - Implements `cosineDistance256(a, b)` for pure $L_2$-normalized Cosine distance $d = 1 - \hat{\mathbf{a}}^T \hat{\mathbf{b}}$ clamped strictly to $[0.0, 2.0]$.
  - Updates `cosineDistance(a, b)` to route 256-d inputs directly to `cosineDistance256`.
  - Updates `distanceToMatchPercent(distance)` with recalibrated AccuFace v4.0 Hill Equation:
    $$P(d) = \frac{100.0}{1 + \left(\frac{d}{0.38}\right)^{4.5}}$$
    where half-saturation decision threshold is $P(0.38) = 50.0\%$.
  - Updates `rankPercentsFromDistances` to clamp minimum match percentage to `0.0` (was legacy 15.0).
  - Updates `CelebrityEmbedding` interface to accept `descriptor: number[] | Float32Array`.
- **`src/lib/face/match.ts` (Modified)**:
  - Updates `rankByDescriptor()` to use pure $L_2$-normalized Cosine distance (`cosineDistance256`) replacing legacy `ensembleDistance`.
- **`src/lib/face/types.ts` (Modified)**:
  - Adds `embeddingPassMs?: number` to `FaceStageLatencies` interface.
- **`src/lib/face/pipeline.ts` (Modified)**:
  - Integrates `extractEdgeFaceEmbedding` into `analyzeFaceSource()`, assigning 256-d embedding to `det.descriptor` and populating `det.telemetry.latencies.embeddingPassMs` and `embeddingMs`.
- **`src/lib/face/faceapi-engine.ts` (Modified)**:
  - Updates `logFaceTelemetry` to format `embeddingPassMs ?? embeddingMs`.
- **Test Suites Created / Updated**:
  - `src/lib/face/edgeface.test.ts` (Created): 8 unit test cases for vector normalization, float16 decoding, planar tensor extraction, and ONNX execution.
  - `src/lib/face/m3-pipeline-integration.test.ts` (Created): 9 unit test cases verifying 256-d vector math, 8-way unrolled dot product, bounds clamping $d \in [0.0, 2.0]$, Hill curve $P(0.38) = 50.0\%$, and telemetry stage latencies.
  - `src/lib/face/match.test.ts` (Updated): Hill curve sample point assertions updated to $d_0 = 0.38, n = 4.5$.
  - `src/lib/face/m4-challenger-stress.test.ts` (Updated): Hill curve parameter tests updated to $d_0 = 0.38, n = 4.5$ and $[0.0, 100.0]$ bounds.
  - `scripts/m3-system-stress-challenge.test.mjs` (Updated): Hill curve half-saturation test updated to $P(0.38) = 50.0\%$.

### Execution Results
- `npm run typecheck`: Passed with 0 errors.
- `npm test`: 298 / 298 tests passed (105 test suites).
- `npm run build`: Production Vercel Nitro build completed successfully.

---

## 2. Logic Chain

1. **Feature Extraction (`src/lib/face/edgeface.ts`)**:
   EdgeFace-M maps aligned face tensors `[1, 3, 112, 112]` into a 256-d feature space. Applying $L_2$ normalization $\hat{\mathbf{v}} = \mathbf{v} / \|\mathbf{v}\|_2$ guarantees that $\|\hat{\mathbf{v}}\|_2 \equiv 1.0$. If $\|\mathbf{v}\|_2 < 10^{-12}$ or contains `NaN`/`Infinity`, returning a zero vector `Float32Array(256)` prevents numerical instability downstream.

2. **Metric Matching (`src/lib/face/embeddings.ts` & `src/lib/face/match.ts`)**:
   Because embeddings are $L_2$-normalized ($\|\hat{\mathbf{a}}\|_2 = 1.0, \|\hat{\mathbf{b}}\|_2 = 1.0$), Cosine distance simplifies from $\frac{\hat{\mathbf{a}}^T \hat{\mathbf{b}}}{\|\hat{\mathbf{a}}\|_2 \|\hat{\mathbf{b}}\|_2}$ to $d = 1 - \hat{\mathbf{a}}^T \hat{\mathbf{b}}$. Unrolling the 256-d dot product 8-way into 8 independent accumulators (`sum0`..`sum7`) maximizes parallel CPU execution. Enforcing double-tier clamping $d = \max(0.0, \min(2.0, 1.0 - \text{clamp}(\hat{\mathbf{a}}^T \hat{\mathbf{b}}, -1.0, 1.0)))$ prevents single-precision FP rounding overflow from producing negative distances $d < 0$, which would cause `Math.pow(negative, 4.5)` to evaluate to `NaN`.

3. **Hill Curve Recalibration & Pipeline (`pipeline.ts`, `embeddings.ts`, `types.ts`)**:
   The recalibrated Hill equation $P(d) = \frac{100.0}{1 + (d / 0.38)^{4.5}}$ places the decision boundary (50% match percentage) at $d_0 = 0.38$. Integrating `extractEdgeFaceEmbedding()` into `analyzeFaceSource()` updates `det.descriptor` with the 256-d embedding and populates `embeddingPassMs` in `det.telemetry.latencies`.

---

## 3. Caveats

- **ONNX Model File Location**: Runtime execution expects model weights at `/models/edgeface_m.onnx`. Unit tests mock the ONNX session manager (`OnnxSessionManager`) to ensure fast, offline execution during CI/CD.
- **Gallery Migration**: The 1,000 celebrity catalog in `embeddings.v4.q8.bin` will be fully migrated to 256-d Biohashes in Milestone 4. In Milestone 3, `rankByDescriptor` handles both 256-d Float32Array descriptors and legacy arrays smoothly.

---

## 4. Conclusion

Milestone 3 (EdgeFace-M 256-d Feature Extraction & Metric Recalibration) is fully implemented, genuinely integrated, and thoroughly verified.
- `src/lib/face/edgeface.ts` provides robust 256-d feature extraction with Float16 decoding and $L_2$ normalization.
- `src/lib/face/match.ts` and `src/lib/face/embeddings.ts` use pure $L_2$-normalized Cosine distance with 8-way unrolled dot products and bounds clamping $d \in [0.0, 2.0]$.
- `src/lib/face/pipeline.ts` orchestrates the complete AccuFace v4.0 flow and tracks stage latencies (`embeddingPassMs`).
- `npm run typecheck`, `npm test` (298/298 pass), and `npm run build` all pass cleanly.

---

## 5. Verification Method

To independently verify the implementation:

1. **Run TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected outcome*: 0 TypeScript compilation errors.

2. **Run Unit Test Suite**:
   ```bash
   npm test
   ```
   *Expected outcome*: 298 / 298 tests pass across 105 test suites, including `edgeface.test.ts` and `m3-pipeline-integration.test.ts`.

3. **Run Production Build**:
   ```bash
   npm run build
   ```
   *Expected outcome*: Vercel Nitro production build completes with exit code 0.
