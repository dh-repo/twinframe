# AGENTS.md — Twinframe

On-device celebrity look-alike matcher: detect → align → embed a face entirely in the
browser (ONNX Runtime Web primary path), rank against a pre-embedded gallery, show an
honest match percent. No user photo ever leaves the device — that invariant **is** the product.

## Verify commands

Run these exactly; do not report success without exit codes.

```bash
npm test                            # unit + integration + hard cases (node --test via --experimental-strip-types)
npm run test:match                  # face-matching subset only
npm run typecheck                   # tsc --noEmit
npm run test:heldout                # leak-excluded held-out Rank-1 vs shipped gallery (read-only unless TWINFRAME_SAVE_BASELINE=1)
npm run test:parity                 # full-catalog enroll/query parity from tracked descriptors
node scripts/evaluate-accuracy.mjs  # legacy-geometry tier benchmark (writes reports/*.json; ~30+ min CPU)
npm run build                       # ort asset copy + vite build + post-build patch + db:migrate
```

CI additionally gates the interactive a11y smoke (`scripts/a11y-smoke.mjs`, needs a dev
server) and the throttled-CPU performance probe (`scripts/perf-throttle.mjs`, 15s budget).

- Expected steady state (2026-08, night branch): all of the above exit 0.
- `evaluate-accuracy.mjs` regenerates tracked files under `reports/`. Restore them
  (`git checkout -- reports/`) unless the run is the deliberate new baseline you are committing.
  `test:heldout` only writes a report when given `--json <path>` (CI) or
  `TWINFRAME_SAVE_BASELINE=1`; bare runs are read-only.
- Lint (`npm run lint`) is advisory today; do not treat its current findings as green.

## Eval scripts (what proves accuracy claims)

| Script | What it measures | Honest? |
|---|---|---|
| `scripts/evaluate-accuracy.mjs` | Tier-probe Top-1/Top-5/MRR/margins/latency vs v4 q8 gallery | Probes overlap enrollment portraits — treat as *pipeline sanity*, never as user-facing accuracy |
| `scripts/evaluate-held-out-v2.ts` (`npm run test:heldout`) | Leak-excluded Rank-1 of AdaFace IR-101 512-d held-out descriptors vs the exact gallery the app loads, via the real `rankByDescriptor` | **The headline number** (100.0% Rank-1 / MRR 1.000, n=296, 2026-08, full 512-d geometry; `reports/held-out-v2-baseline.json`). CI floor 75%. Enforces probe dim == gallery header dim and excludes any probe whose source file matches a gallery artifact by path OR content hash; `scripts/held-out-protocol.test.mjs` pins all three rules plus parser/browser parity; `scripts/held-out-headline.test.mjs` pins the advertised number to that JSON. Ranking gallery **1105** buckets+templates after 6.5.59 extras. |
| `scripts/rebuild-gallery-v5.mjs` | embed/fetch/assemble/eval/thumbnails phases for the multi-shot v5 gallery | Resumable, sha256-cached; excludes anything that fails detection/clustering |
| `scripts/test-non-face-rejection.mjs` | Non-face input rejection end-to-end | Hard-case suite; port into CI |

Rules for any new accuracy claim:

1. State the probe source and whether probes can appear in enrollment data. Leakage must be
   measured or structurally impossible, and the claim must say which.
2. Publish methodology in a **test** (see `scripts/evaluate-accuracy.test.mjs`) or in code that
   tests assert on — not in prose numbers that nothing executes.
3. Distance→percent mapping is calibrated honesty territory: either calibrate against held-out
   data or label the UI output uncalibrated. Tests must pin which one ships.

## Non-negotiables

- **On-device only.** Never add a code path that uploads user photos or descriptors to a server.
  Server functions exist for auth/app shell, never for face data.
- **Likeness & biometrics legal surface.** Gallery photos are Wikipedia thumbnails used
  demo/educationally; keep that framing honest in UI copy and docs. Do not add galleries of real
  people without preserving the attribution story and the demo framing.
