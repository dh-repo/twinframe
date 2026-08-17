# Twinframe matching engine (AccuFace v4)

## Pipeline

1. **Detect** — SCRFD / MediaPipe crop path, FaceAPI fallback for age/gender
2. **Align** — ExpNorm WGSL frontalization or 5-pt similarity
3. **Describe** — EdgeFace-M 256-d embedding
4. **Gate** — quality / pose refuse + look-alike distance floor ([`lookalike-policy.ts`](./lookalike-policy.ts))
5. **Rank** — cosine distance vs multi-shot prototypes (centroid + sparse extras)
6. **Calibrate** — Hill map (`HILL_D0=0.6`, `HILL_N=4.1`) × open-set margin factor + honesty bands
7. **Feedback** — optional “Not really” / “Better match” stored locally for hard negatives

## Gallery

- Primary: `public/celebs/embeddings.v4.q8.bin` + `gallery.buckets.json`
- Extras → prototypes via `buildMultiShotCentroidGallery` (skips FaceNet-padded 128→256 rows)
- Enrollment QA: `npm`/`node --experimental-strip-types scripts/audit-gallery-enrollment.mjs`
- Open-set gold: `public/celebs/lookalike-gold.json` + `scripts/evaluate-lookalike-gold.mjs`
- Open-set leave-one-out: `scripts/evaluate-open-set-loo.mjs` (each gallery id vs the rest)

## Tests

```bash
npm test
node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
node --experimental-strip-types scripts/evaluate-open-set-loo.mjs
```

## Accuracy upgrade path (open-set look-alike)

1. Multi-shot EdgeFace prototypes (centroid path live)
2. Gap-aware open-set percent (`open-set-score.ts`) — crowded top-2 is a nearest neighbor, not a doppelgänger
3. Human-ranked non-celebrity gold (seed harness live; fill civilian descriptors)
4. Cleaner frontal enrollment before growing unique celeb count
5. Offline hard-negative mining from look-alike feedback events
