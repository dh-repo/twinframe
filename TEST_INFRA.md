# E2E Test Infra: Twinframe Scoring & Calibration Overhaul

## Test Philosophy
- Requirement-driven verification of accuracy, calibration, performance, and cross-demographic alignment.

## Feature Inventory & Verification Target Matrix
| # | Requirement / Feature | Source | Target Criterion | Verification Method |
|---|----------------------|--------|------------------|---------------------|
| 1 | Cross-Demographic False Match Elimination | R1, R4 | 0 false matches in top-3 across distinct ethnic clusters | Benchmark harness (`evaluate-match-accuracy.ts`) & `match-accuracy.test.ts` |
| 2 | Similarity Floor & Lookalike Gate | R2 | $d > 0.40$ yields $< 25\%$ similarity score or returns "No Close Match" | `phase4-scoring-math.test.ts` & `match.test.ts` |
| 3 | Separation Gap Improvement | R1, R2, R4 | True positive separation gap improves by $\ge 30\%$ ($\Delta \ge 0.2309$) | `evaluate-match-accuracy.ts` baseline comparison |
| 4 | Top-1 Ground-Truth Accuracy | R3, R4 | Top-1 accuracy exceeds $95.0\%$ | Honest perturbed-query benchmark in `match-accuracy.test.ts` |
| 5 | Build & Quality Integrity | Acceptance Criteria | `npm test`, `npm run typecheck`, `npm run build` 100% clean | Shell validation scripts |

## Verification Commands
- Unit & Integration Test Suite: `npm test`
- Face Match Test Suite: `npm run test:match`
- Fast Accuracy Benchmark: `npm run gallery:eval`
- Strict Accuracy Benchmark: `npx tsx scripts/evaluate-match-accuracy.ts --compare-baseline public/celebs/baseline.json --strict`
- TypeScript Compilation: `npm run typecheck`
- Production Build: `npm run build`
