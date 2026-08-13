# Project: Twinframe Celebrity Match Scoring & Calibration Overhaul

## Architecture
Twinframe is an in-browser celebrity face matching engine. The scoring overhaul replaces single-vector matching with a multi-vector reference gallery and a decoupled two-stage candidate search & reranking pipeline.

```
[User Face Input]
       │
       ▼
[Landmark & Embedding Extraction] (128-d FaceNet + 23-d Morphological Features + 68-point 3D Pose)
       │
       ▼
[Stage 1: Coarse Multi-Vector Search] (Top-30 via 128-d Ensemble Distance: 0.90 L2 + 0.42 Cosine)
       │
       ▼
[Stage 2: Fine Morphological Alignment] (Top-5 via 68-point Landmark Alignment + Pose Weighting + Ethnic Structural Sub-Distance)
       │
       ▼
[Recalibrated Hill Curve & Lookalike Gate] (d > 0.40 -> <20% or "No Close Match", >=45% strictly for lookalikes)
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Multi-Vector Gallery Schema | Expand `CelebrityEmbedding` interface and decoders for multi-reference vectors per celeb figure (`referenceVectors`, `descriptors`) while keeping `descriptor` for backwards compatibility. | M1 | R3 |
| 2 | Gallery Landmark Feature Dataset | Extract/store 23-d facial structural features (`FaceFeatures`) for all 500+ gallery celebrities, replacing synthetic hash fallbacks. | M1 | R1, R3 |
| 3 | Morphological Structural Sub-Distance | Implement structural sub-distance $D_{\text{morph}}$ covering eye slant/spacing, cheekbones, nose bridge, jawline contour, and ethnic/complexion attributes. | M2 | R1 |
| 4 | Ethnic Morphology Penalty & Alignment | Integrate structural sub-distance penalty into candidate scoring when $D_{\text{morph}} > 0.35$ to prevent cross-demographic false positives. | M2 | R1 |
| 5 | Decoupled Two-Stage Reranker | Implement Stage 1 Top-K1 (K1=30) coarse multi-vector search and Stage 2 Top-K2 (K2=5) fine morphological landmark alignment in `match.ts`. | M3 | R3 |
| 6 | Hill Curve & Lookalike Threshold Recalibration | Recalibrate similarity mapping so weak/dissimilar matches ($d > 0.40$) drop rapidly to $< 20\%$ or return "No Close Match" (empty candidate array), reserving $\ge 45\%$ strictly for lookalikes. | M3 | R2 |
| 7 | Cross-Demographic Cluster Taxonomy | Annotate benchmark evaluation dataset with ethnic/morphology clusters (East Asian, South Asian, African, Caucasian, Hispanic, Middle Eastern). | M4 | R4 |
| 8 | Automated Cross-Demographic Eval Harness | Expand `evaluate-match-accuracy.ts` and `match-accuracy.test.ts` with cross-demographic evaluation pairs asserting 0 top-3 false matches, $\ge 30\%$ gap improvement, and $> 95.0\%$ Top-1 accuracy. | M4 | R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Multi-Vector Gallery Schema & Landmark Features | Multi-vector embedding definitions in `types.ts`, `embeddings.ts`, and full gallery 23-d `FaceFeatures` dataset | None | DONE |
| M2 | Morphological Feature Sub-Distance & Ethnic Alignment | Structural sub-distance metric $D_{\text{morph}}$ in `geometry.ts`/`embeddings.ts` and cross-demographic penalty | M1 | DONE |
| M3 | Decoupled Two-Stage Reranker & Hill Curve Recalibration | Stage 1 coarse search + Stage 2 fine reranking in `match.ts`, lookalike percentage floor gate ($d > 0.40 \implies < 20\%$ or "No Close Match") | M1, M2 | DONE |
| M4 | Cross-Demographic Evaluation Harness & Benchmark Hardening | Cross-demographic evaluation pair suite in `evaluate-match-accuracy.ts` & `match-accuracy.test.ts` enforcing target criteria | M1, M2, M3 | DONE |


## Interface Contracts

### Multi-Vector Gallery Types (`src/lib/face/types.ts` & `src/lib/face/embeddings.ts`)
```typescript
export interface ReferenceVector {
  descriptor: Float32Array;
  viewType?: "frontal" | "profile_left" | "profile_right" | "angled_30" | "expression";
  pose?: { yawDeg: number; pitchDeg: number; rollDeg: number };
  photoUrl?: string;
  features?: FaceFeatures;
}

export interface CelebrityEmbedding {
  id: string;
  name: string;
  path: string;
  path192?: string;
  fallbackPath?: string;
  age: number;
  gender: "male" | "female";
  genderProb: number;
  features?: FaceFeatures;
  descriptor: number[]; // Backwards-compatible primary vector
  descriptors?: Float32Array[];
  referenceVectors?: ReferenceVector[];
}

export function getCelebrityDescriptors(celeb: CelebrityEmbedding): Float32Array[];
```

### Morphological Sub-Distance (`src/lib/face/geometry.ts`)
```typescript
export function morphologicalDistance(uFeat: FaceFeatures, cFeat: FaceFeatures): number;
```

### Two-Stage Matcher (`src/lib/face/match.ts`)
```typescript
export function rankByDescriptor(
  user: UserFaceQuery,
  gallery: CelebrityEmbedding[],
  topK?: number
): CelebrityMatch[];
```

### Benchmark Evaluation Harness (`scripts/evaluate-match-accuracy.ts`)
```typescript
export interface EvaluationOptions {
  protocol?: "perturbed-query" | "soft-leave-one-bucket";
  evaluateCrossDemographic?: boolean;
  saveBaseline?: string;
  compareBaseline?: string;
  strict?: boolean;
}
```

## Code Layout
- `src/lib/face/types.ts`: Core type definitions (`FaceFeatures`, `CelebrityMatch`, `ReferenceVector`, `CelebrityEmbedding`).
- `src/lib/face/embeddings.ts`: Vector loader, multi-vector helper functions, $L_2$-normalization, distance functions (`ensembleDistance`).
- `src/lib/face/geometry.ts`: Landmark ratio extraction, 68-point boundary checks, `morphologicalDistance` calculation.
- `src/lib/face/match.ts`: Two-stage candidate search & reranker, pose-adaptive weighting, lookalike threshold gating.
- `public/celebs/gallery.features.json`: Full 23-d `FaceFeatures` store for all 805 gallery entries.
- `scripts/evaluate-match-accuracy.ts`: Benchmark evaluation script, perturbed query generation, cross-demographic evaluation pair matrix.
- `src/lib/face/match-accuracy.test.ts`: Automated accuracy benchmark unit test suite.
