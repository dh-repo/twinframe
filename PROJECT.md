# Project: Twinframe 5 Core Accuracy Enhancement Pillars

## Architecture

Twinframe's in-browser match engine is modularized across:

1. **Pipeline & engine** (`src/lib/face/pipeline.ts`, `faceapi-engine.ts`) — detect, 5-point align, adaptive CLAHE, 3-crop TTA, FaceNet 128-d.
2. **Geometry** (`geometry.ts`, `pose.ts`) — 5-point similarity warp + 3D Procrustes unwarping + clinical ratios.
3. **Gallery** (`embeddings.ts`, `gallery.features.json`, `CELEBRITIES`) — multi-view reference vectors (frontal / expression / profile when labeled).
4. **Match** (`match.ts`) — two-stage multi-vector search with morphological tie-break at `|Δd| < 0.015`.
5. **Eval** (`scripts/evaluate-match-accuracy.ts`) — perturbed-query Rank-1, cross-demographic FP, separation gap.

## Feature inventory

| # | Feature | Milestone | Status |
|---|---------|-----------|--------|
| 1 | Multi-template TTA (canonical / flip / tight-scale + ensemble) | M1 | DONE |
| 2 | 5-point affine warp to canonical 150×150 | M2 | DONE |
| 3 | Multi-vector gallery + nearest manifold vector | M3 | DONE |
| 4 | Adaptive LAB CLAHE on embed crop before FaceNet | M4 | DONE |
| 5 | Clinical morph tie-break (`\|Δd\| < 0.015`) | M5 | DONE |
| 6 | E2E ≥98% Rank-1, 0 cross-demo FP, typecheck/build/test | M6 | DONE |
| 7 | Temporal burst EMA (5–8 frames) | F1 | DONE |
| 8 | Occlusion-adaptive morph weights | F2 | DONE |
| 9 | 3D/SVG biometric mesh + inspection cards | F3 | DONE |
| 10 | Soft age/hair identity projection | F4 | DONE |
| 11 | Unrolled 128-d ensemble kernel | F5 | DONE |

## Interface contracts

- TTA returns `[v1, v2, v3, vEnsemble]`; ranking uses min ensemble distance over templates × gallery refs.
- Affine: 5 anchors (L/R eye, nose tip, L/R mouth) → `CANONICAL_5_POINTS_150`.
- Gallery primary = `viewType: "frontal"`; extra-photos default `expression`; profile only when pose is known.
- CLAHE equalizes L* only (`Δa* = 0`, `Δb* = 0`); skipped on well-lit uniform crops.
- Tie-break: `d_final = d_deep + 0.04 D_morph` when `|Δd| < 0.015`.

## Code layout

- `src/lib/face/pipeline.ts`, `faceapi-engine.ts` — M1 TTA + embed CLAHE
- `src/lib/face/geometry.ts` — M2 warp + M5 `computeMorphologicalDistance`
- `src/lib/face/embeddings.ts` — M3 multi-vector + anatomical hydrate
- `src/lib/face/clahe.ts`, `quality.ts` — M4 CLAHE + adaptive gate
- `src/lib/face/match.ts` — M5 tie-break
- `scripts/evaluate-match-accuracy.ts` — M6 ≥98% Rank-1
