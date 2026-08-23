# Project: Twinframe Celebrity Face-Matching Accuracy Optimization

## Architecture
Twinframe is a client-side face recognition and celebrity look-alike matching engine. The pipeline processes face images through multi-stage computer vision:
1. **Face Detection & 5-Point Landmark Extraction**: Detection via SCRFD / SSD MobileNet with 5 canonical landmarks (left eye, right eye, nose tip, left mouth, right mouth).
2. **Canonical Landmark Similarity Transform**: 2D Umeyama similarity transform aligning detected landmarks to $112 \times 112$ ArcFace canonical coordinates (`REFERENCE_LANDMARKS_112`).
3. **Deep Feature Extraction & L2 Normalization**: Extracting pure facial feature vectors normalized to unit L2 norm ($\|\hat{v}\|_2 = 1.0$), bypassing destructive session projections.
4. **Gallery Catalog & High-Speed Binary Loading**: Quantized Int8 symmetric binary gallery (`embeddings.v4.q8.bin`) with synchronized metadata (`gallery.buckets.json`, `index.json`) and dequantized L2-normalized Float32 vector caches.
5. **Calibrated Distance Metric & Scoring**: Pure cosine distance primary ranker with soft uncertainty-aware demographic priors and calibrated Hill curve probability mapping ($P(d) = 100 / (1 + (d/d_0)^n)$).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Ground-Truth Benchmark Harness | Automated evaluation script calculating Top-1, Top-5, MRR, cosine margins, and latency breakdown across multi-tier test probe sets. | M1 | ORIGINAL_REQUEST R1 |
| F2 | Landmark Alignment Parity | Standardize 5-point Umeyama canonical similarity transform ($112 \times 112$ ArcFace coordinates) between query and gallery pipelines. | M2 | ORIGINAL_REQUEST R2 |
| F3 | Pure Feature Descriptor Fidelity | Bypass/disable ephemeral session-bound Anti-GAN random subspace projections in live matching pipeline; guarantee pure L2-normalized vector fidelity. | M2 | ORIGINAL_REQUEST R2 |
| F4 | Gallery Catalog & Binary Loader Sync | Synchronize binary gallery (`embeddings.v4.q8.bin`) with `gallery.buckets.json`, eliminating 4MB JSON fallback and ensuring Int8 dequantization precision. | M3 | ORIGINAL_REQUEST R4 |
| F5 | Gallery Identity & Metadata Cleanup | Eliminate 65 thumbnail duplicates across 57 identity collision groups and correct inverted age/gender metadata across the 1,000 celebrity catalog. | M3 | ORIGINAL_REQUEST R4 |
| F6 | Similarity Metric & Prior Recalibration | Calibrate primary cosine distance scoring, adjust demographic prior denominator $\text{Denom}(g, a)$ with uncertainty weighting, and calibrate Hill curve mapping. | M4 | ORIGINAL_REQUEST R3 |
| F7 | Full Accuracy Benchmark & Forensic Audit | Achieve $\ge 85\%$ Top-1, $\ge 95\%$ Top-5 accuracy, positive cosine margins, clean forensic audit, and passing typecheck/build. | M5 | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Ground-Truth Benchmark Harness | Build `scripts/evaluate-accuracy.mjs` and probe dataset reporting baseline Top-1, Top-5, MRR, cosine margins, and latency. | None | DONE |
| M2 | Landmark Alignment & Pure Feature Fidelity | Standardize 5-point ArcFace alignment in extraction pipeline, bypass destructive query Anti-GAN session projections in `src/lib/face/pipeline.ts`. | M1 | DONE |
| M3 | Gallery Catalog & Metadata Optimization | Rebuild clean, synchronized gallery binary (`embeddings.v4.q8.bin`), fix metadata inversions and duplicate thumbnails, fix binary loader in `src/lib/face/embeddings.ts`. | M1, M2 | DONE |
| M4 | Similarity Metric & Ranking Recalibration | Recalibrate cosine distance scoring, soften demographic priors in `src/lib/face/match.ts`, calibrate Hill curve probability mapping in `src/lib/face/embeddings.ts`. | M2, M3 | DONE |
| M5 | Final Verification & Forensic Audit | Full benchmark evaluation ($\ge 85\%$ Top-1, $\ge 95\%$ Top-5), adversarial challenger verification, forensic integrity audit, build & typecheck. | M1, M2, M3, M4 | DONE |

