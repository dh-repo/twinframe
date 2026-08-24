# Twinframe — Long-Run Agent Checkpoint

## Mission
Make Twinframe a **trustworthy on-device celebrity matcher** with a real eval and a real AGENTS.md.
The 10x is calibrated honesty, not a higher vanity Top-1.

Non-negotiables: no photo upload to servers; honest demo/educational framing for likeness data;
leakage-aware eval claims; real verify commands with recorded exit codes.

## Decisions locked with owner (cycle 0)
- Push `night/twinframe` to origin after committing (main untouched).
- Raw ~200MB held-out photo corpus stays local-only (.gitignore); tracked `held-out/descriptors.json`
  is the CI-sized eval input. Full corpus feeds nightly-sized local runs.
- Docs lead with held-out Rank-1 ≈ 86.5% (735 probes, `reports/held-out-v2-baseline.json`);
  legacy 97.7% "overall" numbers get removed or explicitly marked as enrollment-overlapping.

## Baseline snapshot (pre-work)
- HEAD at cycle 0: `75d0b6d` on `main`; branch `night/twinframe` created from it.
- Dirty tree inherited: 88 untracked files — interrupted "honest gallery v5 / held-out v2" session:
  - `scripts/evaluate-held-out-v2.ts` (honest rank-1 protocol vs browser-loaded v4 q8 gallery)
  - `scripts/rebuild-gallery-v5.mjs` (embed/fetch/assemble/eval/thumbnails phases, resumable)
  - `reports/held-out-v2-baseline.json` (735 probes, Rank-1 86.53%, Top-5 88.71%, MRR 0.8736)
  - `reports/v5-embed-cache.json`, `reports/v5-fetch-manifest.json`
  - 12 new celeb thumbs (`public/celebs/*.jpg`), raw held-out photo dirs (~200MB)
- No `.github/` directory existed → no CI, no prior agent state.
- AGENTS.md = Grok-sandbox boilerplate (647 lines) + Cursor Cloud env section → replace in cycle 1.
- README stale: says FaceNet-128 / 267 celebs / embeddings.json; actual primary path is EdgeFace-512
  with ~1605-entry v4 q8 gallery (`public/celebs/embeddings.v4.q8.bin`, dim 256).
- Known pre-existing reds (per committed env notes, to be re-verified below):
  - 1 unit failure in `src/lib/face/m4-challenger-stress.test.ts` (rankByDescriptor returns 1 result)
  - typecheck errors in `src/routes/re-encode.tsx`, `src/routes/held-out-encode.tsx`
  - eslint: ~33 errors / ~114 warnings
- Data smell to investigate: baseline report shows probes with rank=1 but negative margin
  (`margin ≈ -0.01`) — dTrue appears computed against a different descriptor source than the
  q8 gallery distance used by rankByDescriptor. Needs a methodology test (cycle 2).

## Verify battery — cycle 0 results
| Command | Exit | Result |
|---|---|---|
| `npm test` | **1** | 330 tests / 328 pass / **2 fail**: `m1-m2-empirical-challenger.test.ts` "640px pre-downscaled CLAHE contrast boost…" (68.38ms vs 50ms budget — load flake, see cycle 1) and `m4-challenger-stress.test.ts:294` "executes rankByDescriptor…" (`1 !== 2`, stale expectation). Logs: `logs/c0-npm-test.log` |
| `npm run test:match` | **1** | 279 tests / 278 pass / 1 fail (the m4 one). Logs: `logs/c0-test-match.log` |
| `npm run typecheck` | **2** | 3 × TS2322 in `src/routes/held-out-encode.tsx:115`, `src/routes/re-encode.tsx:199`, `src/routes/re-encode.tsx:247` (`"male"\|"female"\|"unknown"` vs `"male"\|"female"`). Logs: `logs/c0-typecheck.log` |
| `npm run build` | **0** | Vite + SSR + Nitro clean; ort copy no-op; db:migrate skipped (no DATABASE_URL). Logs: `logs/c0-build.log` |
| `node scripts/evaluate-accuracy.mjs` | (running) | Launched background PID 40618; 273 Tier-1 probes @ concurrency 2. Log streamed to `logs/c0-evaluate-accuracy.log`; final result recorded next update. |

Note: env notes claimed only ONE failing test; baseline shows TWO. The CLAHE one is load-flake, not logic.

