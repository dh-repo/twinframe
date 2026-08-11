# Project: Twinframe Doppelgänger Enhancements

## Architecture
- Framework: React 19, TypeScript 5.7, Vite 8, TanStack Router/Start, Tailwind CSS v4.
- Face Pipeline: `@vladmandic/face-api` (SsdMobileNetV1, 68 Landmarks, 128-d FaceNet recognition embeddings, Age & Gender prediction, Test-Time Augmentation).
- Embedding Storage: Binary Int8 quantized (`embeddings.q8.bin` 380 KB), IndexedDB cache (`twinframe-gallery`), WebP thumbnails (96x96 and 192x192).
- Layout: Monorepo single app under `src/` and `public/celebs/`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Asset Fallback Chain & Cleanup | Fix image loading fallback chain (path192 -> path -> initials) so missing JPG fallbacks do not produce 404s. | M1 | survey_3 |
| 2 | Catalog Metadata Curation | Expand curated metadata entries in `src/lib/celebrities/catalog.ts` for international figures. | M1 | survey_3 |
| 3 | Browser Smoke Test Infra Fix | Update `scripts/browser-guard.mjs` to support local path testing alongside `/workspace`. | M1 | survey_3 |
| 4 | Distance-to-Percentage Calibration | Implement Hill Equation curve mapping d=0 -> 100% and calibrated doppelgänger similarity scale. | M2 | survey_2 |
| 5 | Auxiliary Metrics & Confidence Scoring | Continuous age Gaussian affinity, gender probability prior, and holistic match confidence score calculation. | M2 | survey_2 |
| 6 | Unit Test Expansion | Expand unit test suite in `src/lib/face/match.test.ts` for d=0, monotonicity, and score ranges. | M2 | survey_2 |
| 7 | CSS Animation Keyframes & Utility Classes | Add scan-laser-sweep, reticle-pulse, 3D card flip, and telemetry-fade keyframes in `src/styles.css`. | M3 | survey_1 |
| 8 | Scanning HUD Overlay | High-fidelity face scanning HUD overlay with user photo, corner reticles, sweeping laser line, landmark points, and telemetry stream. | M3 | survey_1 |
| 9 | Match Reveal Card & Counter | Dramatic card-flip/scale reveal animation for top match card with smooth count-up number counter. | M3 | survey_1 |
| 10 | Interactive Side-by-Side & Split Comparison | Enhanced comparison view with rounded-rectangle frames, side-by-side mode, interactive split-slider morph, and feature alignment badges. | M3 | survey_1 |
| 11 | Integration & Full Verification | Typecheck, full unit test suite (npm test), visual smoke test, and Forensic Integrity Audit verification. | M4 | survey_1-3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Celebrity Gallery Catalog & Asset Polish | Asset fallback chain, curated metadata expansion, browser-guard infra fix (R3) | None | DONE |
| M2 | Matching Algorithm & Scoring Calibration | Hill Equation calibration, auxiliary metrics, match confidence, unit test expansion (R2) | M1 | DONE |
| M3 | Visual Design & Micro-Animations | Scanning HUD overlay, match reveal card, interactive comparison view, keyframes (R1) | M2 | DONE |
| M4 | E2E Integration & Verification | Typecheck, test suite, Playwright smoke test, Forensic Audit | M1, M2, M3 | DONE |

## Interface Contracts
### Catalog ↔ Matching Pipeline (`src/lib/face/embeddings.ts` & `match.ts`)
- `distanceToMatchPercent(distance: number): number`: Input d >= 0, returns calibrated percentage [15.0, 100.0].
- `computeMatchConfidence(detConf: number, sharpness: number, faceCoverage: number, genderProb: number): number`: Returns confidence rating [10, 100].
- `CelebrityIndexEntry`: `{ id, name, path, path192, fallbackPath?, gender, genderProb, ageBuckets, baseAge }`.

### Matching Pipeline ↔ UI Components (`src/types/` & `src/components/`)
- `MatchResultItem`: `{ id, name, matchPercent, rawDistance, confidenceScore, traits, photoUrl, thumbnail96Url, thumbnail192Url, accentHue }`.
- `AnalyzingState`: Accepts `previewUrl: string`, `detProgress?: number`.
- `MatchResults`: Accepts `userPhotoUrl: string`, `croppedFaceUrl?: string`, `matches: MatchResultItem[]`.

## Code Layout
- `src/styles.css`: Tailwind v4 import, theme variables, custom keyframes & animation utility classes.
- `src/lib/celebrities/catalog.ts`: Curated celebrity catalog metadata & hints.
- `src/lib/face/embeddings.ts`: Quantized embedding loader, IndexedDB cache, distance metrics, Hill Equation calibration formula.
- `src/lib/face/match.ts`: Ranking pipeline, age & gender affinity, match confidence calculation, trait builder.
- `src/lib/face/match.test.ts`: Unit tests for matching, calibration, and auxiliary metrics.
- `src/components/analyzing-state.tsx`: Face analysis state wrapper.
- `src/components/scanning/face-scanning-hud.tsx`: Scanning HUD overlay.
- `src/components/results/match-results.tsx`: Results container.
- `src/components/results/match-reveal-card.tsx`: Match reveal card component.
- `src/components/results/comparison-view.tsx`: Interactive face vs celebrity comparison view.
- `src/components/ui/number-counter.tsx`: Animated number counter.
- `scripts/browser-guard.mjs`: Visual smoke test guard script.
