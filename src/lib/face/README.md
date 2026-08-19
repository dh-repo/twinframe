# Twinframe matching engine (AccuFace v4)

## Pipeline

1. **Detect** — SCRFD / MediaPipe crop path, FaceAPI fallback for age/gender
2. **Align** — ExpNorm WGSL frontalization or 5-pt similarity
3. **Describe** — EdgeFace-S 512-d embedding
4. **Gate** — quality / pose refuse + look-alike distance floor ([`lookalike-policy.ts`](./lookalike-policy.ts))
5. **Rank** — cosine distance vs multi-shot prototypes (centroid + sparse extras)
6. **Calibrate** — Hill map (`HILL_D0=0.6`, `HILL_N=4.1`) × open-set margin factor + honesty bands
7. **Feedback** — optional “Not really” / “Better match” stored locally for hard negatives

## Gallery

- Primary: `public/celebs/embeddings.v4.q8.bin` + `gallery.buckets.json`
- Extras → prototypes via `buildMultiShotCentroidGallery` (skips FaceNet-padded 128→256 rows)
- Enrollment QA: `npm`/`node --experimental-strip-types scripts/audit-gallery-enrollment.mjs`
- Re-enroll (process pool): `scripts/enroll-gallery-onnx.mjs [--concurrency N]` — independent JPEGs in parallel child processes (default `min(16, CPU count)`). One 112×112 EdgeFace pass will not fill a big GPU.
- Gallery collision audit: `scripts/audit-gallery-v4.mjs` → `public/celebs/gallery-audit-v4.json` (suspects only; does not rewrite the binary)
- Human review: `public/celebs/gallery-review.json` (`drop` / `reenroll` / `keep`). `gwenyth-paltrow` is dropped (typo clone of `gwyneth-paltrow`). The other 119 audit demotions default to **reenroll** (stay in the catalog; replace the photo on Studio).
- Fill remaining audit ids: `scripts/fill-gallery-review.mjs` then `--write` (never overwrites an existing keep/drop).
- Apply drops (catalog only): `scripts/apply-gallery-review.mjs` then `--write`. Never touches `embeddings.v4.q8.bin`.
- Studio one-shot: `sh scripts/studio-rebuild-gallery.sh` (dry plan) then `--write` on the Mac Studio only.
- Open-set gold: `public/celebs/lookalike-gold.json` + `scripts/evaluate-lookalike-gold.mjs`
- Encode labeled civilians: `scripts/encode-gold-probe.mjs` or batch via `scripts/encode-gold-batch.mjs --labels fixtures/gold/labels.json`
- Valid celeb slugs for labels: `fixtures/gold/gallery-ids.tsv` (`scripts/list-gallery-ids.mjs`)
- Grok Bot brief (photo collection): `fixtures/gold/GROK_BOT.md`
- Watched inbox (poll this): `handoff/grok-bot/WATCH.md`
- Open-set leave-one-out: `scripts/evaluate-open-set-loo.mjs [--json]` (each gallery id vs the rest)

## Studio re-enroll (review file is already filled)

Do this on the Mac Studio. Do not rewrite the binary from the audit JSON.

```bash
sh scripts/studio-rebuild-gallery.sh
CONCURRENCY=16 sh scripts/studio-rebuild-gallery.sh --write
```

That apply → enroll → write-gallery-v4 → audit → LOO → gold eval. Compare LOO strong-band to the 109/968 baseline. Do not run `--write` in a CPU-only cloud VM.

## Measure after civilian gold (do not retune before this)

Identity + refuse seeds are regression guards only. Civilian rows stay empty until real JPEGs exist under `fixtures/gold/` with human `acceptableTopIds` or `--refuse`. Do not invent faces or labels.

When those rows exist:

```bash
node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
```

Record `acceptable@1`, `acceptable@5`, `refuse_ok`, and `calibration(>=70% endorsed)`. Those numbers decide the next ranking change (refuse more, more multi-shot views, or a different model). Do not retune Hill, margin, or gender priors before that.

## Tests

```bash
npm test
node --experimental-strip-types scripts/audit-gallery-v4.mjs
node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
node --experimental-strip-types scripts/evaluate-open-set-loo.mjs
node --experimental-strip-types scripts/enroll-gallery-onnx.mjs --limit 8 --concurrency 4
node --experimental-strip-types scripts/apply-gallery-review.mjs
```

## Civilian gold labeling protocol

1. Use a non-celebrity, front-facing photo (one clear face, even light). **No generated faces.**
2. Have 3+ people name acceptable celebrity look-alikes from `gallery-ids.tsv`, or mark “no doppelgänger”.
3. Put JPEGs in `fixtures/gold/`, copy `labels.example.json` → `labels.json`, then `encode-gold-batch.mjs`.
4. Paste `fixtures/gold/GROK_BOT.md` to a helper bot if you want it to collect/label **real** photos.
5. A first set of ~12 frontals plus ~4 refuses is enough to score `acceptable@1` and `calibration(>=70% endorsed)`.

## Accuracy upgrade path (open-set look-alike)

1. Multi-shot EdgeFace prototypes (centroid path live)
2. Gap-aware open-set percent (`open-set-score.ts`) — crowded top-2 is a nearest neighbor, not a doppelgänger
3. Human-ranked non-celebrity gold (encode harness live; fill only with real photos + labels)
4. Cleaner frontal enrollment before growing unique celeb count
5. Offline hard-negative mining from look-alike feedback events
