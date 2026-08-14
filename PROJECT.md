# Project: TwinFrame Biometric & Gallery Enhancement

## Architecture
TwinFrame is an in-browser facial lookalike discovery and biometric comparison application using FaceNet 128-d embeddings, 68-point facial landmark geometry, and 3D Procrustes-unwarping to extract 23-d clinical morphological traits.

### Data Flow & Component Architecture
1. **Gallery Biometric Database**:
   - `public/celebs/embeddings.q8.bin` & `embeddings.f32.bin`: 128-d FaceNet descriptors.
   - `public/celebs/gallery.features.json`: 23-d `FaceFeatures` + 9 unwarped 3D clinical ratios (`ExtendedAnatomicalFeatures`).
   - `public/celebs/gallery.buckets.json` & `index.json`: Demographics, asset paths, and age/gender metadata.
2. **Face Analysis & Embeddings Pipeline (`src/lib/face/`)**:
   - `pose.ts`: Head pose estimation (|pitch| < 20°, |yaw| < 20°).
   - `geometry.ts`: 3D canonical unwarping, 23-d feature extraction, Procrustes alignment, morphological distance.
   - `embeddings.ts`: Feature weighting, distance metrics, calibrated age-gap penalties, ensemble scoring.
   - `match.ts`: Candidate indexing, 2-stage ranking, demographic calibration, 4-part biometric trait breakdown generation.
3. **UI & Results Presentation (`src/components/results/`)**:
   - `match-results.tsx`: Top matches container and orchestration.
   - `match-reveal-card.tsx`: Reveal animation, hero similarity percentage, 4-part anatomical breakdown with Progress bars and NumberCounter percentage chips.
   - `comparison-view.tsx`: Side-by-side landmark comparison, trait overlays, and detailed morphological analysis.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Billie Eilish Studio Portrait Replacement | Replace beanie/concert portrait with neutral-lighting studio portrait having pitch +4.1° (<20°), yaw +1.0°, unobstructed forehead, and zero headwear | M1 | ORIGINAL_REQUEST R1 |
| F2 | Re-extracted 128-d TTA Descriptor | Re-extract 128-d FaceNet descriptor with 4-crop TTA for Billie Eilish and update binary embeddings (`.q8.bin` and `.f32.bin`) | M1 | ORIGINAL_REQUEST R1 |
| F3 | Re-extracted 23-d FaceFeatures & 3D Proportions | Re-compute 23-d normalized scalar features and 9 unwarped 3D clinical ratios for Billie Eilish in `gallery.features.json` | M1 | ORIGINAL_REQUEST R1 |
| F4 | Gallery Metadata Synchronization | Update age (25) and gender metadata for Billie Eilish in `gallery.buckets.json` and `index.json` | M1 | ORIGINAL_REQUEST R1 |
| F5 | Calibrated Age-Gap Penalty Function | Implement non-linear $P_{age}(d, u_{age}, c_{age})$ in `embeddings.ts` activating when $d > 0.40$ and $|\Delta age| > 20$ | M2 | ORIGINAL_REQUEST R2 |
| F6 | Weak-Match Age Demotion Integration | Integrate $P_{age}$ into `match.ts` (`byFaceThenDemo` and weak match candidate sorting) to prevent 20yo figures from dominating mature queries (age >= 40) | M2 | ORIGINAL_REQUEST R2 |
| F7 | Strong Match & Peer Invariance | Ensure $P_{age} = 0.0$ for strong matches ($d \le 0.40$) and age peers ($|\Delta age| \le 20$), preserving twin lookalike ranking | M2 | ORIGINAL_REQUEST R2 |
| F8 | 4-Part Anatomical Trait Breakdown Builder | Implement `buildDescriptorTraits` in `match.ts` returning Facial Thirds, Eye Spacing & Canthal Tilt, Nose Bridge & Width, Jawline & Chin | M3 | ORIGINAL_REQUEST R3 |
| F9 | Granular Biometric Breakdown UI Component | Update `match-reveal-card.tsx` to render all 4 anatomical progress bars, percentage chips, accessible ARIA labels, and smooth animations | M3 | ORIGINAL_REQUEST R3 |
| F10 | Comparison View Morphological Breakdown | Update `comparison-view.tsx` and `match-results.tsx` to reflect the 4-part anatomical breakdown in the side-by-side analysis | M3 | ORIGINAL_REQUEST R3 |
| F11 | End-to-End Test Suite & Verification | Pass 100% of Tiers 1-4 E2E tests and Tier 5 adversarial stress tests with clean forensic audit | M4 (Final) | ORIGINAL_REQUEST AC |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Gallery Portrait Curation & Occlusion Cleaning | Features F1, F2, F3, F4 | none | DONE |
| M2 | Calibrated Age-Gap Penalty in Embeddings & Match | Features F5, F6, F7 | none | DONE |
| M3 | Granular Multi-Trait Biometric Breakdown UI | Features F8, F9, F10 | M1, M2 | DONE |
| M4 | Final Milestone: 100% E2E Pass & Adversarial Hardening | Feature F11 | M1, M2, M3, E2E Track | DONE |

