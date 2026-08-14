# E2E Test Infra: Twinframe Face-Matching Accuracy Optimization

## Test Philosophy
- Requirement-driven, objective, empirical evaluation of facial feature recognition accuracy, metric monotonicity, and candidate ranking.
- Methodology: Multi-tier probe evaluation + Category-Partition + Boundary Value Analysis + Adversarial Distractor Verification.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|---------------------|:------:|:------:|:------:|:------:|
| 1 | Automated Accuracy Benchmark | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | Landmark Alignment Parity | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 3 | Pure Feature Descriptor Fidelity | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 4 | Binary Gallery & Loader Sync | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |
| 5 | Identity & Metadata Integrity | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |
| 6 | Similarity Metric & Prior Calibration | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 7 | Full Accuracy & Margin Verification | Acceptance Criteria | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Automated Benchmark Runner**: `scripts/evaluate-accuracy.mjs` (Invoked via `node scripts/evaluate-accuracy.mjs`)
- **Unit & Integration Test Suite**: Vitest suite (`npm test`)
- **Type Checking**: TypeScript compiler (`npm run typecheck`)
- **Production Build**: Vite build (`npm run build`)

## Evaluation Tiers
1. **Tier 1: Clear Frontal Celebrity Test Probes (N >= 50)**: High-resolution clear frontal portraits of enrolled celebrities. Target: $\ge 85\%$ Top-1, $\ge 95\%$ Top-5.
2. **Tier 2: Moderate Pose & Lighting Variation (N >= 30)**: Yaw $\pm 15^\circ \sim 25^\circ$, natural expressions, varied illumination. Target: $\ge 75\%$ Top-1, $\ge 90\%$ Top-5.
3. **Tier 3: Pairwise Cosine Distance Margins**: Evaluation of true match cosine distance vs nearest negative distractor ($\Delta s = s_{\text{true}} - \max_{j \neq \text{true}} s_j > 0$).
4. **Tier 4: End-to-End Pipeline & Latency Profiling**: Real-world probe execution measuring detection, alignment, embedding extraction, matching latency ($t_{\text{total}} < 50\text{ms}$).
5. **Tier 5: Adversarial Stress & Forensic Integrity**: White-box edge cases, extreme aspect ratios, inverted orientations, unseeded inputs, and forensic integrity verification.

## Coverage Thresholds
- Baseline accuracy evaluation completed in M1.
- Final acceptance target: $\ge 85\%$ Top-1, $\ge 95\%$ Top-5 on clear/moderate pose ground-truth probe sets.
- Strict positive cosine margin ($\Delta s > 0$) for true celebrity matches.
- Clean forensic audit (Zero integrity violations).
