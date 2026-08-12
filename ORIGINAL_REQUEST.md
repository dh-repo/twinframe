# Original User Request

## 2026-08-12T00:23:41Z

Execute and validate the comprehensive 5-phase Twinframe Pipeline Master Test Plan covering pre-processing & detection, morphological landmark validation, extraction & 3D pose weighting, scoring math & Hill curve algorithms, and end-to-end load testing.

Working directory: /Users/damian/GitHub/twinframe
Integrity mode: development

## Requirements

### R1. Phase 1: Pre-Processing & Detection Audit
Validate 4K image rasterization with EXIF orientation (CW 90°), standard SSD MobileNet detection, CLAHE + TinyFace fallback under backlit/underexposed sunset conditions, and multi-scale tiling on 8K group photos with 15+ faces.

### R2. Phase 2: Morphological Validation Boundary Test Suite
Construct a dedicated unit test suite for `isValidHumanFaceLandmarks68` asserting exact boundary conditions:
- **GEO-01:** Upside-down / inverted ordering returns `false`.
- **GEO-02 / GEO-03:** Inter-ocular distance (IOD) threshold at $3.9\%$ (rejected) vs $4.0\%$ (accepted).
- **GEO-04:** Eye level tilt threshold at $71\%$ IOD (rejected).
- **GEO-05 / GEO-06:** Eye-to-mouth ratio (EMD/IOD) at $0.44$ (rejected) vs $2.51$ (rejected).
- **GEO-07:** Non-face pareidolia rejection (e.g. house/clouds).

### R3. Phase 3: Extraction & 3D Pose Weighting Assertions
Validate high-res 320x320 crop dimensions (`CROP-01`), 128-d output vector length (`EMB-01`), L2-normalization norm $= 1.0$ (`EMB-02`), and 3D pose dynamic weight scaling ($w_{\text{geom}} = 0.10 \times \cos(\text{yaw})$) across $10^\circ, 14.9^\circ, 20^\circ, 80^\circ$ yaw angles (`POS-01` to `POS-04`).

### R4. Phase 4: Scoring Math & Hill Curve Exact Calibration
Unit test hybrid ensemble distance ($\text{Dist} = 0.90E + 0.42C$, `ALG-01`) and calibrated Hill curve similarity ($P(d) = 15.0 + 85.0 / (1 + (d/0.32)^{3.5})$) at exact points:
- `CUR-01` ($d = 0.0 \rightarrow 100.0\%$)
- `CUR-02` ($d = 0.32 \rightarrow 57.5\%$)
- `CUR-03` ($d = 1.0 \rightarrow \approx 16.2\%$)
- `CUR-04` ($d = 2.0 \rightarrow \approx 15.1\%$)

### R5. Phase 5: E2E Golden Path & TF.js Memory Profiling
Validate >95% Rank-1 accuracy on celebrity golden path queries, verify zero TF.js tensor memory leaks (`tf.memory().numTensors` returns to baseline after 1,000 iterations), and assert CLAHE + TinyFace 100-batch execution SLA stays under 5,000ms.

## Acceptance Criteria

### Verification & Test Master Suite
- [ ] Phase 1 (PRE-01 to PRE-04) detection and rasterization tests pass 100%.
- [ ] Phase 2 (GEO-01 to GEO-07) landmark boundary tests pass 100%.
- [ ] Phase 3 (CROP-01, EMB-01, EMB-02, POS-01 to POS-04) crop & pose assertions pass 100%.
- [ ] Phase 4 (ALG-01, CUR-01 to CUR-04) mathematical curve assertions pass with $\pm 0.1\%$ precision.
- [ ] Phase 5 E2E golden path accuracy > 95%, 0 TF.js tensor memory leaks, and batch SLA < 5,000ms.

### Build & Integration Integrity
- [ ] `npm test` passes 100% of unit and master plan test suites.
- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm run build` completes cleanly.

## 2026-08-12TAPPROVED — Teamwork Prompt (gap-fill, integrity development)

# Twinframe Pipeline Master Test Plan — Execute & Validate

Working directory: /Users/damian/GitHub/twinframe
Integrity mode: development
Pattern: Project (orchestrator → explorers → workers → reviewers → challengers → forensic auditor → victory auditor)

## Mission

Execute and validate the comprehensive **5-phase Twinframe Pipeline Master Test Plan**.
Survey first; reuse green phase suites; only implement or repair gaps.

Existing candidate suites:
- `src/lib/face/phase1-preprocessing-detection.test.ts` (PRE-01..04)
- `src/lib/face/phase2-morphology-boundary.test.ts` (GEO-01..07)
- `src/lib/face/phase3-extraction-pose.test.ts` (CROP/EMB/POS)
- `src/lib/face/phase4-scoring-math.test.ts` + `phase4-empirical-harness.test.ts` (ALG/CUR)
- `src/lib/face/phase5-e2e-profiling.test.ts` (E2E-01..03)

## Spec corrections
- CUR-03: d=1.0 → **16.5%** (unrounded ≈16.547%), not 16.2%
- POS: w_geom = round3(0.10 * max(0.2, cos(|yaw|))) → 0.098 / 0.097 / 0.094 / 0.020

## Acceptance
- PRE/GEO/CROP/EMB/POS/ALG/CUR/E2E IDs pass 100%
- npm test, typecheck, build clean
- Rank-1 >95%, 0 TF.js leaks, batch SLA <5000ms
- No accuracy cheats / oracles / fake maps