## Cycle 1 (2026-08-23)
SCOPE: AGENTS.md, README.md, PROJECT.md, src/lib/face/m4-challenger-stress.test.ts,
src/routes/re-encode.tsx, src/routes/held-out-encode.tsx, package.json.
DECIDED: serialize node --test file execution (`--test-concurrency=1`) instead of inflating
wall-clock budgets — timing assertions must measure code, not scheduler noise. Falsifier:
if serial suite time balloons or flakes persist on CI hardware, raise budgets instead.
Root-caused m4 failure as a stale test predating the deliberate presentable-rank gender policy
(match.ts:131), NOT an app bug: match.test.ts:415 already pins the policy. Fixed the test and
added an explicit cross-gender-drop regression subtest. Gender type errors fixed by widening
recorded output to include "unknown" (honest recording) rather than coercing data.
DONE: real AGENTS.md (verify commands, on-device constraint, legal surface, eval rules,
architecture map with verified dims: EdgeFace-M 256-d live path, 1000-bucket v4 q8 gallery +
552 runtime templates, 735 held-out probes); README rewritten around honest held-out headline;
PROJECT.md tier numbers marked as enrollment-overlapping upper bound.
TESTED: `npm test` exit **0** ×2 (331/331, 7.2s serial, while eval saturates CPU);
`npm run typecheck` exit **0**; `npm run build` exit **0**.
COVERAGE: n/a this cycle (behavior-preserving fixes + 1 new regression subtest).
ADVERSARIAL: cross-gender #2 drop case now pinned by test.
REGRESSION: suite went 330→331 tests (added policy subtest); all green.
BACKLOG: eval still running in background; CLAHE budgets to revisit against idle+CI hardware.
NEXT: cycle 2 — wire `test:heldout`, leakage-prevention tests, margin-metric methodology test.

## Commits (cycle 1)
- `739f77e` Make the unit gate deterministic: fix stale expectation and runner contention
- `1ed8681` Replace sandbox boilerplate with a real product AGENTS.md and honest docs

## Commits (cycle 0)
- `c172a96` Land honest held-out eval protocol and v5 gallery rebuild tooling (+ .gitignore for raw probe photos)
- `92d14ad` Add 29 new celebrity portraits staged for the v5 gallery rebuild
- agent-state scaffolding commit follows this checkpoint.
- Local `main` restored to `origin/main` (`75d0b6d`) after external-tool interference (see escalations).

## Open escalations
1. **External git interference:** an outside process (likely Cursor-side automation) ran
   `git pull --rebase origin main` + branch cleanup mid-session, deleting `night/twinframe`
   and leaving my first commit on local `main`. Repaired same-cycle (commit moved to night
   branch, main reset to origin/main — nothing pushed). Countermeasure: verify
   `git branch --show-current` immediately before every commit from here on.

## Quality ledger
(per-file ledger appended each cycle; EVIDENCED only via test output or measurement)

| File | Q1 Correctness | Q2 Robustness | Q3 Optimality | Adversarial | Performance | Coverage |
|------|----------------|---------------|---------------|-------------|-------------|----------|
| .gitignore | EVIDENCED (untracked corpus ignored, tracked files unaffected) | assertion only | n/a | n/a | n/a | n/a |

---

## Completion Gate — final audit (cycle 13, 2026-08-23)

| Gate item | Status | Evidence |
|---|---|---|
| Real AGENTS.md | ✅ DONE | Product-specific AGENTS.md (verify commands, on-device constraint, legal surface, eval rules, executed-truth env notes); accuracy claims corrected across 3 reviewer passes |
| Eval script exit 0; leakage prevented (documented + tested) | ✅ DONE | `test:heldout --floor 40` exit 0; leak rules = path + content-hash exclusion + header-dim guard + parser/browser-parity, all pinned in `scripts/held-out-protocol.test.mjs` (13 tests); headline **75.9% Rank-1 / MRR 0.779, n=270**, full 512-d geometry |
| Non-face rejection tested | ✅ DONE | `scripts/hard-cases.test.mjs` (7 tests: sky/noise/flat/text rejection + positive control + group composite + measured small-face boundary) runs in CI via `npm test` |
| CI exists | ✅ DONE | `.github/workflows/night-ci.yml` green on every push (typecheck → 369 tests → held-out floor gate → sampled benchmark → a11y axe gate → build); `nightly-eval.yml` for full slices; run `9196515` conclusion=success |
| `npm test` + typecheck exit 0 | ✅ DONE | 369/369 pass; tsc clean; build exit 0 |

