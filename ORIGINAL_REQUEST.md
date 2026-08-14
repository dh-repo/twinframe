# Original User Request

## 2026-08-13T18:06:58Z

Elevate the mathematical accuracy, geometric measurement fidelity, and two-stage candidate matching in Twinframe by implementing 3D canonical face mesh unwarping and anatomical ratio normalization within a pure in-browser TypeScript client runtime.

Working directory: /Users/damian/GitHub/twinframe
Integrity mode: development

## Requirements

### R1. 3D Canonical Alignment & Pose-Invariant Landmark Unwarping
Upgrade `src/lib/face/geometry.ts` and `src/lib/face/pose.ts` with a 3D canonical face mesh model alignment (Generalized Procrustes Analysis or depth-compensated orthographic projection) so that face landmarks extracted under yaw/pitch (up to ±35°) are projected to a canonical frontal plane before computing morphological ratios.

### R2. Comprehensive Anatomical Ratio & Morphology Vectorization
Expand `FaceFeatures` and geometric feature extraction to compute clinically-grounded facial proportions:
- Facial thirds (trichion-to-glabella, glabella-to-subnasale, subnasale-to-menton) and fifths
- Inter-canthal distance & canthal tilt angle
- Nasal index (alar width vs. nasal bridge length)
- Bigonial-to-bizygomatic width ratio & gonial jawline contour angle
- Lip vermilion height ratio and philtrum depth

### R3. Pure In-Browser Client Constraints & Performance
Ensure all mathematical transformations, matrix decompositions, and geometric normalizations run efficiently in pure TypeScript/JavaScript with zero backend dependencies, completing full feature extraction and matching in < 15ms per frame on typical client hardware.

### R4. Calibrated Multi-Stage Similarity & Gating
Update `src/lib/face/match.ts` and `src/lib/face/embeddings.ts` to combine normalized canonical morphological distances with 128-d deep vector representations, applying calibrated hill-curve similarity gating that preserves strict lookalike separation and prevents cross-demographic false positives.

### R5. Quantitative Benchmark & Invariance Test Harness
Expand `src/lib/face/match-accuracy.test.ts` and evaluation scripts with automated regression and perturbation benchmarks (testing synthetic yaw/pitch rotations, lighting variations, and twin/lookalike distinction) asserting strict variance bounds and match precision.

## Acceptance Criteria

### Geometric Pose Invariance
- [ ] Landmark geometric ratios exhibit < 3.5% variance across yaw rotations up to ±30° and pitch up to ±20°.
- [ ] Procrustes/canonical alignment algorithm handles asymmetric and partially occluded landmark subsets gracefully without throwing NaN or out-of-bound errors.

### Matching Precision & Separation
- [ ] Matching accuracy on benchmark test suite achieves > 96.0% Top-1 precision.
- [ ] Lookalike discrimination threshold guarantees that non-matching/dissimilar profiles score < 20% or are cleanly filtered.

### Performance & Build Verification
- [ ] `npm run typecheck`, `npm run build`, and all unit tests in `npm run test` pass with zero failures.
- [ ] Feature extraction and two-stage ranking execute in < 15 ms in browser/Node test environments.
