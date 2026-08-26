# Twinframe matching engine (AccuFace v4)

## Pipeline

1. **Detect** — SCRFD / MediaPipe crop path, FaceAPI fallback for age/gender
2. **Align** — ExpNorm WGSL frontalization or 5-pt similarity
3. **Describe** — AdaFace IR-101 512-d embedding
4. **Gate** — quality / pose refuse + look-alike distance floor ([`lookalike-policy.ts`](./lookalike-policy.ts))
5. **Rank** — cosine distance vs multi-shot prototypes (centroid + sparse extras)
6. **Calibrate** — named verdict + logistic `probabilityCorrect`; Hill map (`HILL_D0=0.6`, `HILL_N=4.1`) × open-set margin is uncalibrated similarity
7. **Feedback** — optional “Not really” / “Better match” stored locally for hard negatives

## Gallery

- Primary: `public/celebs/embeddings.v4.q8.bin` + `gallery.buckets.json`
- Extras → prototypes via `buildMultiShotCentroidGallery` (skips FaceNet-padded 128→256 rows)
- Enrollment QA: `npm`/`node --experimental-strip-types scripts/audit-gallery-enrollment.mjs`
- Re-enroll (process pool): `scripts/enroll-gallery-onnx.mjs [--concurrency N]` — independent JPEGs in parallel child processes (default `min(16, CPU count)`). One 112×112 AdaFace pass will not fill a big GPU.
- Gallery collision audit: `scripts/audit-gallery-v4.mjs` → `public/celebs/gallery-audit-v4.json` (demotion list only; does not rewrite the binary)
- Open-set gold: `public/celebs/lookalike-gold.json` + `scripts/evaluate-lookalike-gold.mjs`
- Encode a labeled civilian photo: `scripts/encode-gold-probe.mjs --image fixtures/gold/….jpg --id … --accept id,id` (or `--refuse`)
- Open-set leave-one-out: `scripts/evaluate-open-set-loo.mjs [--json]` (each gallery id vs the rest)

## Tests

```bash
npm test
node --experimental-strip-types scripts/audit-gallery-v4.mjs
node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
node --experimental-strip-types scripts/evaluate-open-set-loo.mjs
node --experimental-strip-types scripts/enroll-gallery-onnx.mjs --limit 8 --concurrency 4
```

## Civilian gold labeling protocol

1. Use a non-celebrity, front-facing photo (one clear face, even light).
2. Have 3+ people name acceptable celebrity look-alikes, or mark “no doppelgänger”.
3. Put the JPEG in `fixtures/gold/` and encode with `encode-gold-probe.mjs` (`--accept id,id` or `--refuse`).
4. Do not invent civilian faces or labels. A first set of ~12 frontals plus ~4 refuses is enough to score `acceptable@1` and `calibration(>=70% endorsed)`.

## Accuracy upgrade path (open-set look-alike)

1. Multi-shot AdaFace prototypes (centroid path live)
2. Gap-aware open-set percent (`open-set-score.ts`) — crowded top-2 is a nearest neighbor, not a doppelgänger
3. Human-ranked non-celebrity gold (encode harness live; fill only with real photos + labels)
4. Cleaner frontal enrollment before growing unique celeb count
5. Offline hard-negative mining from look-alike feedback events
