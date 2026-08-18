# Which accuracy number to quote

Six report files here answer different questions, and the flattering ones are the
easiest to misread. Short version: **one held-out number is the accuracy claim, and
everything else is a diagnostic.**

| Report | Question it answers | Quote it as |
| :--- | :--- | :--- |
| `held-out-accuracy.md` | Does the shipping engine identify a celebrity from a photo it has never seen? | **the accuracy claim** |
| `tier1-accuracy.md` | Does the engine recognize its own enrollment photos, and is every identity actually enrolled? | a self-recognition / integrity check |
| `baseline-accuracy.md`, `final-accuracy.md`, `accuracy-benchmark.*`, `test-benchmark.*` | Historical runs of the Tier-1/2/3 harness from 2026-08-14, kept for comparison | history, not current |

## The accuracy claim: `held-out-accuracy.md`

`scripts/evaluate-held-out.ts` scores the product path — SCRFD-2.5G detect, 5-point
align, EdgeFace-512 embed, `rankByDescriptor` against the gallery the browser builds
(AFv4 primaries plus `extra-templates.json`, then multi-shot centroids). Probes are
slot 001 of `public/celebs/held-out/<id>/`: a different Wikipedia/Commons photo of the
same person, never enrolled.

Three things that report does which the Tier-1 harness does not:

- **Strips near-duplicate leakage.** Roughly 30% of "held-out" photos turn out to be
  the enrolled photo at another resolution, which byte-level dedupe cannot catch. They
  score Rank-1 for free. The headline row excludes them.
- **Stratifies by hard-probe condition** (`low-light`, `yaw-gt-25`, `big-smile`,
  `glasses`, `phone-closeup`) from `public/celebs/held-out/hard-probes.json`, with
  Wilson intervals, because the average over frontal portraits is the number that
  misleads.
- **Counts refusals as misses.** The product declining to show any match is a miss to
  the user, so it is not quietly dropped.

```bash
node --experimental-strip-types scripts/label-hard-probes.mjs --concurrency 4
node --experimental-strip-types scripts/evaluate-held-out.ts --concurrency 4
```

## The integrity check: `tier1-accuracy.md`

`scripts/evaluate-accuracy.mjs` scores `public/celebs/<id>.jpg` (or the WebP thumbnail
for ids without one) against the legacy FaceNet-128 gallery `embeddings.json`. Those
are exactly the files `collectEnrollJobs` enrolls from, so a Tier-1 probe is an image
the engine has already seen. Its Top-1 is a memorization score with a useful floor
property: a miss means a specific identity's gallery data is broken.

Two ceilings the report breaks out rather than averaging away:

- Only 265 of the 1000 descriptors in `embeddings.json` are real face embeddings; the
  other 735 are random unit vectors, so those identities cannot be ranked at all. The
  `byEnrollment` cohort separates them.
- Only 271 ids ship a full-size portrait. `--probe-sources all` adds thumbnail probes
  for the rest, but they are enrolled images too, so this does not become an accuracy
  measurement.

```bash
node scripts/evaluate-accuracy.mjs --tier 1 --concurrency 4 \
  --json reports/tier1-accuracy.json --markdown reports/tier1-accuracy.md
```

Detection dominates the cost here (~21s per probe on 4 cores), so a full 270-probe pass
takes ~35 minutes at concurrency 4 and nothing is cached between runs. Use `--limit N`
for a quick check; it samples across the id-sorted catalog rather than taking the
alphabetical head. The held-out harness is far cheaper — it caches EdgeFace descriptors
per probe, so a re-run is about a minute.

## Hill calibration

`HILL_D0` / `HILL_N` in `src/lib/face/embeddings.ts` map distance to the percentage
the UI displays. `held-out-accuracy.md` reports the log-loss fit, a reliability diagram
(claimed percentage versus how often the top match was right), and the probe-weighted
expected calibration error for both the current and best-fit constants. Read the
reliability diagram before changing a constant: the log-loss fit wins by flattening
every percentage toward the middle, which reads as hedging to a user.
