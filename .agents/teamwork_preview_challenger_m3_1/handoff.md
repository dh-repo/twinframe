# Milestone 3 Handoff Report: EdgeFace-M 256-d Feature Extraction & Metric Recalibration Verification

## 1. Observation

- **Target Files Inspected & Verified**:
  - `src/lib/face/edgeface.ts` (EdgeFace-M ONNX extraction, Float16 decoding `decodeFloat16`, L2 normalization `normalizeL2`, NCHW tensor layout `extractPlanarTensorFromCanvas`).
  - `src/lib/face/embeddings.ts` (8-way loop unrolled dot product `dotProduct256`, L2 Cosine distance `cosineDistance256`, recalibrated Hill Equation curve `distanceToMatchPercent`).
  - `src/lib/face/match.ts` (`rankByDescriptor` using 256-d Cosine distance as primary metric with age/gender priors).
  - `src/lib/face/pipeline.ts` (Integration of EdgeFace-M extraction in `analyzeFaceSource` and latency telemetry recording for `embeddingPassMs`).
  - `src/lib/face/types.ts` (`FaceStageLatencies` telemetry schema).

- **TypeScript Typecheck Command & Result**:
  - Command: `npm run typecheck`
  - Result: Exit code 0 (zero errors across 1,763 modules).

- **Vercel Nitro Build Command & Result**:
  - Command: `npm run build`
  - Result: Exit code 0 (successfully built client, SSR, and Vercel Nitro server assets).

- **Unit Test Command & Results**:
  - Command: `npm test`
  - Result: 314 tests passing across 112 suites in 501ms with 0 failures.

- **Empirical Stress Harness Created & Executed**:
  - File: `src/lib/face/m3-empirical-challenger.test.ts`
  - Tests included:
    1. IEEE 754 Float16 bit pattern decoding oracle (subnormals, zeros, normals, Infinities, NaNs).
    2. Vector L2 normalization oracle across 1,000 random 256-d vectors, sub-threshold vectors (< 1e-12), and non-finite vectors.
    3. 8-way unrolled dot product (`dotProduct256`) vs naive loop over 10,000 random vector pairs (max diff < 1e-5).
    4. Cosine distance clamping bounds $[0.0, 2.0]$ across identical, parallel, orthogonal, antipodal, and float-overflow vector pairs.
    5. Recalibrated Hill Equation curve ($d_0 = 0.38, n = 4.5$) exact checkpoint validation ($P(0) = 100.0, P(0.38) = 50.0, P(0.20) = 94.7, P(0.30) = 74.3, P(0.45) = 31.8, P(0.50) = 22.5$) and 10,000-step strict monotonic decay evaluation.
    6. End-to-end 1,000-celebrity gallery descriptor ranking latency (< 15ms) and rank ordering integrity.
    7. Mocked Float32 and Float16 ONNX session output parsing in `extractEdgeFaceEmbedding`.

## 2. Logic Chain

1. **Vector Dimension & L2 Normalization**:
   - `extractEdgeFaceEmbedding` extracts 256 Float32 or Float16 values from ONNX session output. Float16 values (stored in `Uint16Array`) are converted using `decodeFloat16` which correctly models sign, 5-bit exponent, and 10-bit mantissa (including subnormals).
   - `normalizeL2` computes $\|v\|_2 = \sqrt{\sum v_i^2}$. For valid non-zero vectors, it outputs $\hat{v} = v / \|v\|_2$. Empirical test 2 verifies $\|\hat{v}\|_2 = 1.0 \pm 1e-5$ across 1,000 random vectors. Near-zero ($< 1e-12$) or non-finite inputs are sanitized to zero vectors, preventing NaN/Infinity poisoning.

2. **L2 Cosine Distance Recalibration ($d = 1 - \hat{a}^T \hat{b}$)**:
   - `dotProduct256` uses 8-way loop unrolling (`sum0` through `sum7`) over 256 dimensions. Test 3 empirically proved `dotProduct256` matches standard loop reference over 10,000 random vector pairs within $1e-5$ tolerance.
   - `cosineDistance256` computes $d = 1 - \hat{a}^T \hat{b}$, clamping dot product to $[-1.0, 1.0]$ and distance to $[0.0, 2.0]$. Verified across identical ($d=0$), orthogonal ($d=1$), and antipodal ($d=2$) vector pairs.

3. **AccuFace v4.0 Hill Equation Curve ($d_0 = 0.38, n = 4.5$)**:
   - `distanceToMatchPercent(d)` computes $P(d) = \frac{100.0}{1 + (d / 0.38)^{4.5}}$, rounded to 1 decimal place.
   - Verified exact values: $P(0.0) = 100.0$, $P(0.38) = 50.0$, $P(0.20) = 94.7$, $P(0.30) = 74.3$, $P(0.45) = 31.8$, $P(0.50) = 22.5$.
   - Test 4 evaluated 10,000 steps between $d=0.0$ and $d=2.0$, confirming strict monotonic non-increasing property ($d_a < d_b \implies P(d_a) \ge P(d_b)$).

4. **Integration & Build Health**:
   - `rankByDescriptor` successfully utilizes `cosineDistance256` to score candidate embeddings against celebrity gallery members.
   - Stage latencies accurately record `embeddingPassMs` in `FaceStageLatencies`.
   - `npm run typecheck`, `npm test`, and `npm run build` all pass cleanly with zero errors.

## 3. Caveats

- **WebGPU EP Execution Environment**: In headless Node.js testing environments, ONNX Runtime Web executes using the WASM SIMD provider rather than native WebGPU WGSL. Both providers output compatible 256-d Float32 / Float16 tensors, and mock tests verified Float16 bit pattern decoding for WebGPU EP outputs.

## 4. Conclusion

Milestone 3 (EdgeFace-M 256-d Feature Extraction & Metric Recalibration) has passed all empirical verification tests, mathematical oracles, stress tests, typechecks, and build checks without defect.

**Verdict: APPROVE**

## 5. Verification Method

To independently verify this result, run the following commands from the repository root (`/Volumes/LaCie/GitHub/twinframe`):

1. **TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected output*: Exits 0 with no errors.

2. **Full Unit & Empirical Test Suite**:
   ```bash
   npm test
   ```
   *Expected output*: Passes 314/314 tests including `m3-empirical-challenger.test.ts` and `m3-pipeline-integration.test.ts`.

3. **Vercel Production Build**:
   ```bash
   npm run build
   ```
   *Expected output*: Exits 0, emitting `.vercel/output`.