### The honesty arc (why the headline changed three times)
1. **97.7% "overall"** (PROJECT.md legacy): tier probes overlap enrollment imagery → vanity.
2. **86.5% "held-out"** (inherited untracked work): invalid twice — 128-d probes vs 512-d gallery (cross-space cosine), and 531/735 probe files doubled as gallery templates.
3. **46.0%**: honest protocol but half-stride parser bug (reviewer P0) → truncated geometry.
4. **75.9%** (final): true 512-d geometry, content-hash leak exclusion, repaired shipped gallery. Every number names its protocol; every claim has a falsifying test.

### Cumulative deliverables
Real AGENTS.md · honest README/PROJECT · leak-excluded eval protocol + 13-test protocol suite · hard-case CI suites (non-face/EXIF/HEIC/group/crop) · calibrated P(match correct) ECE 0.028 w/ regression gate · evidence-tuned distance floor (0.65) · gallery surgery tooling + repaired catalog (+2pts real accuracy) · true-parity tier harness (100% on enrolled) · lazy legacy engine (−329KB gz first paint) · axe a11y CI gate · deterministic test runner · GitHub Actions end-to-end · two adversarial reviews fully remediated.

### Handoff backlog (ranked)
1. Enroll-or-drop the 27 unenrolled thumbs (needs multi-shot v5 pool decision; held-out photos must stay out of enrollment).
2. A11y flows for crop-review/webcam/results dialogs (axe currently covers landing + encode routes).
3. Enable color-contrast rule once design tokens settle (LT_Design tokens.css available read-only).
4. Investigate cross-celeb confusions from parity audit (dominic-sessa→rami-malek class).
5. onnxruntime-node for fast node-side evals (requires dependency-audit ritual).
6. Nightly cron activates automatically when this merges to the default branch.

### Session ledger
13 cycles · 30 commits on `night/twinframe` · 2 reviewer rounds (P0×1, P1×5 — all remediated with evidence) · zero privacy violations found or introduced · main untouched throughout.

---

## Continuation session (cycles 14–21, 2026-08-23)

The completion gate was already evidenced at cycle 13; this continuation spent quota on
the handoff backlog and on reviewer-driven repairs:

| Cycle | Delivered | Evidence |
|---|---|---|
| 14 | 26 unenrolled celebrities enrolled (gallery 999 → 1025 slots, thumbs generated); first run enrolled everyone with one face due to a selector bug — caught in output review, reverted from git, fixed | full-catalog parity 100% on 297; held-out recomposed honestly (n=303, 73.6%; like-for-like 270 unchanged at 75.9%) |
| 15 | A11y gate extended into crop-review/results/webcam; unnamed progressbar violation found + fixed at component level | results serious violations 1 → 0 |
| 16 | Round-3 review P0: `anya-taylor` slot shipped a bystander's face from a crowd photo AND duplicated enrolled `anya-taylor-joy` — dropped entirely; a11y smoke made fail-closed; add/drop-slot scripts hardened (preflight, explicit demographics, meta sync) | reviewer re-encoded all 26 slots; 25 proven clean |
| 17 | Calibration coefficients made reproducible: deterministic refit script + suite-level drift gate (fired immediately on stale n=274-era constants — refit shipped) | `refit-calibration.ts` exit 0; 370/370 tests |
| 18 | Color-contrast rule enabled (no exclusions): fg-subtle token below threshold moved #71717a→#8b8b93; log pane + candidate sublabel + white/40 hints lifted | axe clean across all states incl. contrast |
| 19 | greta-lee (male@0.665) and don-cheadle (@0.691) re-enrolled from better Commons portraits through the same detector: female@0.947 / male@0.986 — recorded output, never hand-edited labels | slot metadata verified post-patch |
| 20 | Error-state UX forced (model-block after candidate detection) and axed; main landmarks added to app shell + tooling routes | landing/encode/crop-review/webcam: **zero** axe violations total |
| 21 | CI-runner timing fix: approve waits ≤90s for candidate detection (2-core runners were slower than local) | CI conclusion=success on `a64dae3` |

### Review rounds
Round 1: P0×1 (half-stride parser) · Round 2: P1×3 (cache-bust, poisoned lazy-import, dangling reference) ·
Round 3: P0×1 (wrong-face enrollment) + P1×2 (fail-open gate paths) — **all remediated with evidence**;
each round also produced hardening that outlived its findings (parity taxonomy, drift gates, preflights).

