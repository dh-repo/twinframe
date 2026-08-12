# Project: Twinframe System Audit & Hardening

## Architecture
- `src/lib/face/faceapi-engine.ts`: Core face detection engine, multi-candidate scoring, CLAHE contrast boost, landmark extraction.
- `src/lib/face/pipeline.ts`: Full image processing pipeline (`analyzeFaceSource`, `generateDescriptor`), image scaling/downscaling, EXIF normalization, quality checks.
- `src/lib/face/geometry.ts`: 68-point facial landmark verification (`isValidHumanFaceLandmarks68`), geometric ratios.
- `src/lib/face/match.ts` & `embeddings.ts`: Embedding ensemble distance matching (`rankByDescriptor`), distance-to-percentage Hill curve scaling, confidence filtering.
- `src/components/capture/crop-review.tsx`: Viewport cropping UI, reticle box positioning, pan/zoom canvas controls, multi-person face candidate selection chips, final crop rendering.
- `src/components/scanning/face-scanning-hud.tsx` & `hud-transform.ts`: Animated HUD scanning overlay, matrix coordinate transformation from image space to screen reticle space.
- `src/components/app-home.tsx`: Top-level app state manager, flow transitions, quality warning dialogs, match result views.
- `src/lib/face/*.test.ts`: Automated test suites for face matching, geometry, pose quality, edge cases.
- `scripts/`: Benchmark and evaluation CLI scripts.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Non-Face Rejection | Reject non-face inputs (sunsets, landscapes, animals, dark frames, objects) with 100% precision and zero false matches. Fix boolean logic bug in `faceapi-engine.ts:1116`, tighten fallback detection thresholds, enforce landmark morphology bounds, integrate image quality metrics in `pipeline.ts`, and set a match distance floor in `match.ts`. | M1 | R1 |
| 2 | Multi-Person & Group Photo Candidate Precision | Fix group photo face scoring in `faceapi-engine.ts` (resolution-normalized center penalty), fix reticle box origin alignment for small faces, ensure candidate ranking prioritizes true human faces, and fix candidate selection. | M2 | R2 |
| 3 | Aspect Ratio & Coordinate Alignment Robustness | Fix `CropReview.tsx` offset double-subtraction, remove hardcoded 120px pan offset bounds for wide/tall ratios (9:16, 1:1, 4:3, 16:9, 21:9), and dynamically pass actual `selectedBox` to downstream `analyzeFaceSource`. | M3 | R3 |
| 4 | Automated Stress Test Suite & Edge-Case Benchmark | Add synthetic image fixture generator and 4 new headless unit test suites (`non-face-rejection.test.ts`, `group-photo-candidates.test.ts`, `aspect-ratio-alignment.test.ts`, `lighting-stress.test.ts`) to `src/lib/face/` and create `scripts/evaluate-edge-case-benchmark.ts`. | M4 | R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Non-Face & False Candidate Hardening | Fix `faceapi-engine.ts`, `geometry.ts`, `pipeline.ts`, `match.ts`, `app-home.tsx` for 100% non-face rejection | None | DONE |
| 2 | Multi-Person Candidate Selection | Fix candidate face scoring, reticle origin calculations, and candidate chip ordering | M1 | DONE |
| 3 | Aspect Ratio & Crop Coordinate Alignment | Fix crop offset math, pan offset bounds, dynamic `selectedBox` handoff in `CropReview.tsx` | M2 | DONE |
| 4 | Test Suite & Benchmark Expansion | Create synthetic fixture generator, 4 new unit test suites in `src/lib/face/`, and `scripts/evaluate-edge-case-benchmark.ts` | M1, M2, M3 | DONE |

## Interface Contracts
### `faceapi-engine.ts` ↔ `pipeline.ts`
- `detectAndDescribe` returns `null` if face detection fails OR if 68-point landmark validation fails (strict non-face rejection).
- Candidate scoring uses resolution-normalized center distance penalty.
### `CropReview.tsx` ↔ `pipeline.ts`
- `CropReview` calculates precise crop coordinates without double-subtracting pan offsets.
- `CropReview` computes dynamic `selectedBox` within the cropped 1024x1024 canvas and passes it to `analyzeFaceSource`.
### `match.ts` ↔ `embeddings.ts`
- `rankByDescriptor` applies a strict maximum distance ceiling (e.g. `ensembleDistance <= 1.25` or `matchPercent >= 30%`), returning empty matches if candidate is a non-face.

## Code Layout
- Implementation: `src/lib/face/faceapi-engine.ts`, `src/lib/face/geometry.ts`, `src/lib/face/pipeline.ts`, `src/lib/face/match.ts`, `src/components/capture/crop-review.tsx`, `src/components/app-home.tsx`
- Tests: `src/lib/face/*.test.ts`
- Scripts: `scripts/evaluate-edge-case-benchmark.ts`
