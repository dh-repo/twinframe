# Milestone M2 Evaluation & Empirical Challenge Report

## 1. Observation
Direct empirical observations and execution results for Milestone M2 (Twinframe):

- **Build and Test Verification**:
  - `npm run typecheck` (`tsc --noEmit`) completed with exit code 0.
  - `npm test` (`node --experimental-strip-types --test 'src/lib/face/**/*.test.ts' 'scripts/**/*.test.mjs'`) passed 64 out of 64 unit tests across 16 test suites (duration ~151ms).
- **Matching Algorithm Implementation Inspection**:
  - `src/lib/face/embeddings.ts` (lines 271–276): Hill Equation calibration function:
    ```ts
    export function distanceToMatchPercent(distance: number): number {
      const d = Math.max(0, distance);
      const hill = 15.0 + 85.0 / (1 + Math.pow(d / 0.58, 3.2));
      const pct = Math.max(15.0, Math.min(100.0, hill));
      return Math.round(pct * 10) / 10;
    }
    ```
  - `src/lib/face/embeddings.ts` (lines 306–309): Continuous Gaussian age affinity function:
    ```ts
    export function ageAffinity(userAge: number, celebAge: number): number {
      return Math.exp(-Math.pow(Math.abs(userAge - celebAge) / 28, 2));
    }
    ```
  - `src/lib/face/embeddings.ts` (lines 295–304): Continuous gender affinity prior function:
    ```ts
    export function genderAffinity(
      userGender: "male" | "female" | "unknown",
      userProb: number,
      celeb: CelebrityEmbedding,
    ): number {
      if (userGender === "unknown") return 1;
      if (userGender === celeb.gender) return 1;
      const prob = Math.max(0, Math.min(1, userProb));
      return Math.max(0.75, Math.min(1, 1 - 0.22 * prob));
    }
    ```
  - `src/lib/face/embeddings.ts` (lines 279–293): Rank percents tie-breaker and order preservation function `rankPercentsFromDistances`.
  - `src/lib/face/match.ts` (lines 33–90): `rankByDescriptor` pipeline combining ensemble distance (0.72 euclidean + 0.28 cosine), gentle age/gender priors, deduplication by celebrity ID, and confidence scoring.
- **Empirical Stress Test Execution** (`.agents/teamwork_preview_challenger_m2_1/stress_test.ts` executed via `node --experimental-strip-types`):
  - **Monotonicity**: Evaluated across 1,000 fine evaluation steps in $d \in [0, 2.0]$ ($step = 0.002$). Recorded 0 monotonicity violations ($P(d_i) \ge P(d_{i+1})$ for all 1,000 steps). Max single-step drop $= 0.3000\%$. Peak percentage at $d=0.0$ is $100.0\%$; asymptotic floor at $d=2.0$ is $16.6\%$ (approaching theoretical $15.0\%$ floor).
  - **Edge Cases**:
    - $d = 0 \to 100.0\%$
    - $d < 0$ (e.g. $d = -0.5, -10^9$) $\to 100.0\%$ (safely clamped via `Math.max(0, distance)`).
    - $d = \text{Infinity} \to 15.0\%$ (floor bound).
    - $d = -\text{Infinity} \to 100.0\%$ (clamped).
    - $d = \text{NaN} \to \text{NaN}$ (handled safely without throwing unhandled exceptions).
    - $d = 10^{10} \to 15.0\%$ (floor bound).
  - **Age Affinity Smoothness**: Evaluated across $\Delta \in [0, 80.0]$ with step $0.1$. Zero monotonicity violations. Maximum derivative step change $< 0.00026$, proving $C^\infty$ smooth continuity without step discontinuities. Negative age inputs (e.g. $-5$) and extreme age deltas (100 yrs) evaluated smoothly within $(0, 1]$.
  - **Ranking Order & Deduplication**:
    - Ascending distance inputs $[0.35, 0.45, 0.55, 0.65, 0.75]$ map to strictly descending percentages $[85.9\%, 73.9\%, 61.1\%, 49.8\%, 40.9\%]$.
    - Tied distance inputs $[0.50, 0.50, 0.50]$ produce strict tie-broken rank percentages $[67.4\%, 67.3\%, 67.2\%]$.
    - Multi-bucket gallery entries are successfully deduplicated by celebrity ID, selecting the best age-bucket corresponding to the user query age.

## 2. Logic Chain
1. From the observation that `distanceToMatchPercent` uses `Math.max(0, distance)` and Hill Equation parameters $(V_{max}=85.0, K=0.58, n=3.2, V_{min}=15.0)$, the output curve is guaranteed to strictly decrease from $100.0\%$ at $d=0$ to $15.0\%$ as $d \to \infty$. Empirical testing across 1,000 fine steps in $d \in [0, 2.0]$ verified 0 monotonicity violations and smooth calibrated scaling where raw distance $d=0.58$ maps to $57.5\%$.
2. From the observation that $ageAffinity(\Delta) = \exp(-(\Delta/28)^2)$, the age affinity is mathematically a Gaussian function with $\sigma = 28$. Its derivative is $-2(\Delta/28^2)\exp(-(\Delta/28)^2)$, which is continuous for all $\Delta \ge 0$. Stress testing across 800 steps confirmed continuous smoothness with max derivative change $< 0.00026$.
3. From the observation that `genderAffinity` bounds output in $[0.75, 1.0]$ and denominator in `rankByDescriptor` is $(0.72 + 0.18*g + 0.10*a)$, age and gender act as soft priors (at most ~12–17% distance adjustment) so face descriptor similarity remains the dominant factor.
4. From the observation that `rankPercentsFromDistances` enforces `v = Math.min(item.p, last - 0.1)`, tied raw distance scores are deterministically tie-broken with distinct $0.1\%$ steps, preventing confusing duplicate percentage displays in the UI while preserving strict rank order.
5. From the observation that `npm run typecheck` and all 64 unit tests pass without error, the M2 implementation satisfies TypeScript types and unit test constraints.

## 3. Caveats
- Evaluated $d \in [0, 2.0]$; values of $d > 2.0$ asymptote to $15.0\%$, which is the intended minimum display percentage specified by the interface contract.
- Gallery embeddings in `public/celebs/` are pre-quantized (q8) and L2-normalized upon loading to ensure accurate Euclidean and Cosine ensemble calculations.

## 4. Conclusion
The M2 matching algorithm and scoring calibration implementation is mathematically sound, robust against edge cases, strictly monotonic across 1,000 fine evaluation steps, smooth in auxiliary age/gender metrics, and preserves strict rank ordering.

**Verdict**: `APPROVE`

## 5. Verification Method
To independently verify this evaluation:
1. Run TypeScript typecheck:
   ```bash
   npm run typecheck
   ```
2. Run standard unit test suite:
   ```bash
   npm test
   ```
3. Run the empirical stress test suite:
   ```bash
   node --experimental-strip-types .agents/teamwork_preview_challenger_m2_1/stress_test.ts
   ```
   Expected result: `=== STRESS TEST SUMMARY: 21 / 21 PASSED ===` and exit code 0.
