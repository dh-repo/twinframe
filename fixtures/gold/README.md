# Civilian gold photos

This folder has no photos yet — that is intentional. Do not invent faces or look-alike labels.

1. Collect ~12 real frontals + ~4 human “no doppelgänger” refuses (see `GROK_BOT.md`, or the watched inbox `handoff/grok-bot/WATCH.md`).
2. Copy `labels.example.json` → `labels.json` and fill exact gallery slugs from `gallery-ids.tsv`.
3. Encode, then measure. Do not retune ranking before those numbers exist.

```bash
node --experimental-strip-types scripts/encode-gold-batch.mjs \
  --labels fixtures/gold/labels.json --check-ids

node --experimental-strip-types scripts/encode-gold-batch.mjs \
  --labels fixtures/gold/labels.json

node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
```

Single-image path (same rules):

```bash
node --experimental-strip-types scripts/encode-gold-probe.mjs \
  --image fixtures/gold/civilian-01.jpg \
  --id civilian-01 \
  --accept ana-de-armas,margot-robbie

node --experimental-strip-types scripts/encode-gold-probe.mjs \
  --image fixtures/gold/no-match-01.jpg \
  --id civilian-refuse-01 \
  --refuse
```

Record `acceptable@1` / `acceptable@5` / `refuse_ok` / `calibration(>=70% endorsed)` before any Hill / margin / gender retune.
