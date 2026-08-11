# Progress Log

Last visited: 2026-08-11T00:01:00Z

- Initialized DISPATCH.md and BRIEFING.md
- Refined Distance-to-Percentage Calibration (`src/lib/face/embeddings.ts`):
  - Replaced `distanceToMatchPercent` with Hill Equation curve $P(d) = 15.0 + 85.0 / (1 + (d / 0.58)^{3.2})$ rounded to 1 decimal place.
  - Verified `distanceToMatchPercent(0) === 100`.
  - Verified sample points ($d=0.35 \Rightarrow 85.9\%$, $d=0.45 \Rightarrow 73.9\%$, $d=0.55 \Rightarrow 61.1\%$, $d=0.65 \Rightarrow 49.8\%$).
- Enhanced Auxiliary Metrics & Match Confidence (`src/lib/face/embeddings.ts`, `match.ts`, `types.ts`):
  - Implemented continuous Gaussian age affinity `ageAffinity(userAge, celebAge) = Math.exp(-Math.pow(Math.abs(userAge - celebAge) / 28, 2))`.
  - Implemented smooth gender affinity penalty based on `user.genderProbability`.
  - Implemented `computeMatchConfidence(detConfidence, sharpness, faceCoverage, genderProb)` returning [10, 100].
  - Expanded `buildDescriptorTraits` to output 4 granular traits (Facial Structure, Age Affinity, Gender Presentation, Lighting & Quality).
- Expanded Unit Test Suite (`src/lib/face/match.test.ts`):
  - Added tests for `distanceToMatchPercent(0) === 100`.
  - Added strict non-increasing monotonicity tests for $d \in [0, 1.5]$.
  - Added continuous age affinity smoothness & gender affinity tests.
  - Added match confidence score tests.
  - Added 4 granular trait output tests.
- Verified `npm run typecheck` and `npm test` pass cleanly (64/64 tests pass).