- **No fabricated data.** Enrollment/eval pipelines exclude images that fail detection or
  clustering and report the exclusions; never fake descriptors, genders, or ages to pass a gate.
- **WASM binaries.** The four loaded ORT runtime WASMs are committed real binaries (~13–27MB);
  the three unused variants stay 24-byte placeholders. Never commit regenerated WASM output.
  `npm run copy:ort` restores real assets from `node_modules/onnxruntime-web/dist` if a checkout
  ever ships placeholders (it runs inside `npm run build`).

## Environment gotchas (executed truths)

- Use `npm install`, never `npm ci` — the committed lockfile is intentionally slightly out of
  sync; `npm ci` fails.
- Dependency install scripts are gated by `allowScripts` in `package.json` (`canvas`, `sharp`);
  if a new native dep needs a postinstall, use `GROK_ALLOW_INSTALL_SCRIPTS=1` deliberately and
  audit it first.
- Playwright/headless QA of the dev server: launch Chromium with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  Note `scripts/browser-smoke.mjs` serves from a built `.vercel/output`, not the dev server.
- Alternative CPU eval harness without a browser:
  `node scripts/evaluate-accuracy.mjs --tier 1 --limit 8 --concurrency 4 --verbose`
  (~24s/face; always use `--limit` during iteration).
- `npm test` uses `node --experimental-strip-types`; test files are `src/**/*.test.ts` and
  `scripts/*.test.mjs`.

## Architecture map

```
src/lib/face/
  scrfd.ts, accuface-detection.ts   # detection (+ crop-face-detector worker path)
  similarity-transform.ts           # 5-pt ArcFace canonical Umeyama alignment (112×112 ref)
  edgeface.ts, onnx-engine.ts       # AdaFace IR-101 512-d embedder on onnxruntime-web (primary; file still named edgeface)
  faceapi-engine.ts                 # legacy FaceNet-128/tfjs engine (re-encode tooling still uses it)
  embeddings.ts                     # v4 q8 binary parse ("AFv4", int8 biased+globalScale), cosine,
                                    #   Hill curve P(d)=100/(1+(d/d0)^n), demographic affinities
  match.ts                          # rankByDescriptor: cosine-primary ranking + soft age/gender
                                    #   priors; presentable-rank gender policy; verified-jpg-only
                                    #   gallery from buildMultiShotCentroidGallery
  open-set-score.ts, lookalike-policy.ts  # margin-aware percents + distance gates
  anti-gan.ts, biohash.ts           # legacy session projections (bypassed in live pipeline)
  gallery-dedupe.ts                 # multi-shot centroids, poisoned-cluster drop, thumb-only ranking filter
public/celebs/
  embeddings.v4.q8.bin + gallery.buckets.json + index.json   # catalog 1024; ranking uses verified jpg primaries only
  extra-templates.json                                       # gated AdaFace extra views merged at runtime
  held-out/descriptors.json                                  # tracked eval probes (AdaFace-512d, Node enroll path)
reports/                           # generated eval artifacts (tracked; restore after local runs)
migrations/0001_auth.sql           # better-auth schema (do not edit)
```

Dimension discipline: the live AdaFace IR-101 path and the shipped v4 q8 gallery are BOTH 512-d
(the "AFv4" header carries the truth — trust it for stride and width; a hardcoded stride once
halved every vector silently). Legacy face-api tooling also emits 128-d descriptors.
`rankByDescriptor` normalizes whatever arrives — when adding an engine, extend the distance
plumbing rather than assuming any fixed dimension.

## Conventions

- ESM `import`/`export`; `@/*` alias maps to `src/*`.
- `.ts`/`.tsx` for source; `.mjs` for scripts; tests named `*.test.ts` / `*.test.mjs`.
- Match surrounding style; no comments unless the code needs them; no TODOs in shipped paths.
- New behavior lands with tests: happy path, boundary, explicit error, adversarial case.
