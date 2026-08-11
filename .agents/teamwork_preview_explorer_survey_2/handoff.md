# Survey & Strategy Report: Requirement R2 (Matching Algorithm & Scoring Calibration)

**Author:** Explorer 2 (Survey: Matching Algorithm & Calibration)  
**Date:** 2026-08-10  
**Target Requirement:** Requirement R2 (Matching Algorithm & Scoring Calibration)  
**Working Directory:** `/Users/damian/GitHub/twinframe/.agents/teamwork_preview_explorer_survey_2`  
**Repository:** `/Users/damian/GitHub/twinframe`  

---

## 1. Observation

Direct observations from examining the codebase at `/Users/damian/GitHub/twinframe`:

### 1.1 Test Suite & Execution Environment
- **Test Command**: `npm test` executed in terminal runs:
  `node --experimental-strip-types --test 'src/lib/face/**/*.test.ts' 'scripts/**/*.test.mjs'`
- **Test Status**: All 57 unit tests across 13 test suites passed cleanly with 0 failures in ~180ms (`package.json` line 16).
- **Typecheck Command**: `npm run typecheck` (`tsc --noEmit`) passes with 0 errors.

### 1.2 Pipeline & Model Architecture
- **Detector & Descriptor Extractor**: `src/lib/face/faceapi-engine.ts` loads `@vladmandic/face-api` models:
  - `ssdMobilenetv1` (face detection)
  - `faceLandmark68Net` (68 facial landmarks)
  - `faceRecognitionNet` (128-dimensional FaceNet embeddings)
  - `ageGenderNet` (age & gender prediction)
- **TTA (Test-Time Augmentation)**: `detectAndDescribeWithTTA()` in `faceapi-engine.ts:251-295` computes an averaged 128-d descriptor from the original photo and a horizontally flipped view in L2-normalized vector space ($\mathbb{S}^{127}$).
- **Embeddings Gallery (`src/lib/face/embeddings.ts`)**: Loads 128-d precomputed celebrity descriptors from `/celebs/embeddings.meta.json`, `/celebs/gallery.buckets.json`, and quantized binary `embeddings.q8.bin` (v3 format), with fallback to `embeddings.json` (v2 format).

### 1.3 Current Distance & Matching Mathematics
- **Vector Space**: L2-normalized 128-dimensional space ($\|v\|_2 = 1.0$).
- **Euclidean Distance** (`embeddings.ts:228-237`):
  ```ts
  export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
    const n = Math.min(a.length, b.length);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      sum += d * d;
    }
    return Math.sqrt(sum);
  }
  ```
- **Cosine Distance** (`embeddings.ts:240-255`):
  ```ts
  export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number { ... }
  ```
- **Ensemble Distance** (`embeddings.ts:258-264`):
  ```ts
  export function ensembleDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
    const euc = euclideanDistance(a, b);
    const cos = cosineDistance(a, b);
    const cosAsEuc = cos * 0.85;
    return 0.72 * euc + 0.28 * cosAsEuc;
  }
  ```
- **Current Euclidean-to-Percentage Mapping (`embeddings.ts:267-277`)**:
  ```ts
  export function distanceToMatchPercent(distance: number): number {
    const d = Math.max(0, Math.min(1.35, distance));
    const t = (0.50 - d) / 0.13;
    const sig = 1 / (1 + Math.exp(-t));
    const pct = 16 + sig * 80;
    return Math.round(Math.max(16, Math.min(96, pct)) * 10) / 10;
  }
  ```
  - **Identical Photo Defect ($d = 0.0$)**: $t = (0.50 - 0)/0.13 = 3.846 \Rightarrow \text{sig} \approx 0.979 \Rightarrow \text{pct} = 16 + 0.979 \times 80 = 94.3\%$. The function caps max percentage at `96%`. **An exact self-match ($d = 0.0$) evaluates to 94.3%–96%, never reaching 100%.**
  - **Look-alike Distribution Shift**: Typical top-1 celebrity look-alikes in a 1,000-celeb gallery fall in the distance range $d \in [0.42, 0.55]$. Under the current formula, $d = 0.50$ maps to $56.0\%$, which feels artificially low for a top match.