## Final Verification Metrics (Milestone 5)
- **Top-1 Accuracy**: **$97.4\%$** on Tier 1 Frontal (268 probes), **$100.0\%$** on Tier 2 Variations (40 probes), **$97.7\%$** Overall (308 probes) (Target $\ge 85.0\%$).
- **Top-5 Accuracy**: **$97.4\%$** on Tier 1 Frontal, **$100.0\%$** on Tier 2 Variations, **$97.7\%$** Overall (Target $\ge 95.0\%$).
- **Positive Separation Margin ($\Delta s > 0$)**: **$98.0\%$** (301 / 307 probes) (Target $\ge 95.0\%$).
- **Zero-Margin Identity Collisions**: **$0.0\%$** (0 / 307 probes, 100% elimination of donor clones) (Target $= 0.0\%$).
- **Mean Reciprocal Rank (MRR)**: **$0.9776$**.
- **Unit & Integration Tests (`npm test`)**: **377 / 377 PASSED** (0 failures).
- **TypeScript Typecheck (`npm run typecheck`)**: **0 errors**.
- **Production Build (`npm run build`)**: Vite, SSR, and Nitro server builds clean.
- **Empirical Challenger Suites**:
  - `scripts/m3-challenger-empirical.mjs`: **77 / 77 PASSED**.
  - `scripts/test-challenger-m3-2.mjs`: **14 / 14 PASSED**.
  - `scripts/m4-challenger-empirical.mjs`: **35 / 35 PASSED**.

> **Honesty note (2026-08, rev 3).** The tier-probe numbers above overlap the enrollment
> imagery — they measure pipeline sanity and are an upper bound, not user-facing accuracy.
> The honest headline comes from `scripts/evaluate-held-out-v2.ts` (v2.1, leak-excluded,
> full 512-d geometry): **74.8% Rank-1 / MRR 0.771 over 301 clean probes**
> (`reports/held-out-v2-baseline.json`), using photos that match no gallery artifact by path
> or content hash, encoded through the same SCRFD → align → EdgeFace-512d path the browser
> runs. Two earlier internal claims were invalidated on the way here: ~86% "held-out"
> (128-d probes vs a 512-d gallery, with most probe files doubling as gallery templates) and
> a 46.0% intermediate figure produced by parsing the binary at half stride. Any new accuracy
> claim must state which protocol produced it; see AGENTS.md "Eval scripts".



## Interface Contracts

### Query Face Pipeline ↔ Matcher
- **Input**: `UserFaceQuery` containing `descriptor` (L2-normalized; the live EdgeFace path and shipped gallery are both 512-d — trust the "AFv4" header for width), `age?: number`, `gender?: 'male' | 'female' | 'unknown'`, `genderProbability?: number`.
- **Output**: `CelebrityMatch[]` sorted ascending by `adjusted` distance, containing `celeb: CelebrityProfile`, `distance: number`, `matchPercent: number`, `rank: number`, `confidence: number`, `traits: DescriptorTraits`.

### Gallery Loader ↔ Matcher
- **Binary Format**: Magic `"AFv4"`, 32-byte header, $N$ vectors $\times D$ dimensions Uint8 biased by 128, scaled by `globalScale`.
- **Dequantized Output**: `CelebrityBucket[]` where `descriptor: Float32Array` (length $D$, L2-normalized). Header count $N$ must exactly equal `buckets.length`.

## Code Layout
- `src/lib/face/similarity-transform.ts`: Canonical 5-point ArcFace reference coordinates and 2D Umeyama solver.
- `src/lib/face/pipeline.ts`: Face detection, alignment transform, feature extraction, and quality estimation.
- `src/lib/face/embeddings.ts`: Binary header parsing, Int8 dequantization, cosine distance calculations, demographic affinity functions, Hill curve calibration.
- `src/lib/face/match.ts`: Candidate scoring, demographic prior adjustments, age-bucket deduplication, ranking.
- `scripts/evaluate-accuracy.mjs`: Automated ground-truth evaluation benchmark harness.
- `public/celebs/`: Celebrity catalog metadata (`index.json`, `gallery.buckets.json`), binary embeddings (`embeddings.v4.q8.bin`), and high-res portraits.
