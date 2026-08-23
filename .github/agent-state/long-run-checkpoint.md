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