### 1.4 Auxiliary Metrics & Priors
- **Model Outputs Extracted** (`faceapi-engine.ts:226-231`):
  - `age`: estimated floating-point age (e.g. 28.4)
  - `gender`: `"male"` | `"female"`
  - `genderProbability`: confidence float in $[0.5, 1.0]$
  - `confidence`: detection confidence score (e.g. 0.98)
  - `sharpness` / `illumination` / `faceCoverage`
- **Current Integration (`match.ts:31-39` & `embeddings.ts:296-316`)**:
  ```ts
  const g = genderAffinity(user.gender, user.genderProbability, celeb);
  const a = ageAffinity(user.age, celeb.age);
  const adjusted = dist / (0.72 + 0.18 * g + 0.10 * a);
  ```
  - `ageAffinity`: Uses discrete step intervals (`diff <= 6 => 1`, `diff <= 12 => 0.97`, `diff <= 20 => 0.91`, `diff <= 30 => 0.84`, else `0.76`).
  - `genderAffinity`: Step floor `0.78 + (1 - userProb) * 0.16` when genders differ.
  - `buildDescriptorTraits` (`match.ts:78-115`): Constructs 3 traits for UI display (`Facial structure`, `Age range`, `Presentation`).

---

## 2. Logic Chain

1. **Requirement Goal**: Requirement R2 mandates:
   - Non-linear distance-to-percentage mapping where perfect match is 100% and typical look-alike matches map to a realistic, user-friendly percentage range.
   - Incorporation of auxiliary metrics (age, gender, quality, confidence) to refine ranking and match confidence scoring.
   - All unit tests (`npm test`) and typechecks (`npm run typecheck`) passing.

2. **Identified Formula Limitations**:
   - The current sigmoid formula `16 + (1 / (1 + exp(-(0.50 - d)/0.13))) * 80` capped at `96` fails the "100% perfect match" requirement because $d=0$ evaluates to $94.3\%$.
   - The slope around $d=0.50$ drops too rapidly from $76.8\%$ ($d=0.35$) to $35.2\%$ ($d=0.65$), creating harsh score drops between top contenders.

3. **Mathematical Solution (Hill Equation / Generalized Logistic Curve)**:
   - A Hill Equation curve of the form:
     $$P(d) = P_{\text{min}} + \frac{100 - P_{\text{min}}}{1 + \left(\frac{d}{d_0}\right)^\gamma}$$
     with $P_{\text{min}} = 15.0\%$, $d_0 = 0.58$, and exponent $\gamma = 3.2$ provides ideal mathematical properties:
     - **Exact Zero Anchor**: $P(0.0) = 15 + \frac{85}{1 + 0} = 100.0\%$.
     - **Smooth Monotonic Decay**: Smooth $C^\infty$ function with no arbitrary caps or piecewise discontinuities.
     - **Calibrated Distribution**:
       - $d = 0.00 \Rightarrow 100.0\%$ (Self-match / identical vector)
       - $d = 0.20 \Rightarrow 97.2\%$ (Same person, different photo/angle)
       - $d = 0.35 \Rightarrow 86.0\%$ (Exceptional look-alike)
       - $d = 0.45 \Rightarrow 73.9\%$ (Strong doppelgänger)
       - $d = 0.55 \Rightarrow 61.1\%$ (Good resemblance)
       - $d = 0.65 \Rightarrow 49.8\%$ (Moderate resemblance)
       - $d = 0.80 \Rightarrow 36.3\%$ (Distant resemblance)
       - $d = 1.10 \Rightarrow 21.6\%$ (Unrelated face noise floor)

4. **Auxiliary Metrics Enhancement**:
   - **Continuous Age Gaussian Affinity**: Replace step functions with $A_{\text{age}} = \exp\left( -\left(\frac{|u_{\text{age}} - c_{\text{age}}|}{28}\right)^2 \right)$, eliminating threshold edge effects.
   - **Probabilistic Gender Prior**: Weight gender affinity smoothly by $u_{\text{genderProbability}}$.
   - **Match Confidence Score ($C_{\text{match}}$)**: Compute a holistic match confidence rating:
     $$C_{\text{match}} = c_{\text{det}} \times \text{clamp}\left(\frac{\text{sharpness}}{65}, 0.5, 1.0\right) \times \text{clamp}\left(\frac{\text{coverage}}{0.05}, 0.6, 1.0\right)$$
     This distinguishes a high-quality crisp match from a low-lighting / blurry photo match.
   - **Expanded Similarity Signals**: Extend `buildDescriptorTraits` to output 4 granular traits (`Facial structure`, `Age affinity`, `Gender presentation`, `Lighting & quality score`).

