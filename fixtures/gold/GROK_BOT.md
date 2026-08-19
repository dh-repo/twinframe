# Grok Bot brief (civilian gold + Studio rebuild)

Watchable inbox (preferred): [`handoff/grok-bot/WATCH.md`](../../handoff/grok-bot/WATCH.md). This file is the long form of that ticket.

You are helping Damian finish **twinframe** open-set look-alike gold. Twinframe is an on-device celebrity face matcher. Closed-set identity ranking is already strong. The product gap is **honest look-alike scoring for regular people**.

Do **not** invent faces. Do **not** use Imagine, image generation, face synthesis, face swap, or “make a person who looks like X”. Every photo must be a **real photograph of a real person**. If you cannot get a real photo, skip that slot.

## Hard rules

1. Real JPEGs only. Public-domain / stock / Creative Commons / photos Damian already has. One clear frontal face, even light, no heavy filters, no sunglasses, no group shots.
2. Never generate a face. Never download a celebrity as a “civilian”.
3. Celebrity ids must be **exact slugs** from `fixtures/gold/gallery-ids.tsv` (same as `public/celebs/gallery.buckets.json`). Examples that exist: `margot-robbie`, `scarlett-johansson`, `ana-de-armas`, `ryan-gosling`, `brad-pitt`, `keanu-reeves`, `zendaya`, `viola-davis`. Typos like `gwenyth-paltrow` are invalid (that row is being dropped).
4. For each civilian, **3+ humans** (Damian + you + one more person, or three people Damian asks) name acceptable look-alikes. If nobody agrees, mark `refuse: true` instead of guessing.
5. Do not retune Hill / margin / gender. Do not rewrite `embeddings.v4.q8.bin` from audit JSON. Do not run `apply-gallery-review.mjs --write` unless the Mac Studio enroll + `write-gallery-v4.mjs` will run in the same sitting.

## Job A — collect gold photos (do this first; cloud VM cannot)

Create this set under `fixtures/gold/`:

| File | Kind | Who |
| --- | --- | --- |
| `civilian-01.jpg` … `civilian-12.jpg` | look-alike probes | 12 real non-celebrities, mix of gender and age (young / mid / older; at least 4 women and 4 men) |
| `no-match-01.jpg` … `no-match-04.jpg` | refuse probes | 4 real people where humans say “no celebrity doppelgänger” |

Then copy `fixtures/gold/labels.example.json` → `fixtures/gold/labels.json` and fill **only real rows**:

```json
{
  "version": "1.0.0",
  "cases": [
    {
      "id": "civilian-01",
      "image": "fixtures/gold/civilian-01.jpg",
      "accept": ["exact-slug-1", "exact-slug-2", "exact-slug-3"],
      "age": 34,
      "gender": "female",
      "notes": "3 humans agreed these look-alikes"
    },
    {
      "id": "civilian-refuse-01",
      "image": "fixtures/gold/no-match-01.jpg",
      "refuse": true,
      "notes": "3 humans: no good doppelgänger"
    }
  ]
}
```

How to pick `accept` ids:

1. Open `fixtures/gold/gallery-ids.tsv`.
2. Filter to the **same gender** as the photo.
3. Pick 3–5 celebs a human would actually accept as a look-alike, not “same vibe” or “same hair color only”.
4. If you cannot find 3 honest ids, use `refuse: true`.

Validate ids (no ONNX needed):

```bash
node --experimental-strip-types scripts/encode-gold-batch.mjs \
  --labels fixtures/gold/labels.json --check-ids
```

When the JPEGs are on disk:

```bash
node --experimental-strip-types scripts/encode-gold-batch.mjs \
  --labels fixtures/gold/labels.json --check
node --experimental-strip-types scripts/encode-gold-batch.mjs \
  --labels fixtures/gold/labels.json
node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
```

Write down these four numbers and **stop**:

- `acceptable@1`
- `acceptable@5`
- `refuse_ok`
- `calibration(>=70% endorsed)`

Identity seeds (Adele, Brad, …) and synthetic refuse vectors already in `lookalike-gold.json` are regression guards. Do not delete them. Civilian rows are the new signal.

## Job B — Mac Studio gallery rebuild (only on the Studio)

The review file is already filled: **drop** `gwenyth-paltrow` (typo clone of `gwyneth-paltrow`), **keep** `gwyneth-paltrow`, **reenroll** the other 119 audit demotions. Reenroll means “keep in the catalog, replace the encoding” — do **not** drop 119 people.

On the Mac Studio, from the repo root:

```bash
# dry plan first
sh scripts/studio-rebuild-gallery.sh

# then the real rebuild (hours on CPU; use the Studio GPU/Neural path)
CONCURRENCY=16 sh scripts/studio-rebuild-gallery.sh --write
```

That runs, in order:

1. `apply-gallery-review.mjs --write` — catalog only (999 buckets). Does **not** touch `embeddings.v4.q8.bin`.
2. `enroll-gallery-onnx.mjs --concurrency 16` — new EdgeFace-512 vectors for every remaining id.
3. `write-gallery-v4.mjs` — writes the binary. **Must** follow enroll in the same sitting or catalog and binary desync.
4. `audit-gallery-v4.mjs`
5. `evaluate-open-set-loo.mjs --json` — compare strong-band rate to **109/968**.
6. `evaluate-lookalike-gold.mjs`

Do **not** commit the regenerated `public/models/ort/*.wasm` files (those are local copies from `npm run copy:ort`).

## What you must not do

- Do not generate civilian faces or fake `acceptableTopIds`.
- Do not retune ranking (`open-set-score`, Hill, margin, gender prior) until Job A numbers exist.
- Do not run Studio `--write` in a headless cloud VM (no GPU; enroll is ~hours and the 20s in-browser timeout is a hardware limit).
- Do not rewrite `embeddings.v4.q8.bin` from `gallery-audit-v4.json`.

## Done when

1. `fixtures/gold/` has ~12 + ~4 real JPEGs and a filled `labels.json`.
2. `encode-gold-batch` wrote civilian rows into `public/celebs/lookalike-gold.json`.
3. Gold eval printed the four metrics above.
4. (Optional, Studio) rebuild finished and LOO strong-band is recorded vs 109/968.

Paste those numbers back to Damian. Do not propose a ranking retune in the same turn as collecting photos.