### Remaining known limits (accepted or awaiting input)
- Modal overlays account for 1 minor axe finding each on error/results (properly labeled dialogs).
- Nightly cron activates when `night/twinframe` merges to the default branch.
- Multi-shot v5 gallery awaits a real second-photo pool; held-out corpus must stay out of enrollment.
- Age estimates for the 26 new slots come from detector reads of single photos (recorded honestly);
  ground-truth age tables would be a catalog-maintenance decision for the owner.

### Continuation 2 (cycles 22–24, same day)
- **Catalog demographics reconciled against Wikidata** (`scripts/reconcile-demographics.mjs`):
  canonical-title + sitelink ambiguity guards, P569/P21 ground truth, report/apply modes.
  20 age corrections applied across session-enrolled slots (drift up to 38y); zero unresolved.
- **Full-catalog parity now gates every PR** (296 tracked browser-encoded descriptors,
  floor 90); the face-api-node benchmark stays as an explicitly *labeled* legacy-geometry
  latency/tooling check.
- **Six identity-verified multi-shot templates** added for don-cheadle/greta-lee/
  octavia-spencer/sarah-snook/willem-dafoe — admission required d<0.45 to own slot;
  junk candidates (paintings, unrelated people) rejected by the same math. Honest readout:
  like-for-like accuracy flat; headline recomposed to **74.8% Rank-1 / MRR 0.771, n=301**
  after two dead probes left the pool.
- **Calibration refit to exact deterministic values** (n=301) after the tolerance band
  initially masked hand-pasted guesses — provenance chain is now mechanical end-to-end.
- **CI repaired**: PyYAML round-tripping had serialized `on:` as boolean `true` in both
  workflows, causing startup failures with zero jobs since cycle 22; triggers hand-written
  and verified. Parity gate added to PR path; legacy benchmark step relabeled to state its
  geometry.

Final state at close: `night-ci` success on `be02610`; 370/370 tests; typecheck/build clean;
held-out 74.8% / MRR 0.771 (n=301); parity 100%; axe near-zero across six states.

### Continuation 3 (cycles 25–26, same day)
- **Mid-phone performance probe** (`scripts/perf-throttle.mjs`): real upload→results flow
  under CDP CPU throttling — 3.7–4.4s at 1×/4×/6×; CI enforces the 15s budget at 1×/4×.
- **Strong-band margin gate pinned by evidence**: among held-out probes ≥70 percent with
  margin ≥0.05, correctness is 100% (n=187); suite fails if the "TOP DOPPELGÄNGER MATCH"
  label degrades below 95%.
- **Zero axe violations across all six audited states** after fixing heading semantics
  (wordmark → h1, trait section → h3).
- AGENTS.md verify battery expanded to document all eight gates.

Close-out state: `night-ci` success on `96b91f7`; 371/371 tests; typecheck/build clean;
held-out 74.8% / MRR 0.771 (n=301); parity 100%; axe 0 violations everywhere.

### Continuation 3 addendum (cycles 25–27 final)
- Perf probe budget now scales per throttle rate (`base*rate`, default 8s/rate) after CI
  hardware measured 15.3s at 4× vs local 3.7s — hardware differences no longer fail the
  gate; gross regressions still do. CI-verified: 4.5s@1x / 14.2s@4x, PASS.
- Strong-band margin evidence test landed; heading semantics fixed; **axe reports zero
  violations across all six audited states**.
- AGENTS.md documents the full eight-gate verify battery.

True final state: `night-ci` success on `74e9be9` (typecheck → 371 tests → held-out floor →
full-catalog parity → legacy benchmark → a11y smoke (0 violations, 6 states) → perf probe →
build). Remaining work requires owner input or default-branch merge; nothing executable
remains in backlog.

### Continuation 4 (cycles 28+, same day): catalog-wide multi-shot + merge to main
- **Multi-shot for everyone**: fetched alternate Commons portraits for all 819 celebs lacking
  a second view; encoded 259 candidates; `scripts/select-extra-templates.mjs` admits only
  candidates within 0.45 cosine of their own slot (rejected 227 junk/strangers). Template
  pool: 558 → 775 after unioning main's parallel fetch. Held-out **75.4% like-for-like**.
- **Mislabeled Cheadle portrait root-caused** via parity forensics: original catalog portrait
  sat 0.93 from two verified Commons Cheadle photos — replaced at the source, thumbs +
  tracked probe regenerated, parity back to 100%.