---

## Interface Contracts

### 1. Gallery Asset & Binary Embeddings (M1 ↔ System)
- File `public/celebs/billie-eilish.jpg`: JPEG portrait (450x600 px), pitch = +4.1°, yaw = +1.0°, unobstructed forehead.
- Thumbnails: `public/celebs/thumbs/192/billie-eilish.webp`, `public/celebs/thumbs-192/billie-eilish.webp`, `public/celebs/thumbs/96/billie-eilish.webp`.
- `embeddings.f32.bin` & `embeddings.q8.bin`: Slot index 66 updated with L2-normalized 128-d vector.
- `gallery.features.json`: Key `"billie-eilish"` contains full 23-d `FaceFeatures` plus `anatomical: ExtendedAnatomicalFeatures` summing to 1.0.
- `gallery.buckets.json` & `index.json`: `baseAge: 25`, `age: 25`, `gender: "female"`, `genderProb: 0.94`.

### 2. Matching & Penalty Contract (M2 ↔ M3 / System)
- `calibratedAgeGapPenalty(rawDist: number, userAge?: number, celebAge?: number): number`
  - When `rawDist <= 0.40` or `|userAge - celebAge| <= 20` or ages missing: returns `0.0`.
  - When `rawDist > 0.40` and `|userAge - celebAge| > 20`: computes continuous non-linear penalty scaled by square root distance excess, 0.80 power age excess, and mature factor $\min(1, \max(0.5, userAge / 40))$.
- `rankByDescriptor(userDescriptor, options)`:
  - Candidates ranked by effective distance $d_{eff} = d + crossPenalty + agePenalty$ across all stages.

### 3. Trait Breakdown Contract (M3 ↔ UI)
- `TraitScore`:
  ```typescript
  interface TraitScore {
    trait: "facialThirds" | "eyeCanthal" | "noseBridge" | "jawlineChin";
    label: string; // "Facial Thirds & Forehead Proportions", "Eye Spacing & Canthal Tilt", "Nose Bridge & Width Index", "Jawline Contour & Chin Sharpness"
    similarity: number; // 0.0 to 1.0
    userTraitDesc?: string;
    celebTraitDesc?: string;
  }
  ```
- `MatchRevealCard` renders all 4 traits with `<Progress value={similarity * 100} />` and `<NumberCounter value={Math.round(similarity * 100)} />%`.

---

## Code Layout
- `public/celebs/`: Reference images, binary embeddings, metadata, and feature cache.
- `src/lib/face/`:
  - `embeddings.ts`: Feature distance math and calibrated age penalty.
  - `match.ts`: Candidate ranking, descriptor matching, trait generation.
  - `geometry.ts`: Canonical 3D unwarping and morphological similarity calculations.
  - `types.ts`: FaceFeatures and ExtendedAnatomicalFeatures type definitions.
- `src/components/results/`:
  - `match-reveal-card.tsx`: Top match reveal, hero percentage, 4-part anatomical breakdown.
  - `comparison-view.tsx`: Side-by-side comparison tabs and biometric trait visualizations.
  - `match-results.tsx`: Results list container.
- `src/lib/face/__tests__/` & `src/lib/face/*.test.ts`: Unit, integration, and mathematical test suites.
- `tests/e2e/`: End-to-end testing suite (Tiers 1-4).
- `tests/challenger/`: Adversarial stress testing suite.
