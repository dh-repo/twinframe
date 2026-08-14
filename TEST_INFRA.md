# E2E Test Infra: TwinFrame Biometric & Gallery Enhancement

## Test Philosophy
- Opaque-box, requirement-driven verification derived directly from `ORIGINAL_REQUEST.md`.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.
- Zero dependency on internal implementation details; assertions test external APIs, mathematical invariance, UI rendering, and accessibility.

---

## Feature Inventory & Test Matrix
| # | Feature | Source (Requirement) | Tier 1 (Coverage) | Tier 2 (Boundary & Corner) | Tier 3 (Cross-Feature) |
|---|---------|---------------------|:-----------------:|:--------------------------:|:----------------------:|
| F1 | Billie Eilish Studio Portrait Replacement | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| F2 | Re-extracted 128-d TTA Descriptor | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| F3 | Re-extracted 23-d FaceFeatures & 3D Proportions | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| F4 | Gallery Metadata Synchronization | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| F5 | Calibrated Age-Gap Penalty Function | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| F6 | Weak-Match Age Demotion Integration | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| F7 | Strong Match & Peer Invariance | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| F8 | 4-Part Anatomical Trait Breakdown Builder | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| F9 | Granular Biometric Breakdown UI Component | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| F10 | Comparison View Morphological Breakdown | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |

Total identified features $N = 10$.
- Minimum Tier 1 tests: $5 \times 10 = 50$ test cases.
- Minimum Tier 2 tests: $5 \times 10 = 50$ test cases.
- Minimum Tier 3 tests: $10$ combinatorial test cases.
- Minimum Tier 4 tests: $\max(5, 10 / 2) = 5$ real-world scenarios.
- Total minimum target: $\ge 115$ test cases.

---

## Test Architecture
- Test Runner: Node.js test runner via `npx tsx --test` and Playwright browser smoke via `node scripts/browser-smoke.mjs`.
- Test Files:
  - `tests/e2e/r1-gallery-curation.test.ts`: Verifies image dimensions, pitch/yaw pose bounds, forehead occlusion checks, 128-d and 23-d vector validity, metadata sync across `.bin` and `.json`.
  - `tests/e2e/r2-age-penalty.test.ts`: Verifies $P_{age}$ mathematical thresholds ($d \le 0.40 \implies 0$, $|\Delta age| \le 20 \implies 0$, $d > 0.40 \land |\Delta age| > 20 \implies P_{age} > 0$), monotonicity, candidate ranking inversion under mature queries, lookalike preservation.
  - `tests/e2e/r3-biometric-ui.test.ts`: Verifies 4-part trait generation, label naming, similarity bounds [0, 1], presence in `MatchRevealCard` and `ComparisonView`, accessibility attributes.
  - `tests/e2e/r4-scenarios-integrated.test.ts`: Real-world end-to-end user workflows (mature adult query, young adult query, twins, weak match fallback, trait visualization).

---

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | 55-Year-Old Adult Query with Weak Matches | F5, F6, F7, F8, F9 | High: Verifies that 20yo candidates with $d > 0.40$ are demoted below ~50yo candidates with similar $d$, and UI renders all 4 traits cleanly |
| 2 | 22-Year-Old Query Matching Billie Eilish | F1, F2, F3, F4, F8, F9 | High: Verifies clean match with new Billie Eilish portrait vectors, realistic age estimation, and 4-part morphological breakdown |
| 3 | Strong Twin Lookalike Query ($d = 0.28$) with Large Age Gap | F5, F7, F8, F9 | High: Verifies zero age penalty applied when $d \le 0.40$, preserving true biometric lookalike twin regardless of age discrepancy |
| 4 | Low-Confidence / Weak Biometric Query ($d = 0.52$) | F5, F6, F8, F9, F10 | Medium: Verifies that even on weak matches, all 4 anatomical progress bars render (no single-bar regression) with honest low/moderate percentages |
| 5 | Morphological Trait Comparison in Side-by-Side View | F8, F9, F10 | Medium: Verifies consistency between MatchRevealCard trait percentages and ComparisonView biometric values |

---

## Coverage Thresholds
- Tier 1: $\ge 5$ test assertions per feature (50 total).
- Tier 2: $\ge 5$ boundary/corner cases per feature (50 total).
- Tier 3: Pairwise feature interactions covering all major pipelines.
- Tier 4: $\ge 5$ realistic end-to-end application scenarios.
- All tests must pass with exit code 0 under `npm test` and `npx tsx --test`.