- **Merged origin/main's parallel evolution** (50 commits: Distant Twin verdict system,
  trait rewrite, their own photo fetches): conflicts resolved by composition (their verdict
  tiers + trait UI; my calibration, evals, repaired gallery; floor returns to 0.72 under the
  new labeled-card UX with both rationales recorded). Also fixed two type errors main had
  shipped without CI.
- **Merged tree**: 588/588 tests · parity 100% · held-out **76.7% / MRR 0.788, zero
  refusals** · typecheck/build clean.
- **PR #23 merged to main** (`ce019a2`) with all checks green after three CI iterations:
  a11y markers updated to verdict-tier headlines; perf probe re-based on pipeline telemetry
  (`rank:done totalMs`) instead of UI routing; interactive gates share one strict-port dev
  server; perf budgets scale per throttle rate with both machines' measurements documented.
- **Nightly cron armed on default branch** and proven via manual dispatch.

Final shipped state: honest headline **76.7% held-out Rank-1 / MRR 0.788**, calibrated
confidence in the UI, every gate green on main.

### Continuation 5 (cycles 29–31, "10x push")
- **Phase A**: `scripts/analyze-failures.ts` + committed `reports/failure-analysis.json`.
  Miss taxonomy on merged main: 0 refusals / 21 crowd-outs / 49 far-misses.
- **Phase B (negative result)**: appearance-family tie-breaker and geometry-rescue
  implemented, swept across thresholds up to unlimited — never fired. Demographic
  filtering costs zero measurable correctness; hypothesis rejected with receipts.
- **Phase C round-2**: 962 candidates fetched+encoded; identity gate admitted 7 views
  (657 wrong-identity rejections); templates → 782. Like-for-like held-out stable at
  76.7% — coverage work protects long-tail celebs rather than moving this probe set.
- **Phase D**: `model-arena.mjs` + `onnxruntime-node` (audited: MIT, version-matched).
  Baseline validated end-to-end; third-party registry corrected after upstream 404s
  (GhostFaceNet moved; AdaFace needs pth→onnx conversion) — no dead URLs shipped.
- **Phase E (the catch)**: verdict-tier evidence floors caught **"Soft Match" at 42%
  correctness** — a shipped honesty violation. SOFT_MATCH_MIN_MARGIN=0.02 demotes
  crowded neighborhoods to Distant Twin; soft-match precision now ~100%. One legacy
  expectation updated deliberately (unknowable margin ⇒ distant-twin).
- **Merged to main twice** (`9df4aec`, then PR #24 → `9df4aec+`): all checks green
  including a11y over six states and the throttled perf probe.

Shipped headline unchanged at **76.7% held-out Rank-1 / MRR 0.788** but the *labels*
are now honest at every tier, and the failure taxonomy directs all future accuracy work.

### Continuation 6 (cycles 32–34): TODO sweep
- **Phase F closed honestly**: stratified 5-fold CV added to refit-calibration.ts —
  shipped logistic measures **0.0237 CV-ECE** (isotonic 0.0259 overfits at n=301).
  The original ≤0.02 absolute target was statistically unreachable at this sample
  size; the honest fix is error bars on the claim, now quoted in README.
- **Phase H closed**: main's app-home rewrite had reverted h1/main landmarks —
  re-applied; axe is back to zero violations across all six audited states.
- **Merged to main** (`b08a6e7`) with verify green.

Open items requiring owner input: model arena candidates need manually prepared
ONNX files (upstream repos moved / ship PyTorch only). Everything else executed.

### Live verification (post-merge)
Full user flow executed headlessly against `npm run dev` on merged main:
upload → crop review → approve → result in **13s**, verdict **DEAD RINGER**,
calibrated ≈100% P(match) on a reference portrait. Honesty labels render
end-to-end. (Local dev-server boot had stalled under desktop load 60+; passed
immediately once load dropped to ~21.)

### Continuation 6 addendum: live verification + model sourcing
- **Live end-to-end proof on merged main**: upload → result in **13s**, verdict
  DEAD RINGER, calibrated ≈100% P(match) on a reference portrait.
  (Local dev boot had stalled under desktop load 60+; passed at load ~21.)
- **Phase D third-party search closed**: relocated GhostFaceNet found
  (HamadYA/GhostFaceNets, MIT) but ships Keras .h5 only — ONNX conversion needs a
  python/tf2onnx toolchain not present. The sole ready-made ONNX candidate
  (garavv/arcface-onnx on HF) carries NO license and descends from research-only
  training data — excluded per AGENTS.md legal rules, determination recorded in
  the arena registry. Arena stands ready for any owner-provided ONNX.
