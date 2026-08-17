<!-- grok-bot-watch -->
status: OPEN
job: civilian-gold
priority: high
repo: https://github.com/dh-repo/twinframe
branch: cursor/gallery-review-workflow-815a
pr: https://github.com/dh-repo/twinframe/pull/14
brief: fixtures/gold/GROK_BOT.md
updated: 2026-08-17T22:47:00Z
<!-- /grok-bot-watch -->

# Grok Bot job — civilian gold photos

If you are a watching bot: this file is the inbox. Poll it. When `status` is `OPEN`, claim it, do the work, write the Reply block, set `status` to `DONE` (or `BLOCKED` with a reason). Do not wait for a chat ping.

**Claim protocol (edit this file, keep the HTML comment markers):**

1. Set `status: CLAIMED` and add `claimed_at: <ISO-8601>` in the header.
2. Do Job A below. Job B only if you are on Damian’s Mac Studio.
3. Fill **Reply (bot writes here)**.
4. Set `status: DONE` or `status: BLOCKED`.

Long form: [`fixtures/gold/GROK_BOT.md`](../../fixtures/gold/GROK_BOT.md). Valid celeb slugs: [`fixtures/gold/gallery-ids.tsv`](../../fixtures/gold/gallery-ids.tsv).

## Hard rules

- Real photographs of real non-celebrities only.
- **Never** Imagine / generate / synthesize / face-swap a person.
- Never use a celebrity photo as a “civilian.”
- `accept` ids must be exact slugs from `gallery-ids.tsv` (not `gwenyth-paltrow`).
- 3+ humans must agree on look-alikes, or set `refuse: true`.
- Do not retune Hill / margin / gender.
- Do not rewrite `embeddings.v4.q8.bin` from audit JSON.
- Do not run Studio `--write` except on the Mac Studio, in the same sitting as enroll.

## Job A — collect and encode gold (do this)

Drop files under `fixtures/gold/`:

| Files | Count | What |
| --- | ---: | --- |
| `civilian-01.jpg` … `civilian-12.jpg` | 12 | Real frontals, mix of gender/age (≥4 women, ≥4 men) |
| `no-match-01.jpg` … `no-match-04.jpg` | 4 | Real people; humans say no celebrity doppelgänger |

Then:

```bash
cp fixtures/gold/labels.example.json fixtures/gold/labels.json
# edit labels.json — real rows only, exact slugs, same-gender accept lists

node --experimental-strip-types scripts/encode-gold-batch.mjs \
  --labels fixtures/gold/labels.json --check-ids

node --experimental-strip-types scripts/encode-gold-batch.mjs \
  --labels fixtures/gold/labels.json

node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
```

Copy these four numbers into Reply and **stop** (no ranking retune):

- `acceptable@1`
- `acceptable@5`
- `refuse_ok`
- `calibration(>=70% endorsed)`

Keep existing identity + refuse seeds in `public/celebs/lookalike-gold.json`. Only add civilian rows.

## Job B — Studio rebuild (only on the Mac Studio)

Review file is already filled: drop `gwenyth-paltrow`, keep `gwyneth-paltrow`, reenroll 119 others.

```bash
sh scripts/studio-rebuild-gallery.sh
CONCURRENCY=16 sh scripts/studio-rebuild-gallery.sh --write
```

Record LOO strong-band vs **109/968**. Do not commit `public/models/ort/*.wasm`.

## Reply (bot writes here)

```
status:
claimed_at:
finished_at:
photos_added:
labels_path:
acceptable@1:
acceptable@5:
refuse_ok:
calibration:
loo_strong:
blocked_reason:
notes:
```