5. **Unit Test Strategy Alignment**:
   - Expand `src/lib/face/match.test.ts` and `src/lib/face/math.test.ts` to test:
     - $d = 0.0 \Rightarrow 100.0\%$ assertion.
     - Monotonicity across $d \in [0, 1.4]$.
     - Smooth age affinity transitions.
     - 100% self-match rank #1 retention across gallery profiles.

---

## 3. Caveats

- **No Source Modification in Survey Stage**: This report presents findings and recommended implementations; source code modifications will be executed by the assigned implementer role.
- **Model Invariance**: `@vladmandic/face-api` runs client-side in browser WebGL/WASM environment. Unit tests in Node run numerical vector calculations using synthetic and precomputed gallery embeddings.

---

## 4. Conclusion & Recommendations

### 4.1 Recommended Mathematical Formula (`src/lib/face/embeddings.ts`)
Replace `distanceToMatchPercent` with the calibrated Hill Equation curve:

```ts
/**
 * Convert FaceNet L2 distance to an honest, calibrated match percentage.
 * Guarantees d = 0 -> 100.0%, with calibrated doppelgänger scaling:
 * d = 0.00 -> 100.0%
 * d = 0.20 -> 97.2%
 * d = 0.35 -> 86.0%
 * d = 0.45 -> 73.9%
 * d = 0.55 -> 61.1%
 * d = 0.65 -> 49.8%
 * d = 0.85 -> 32.5%
 */
export function distanceToMatchPercent(distance: number): number {
  const d = Math.max(0, distance);
  const d0 = 0.58;
  const gamma = 3.2;
  const pMin = 15.0;
  const pMax = 100.0;
  
  const pct = pMin + (pMax - pMin) / (1 + Math.pow(d / d0, gamma));
  return Math.round(pct * 10) / 10;
}
```

### 4.2 Recommended Auxiliary Metrics Integration (`src/lib/face/embeddings.ts` & `match.ts`)
1. **Continuous Age Affinity**:
```ts
export function ageAffinity(userAge: number, celebAge: number): number {
  const diff = Math.abs(userAge - celebAge);
  return Math.exp(-Math.pow(diff / 28, 2));
}
```
2. **Match Confidence Rating**:
```ts
export function computeMatchConfidence(
  detConfidence: number,
  sharpness: number,
  faceCoverage: number,
  genderProb: number
): number {
  const sNorm = Math.max(0.5, Math.min(1.0, sharpness / 65));
  const cNorm = Math.max(0.6, Math.min(1.0, faceCoverage / 0.05));
  const conf = detConfidence * sNorm * cNorm * Math.max(0.7, genderProb);
  return Math.round(Math.min(100, Math.max(10, conf * 100)));
}
```

### 4.3 Recommended Unit Testing Strategy (`src/lib/face/match.test.ts`)
Add specific verification tests:
1. `distanceToMatchPercent(0) === 100.0`
2. `distanceToMatchPercent(0.35) >= 84 && distanceToMatchPercent(0.35) <= 90`
3. `distanceToMatchPercent(0.50) >= 65 && distanceToMatchPercent(0.50) <= 72`
4. Strict monotonicity test over 100 evaluation steps in $d \in [0, 1.5]$.
5. Continuous `ageAffinity` smoothness test.

---

## 5. Verification Method

To verify these algorithmic and mathematical recommendations once implemented:

1. **Unit Test Execution**:
   ```bash
   npm test
   ```
   *Expected result*: All existing 57 tests + new R2 calibration tests pass cleanly in $< 250\text{ ms}$.

2. **TypeScript Integrity**:
   ```bash
   npm run typecheck
   ```
   *Expected result*: `tsc --noEmit` exits with code 0 (no type errors).

3. **Boundary Inspection Points**:
   - `distanceToMatchPercent(0)` returns `100`.
   - Top celebrity matches present calibrated scores in 70%–92% range for strong look-alikes.
