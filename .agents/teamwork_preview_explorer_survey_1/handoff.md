# Survey Handoff Report: Requirement R1 (Visual Design & Micro-Animations)

## 1. Observation

### Codebase & Styling Architecture Overview
- **Project Structure**: Built with React 19, TypeScript 5.7, Vite 8, TanStack Router/Start, and Tailwind CSS v4.
- **Styling Configuration (`src/styles.css`)**:
  - Tailwind CSS v4 setup via `@import "tailwindcss";` (line 1) and `@import "tw-animate-css";` (line 2).
  - Theme custom properties in `@theme` block (lines 4–40): `--color-bg`, `--color-bg-elevated`, `--color-bg-subtle`, `--color-fg`, `--color-fg-muted`, `--color-fg-subtle`, `--color-border`, `--color-match` (`#7dd3a0`), `--color-warn`, `--color-danger`.
  - Keyframe animations currently present (lines 112–140):
    ```css
    @keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse-soft { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    ```
- **Baseline Verification**:
  - Command: `npm run typecheck && npm test`
  - Output: `ℹ tests 57 | ℹ suites 13 | ℹ pass 57 | ℹ fail 0 | ℹ duration_ms 179.8ms`. TypeScript compilation clean with 0 errors.

---

### Component Survey & Identified Gaps for R1

#### Observation 1.1: Face Detection & Scanning HUD (`src/components/analyzing-state.tsx`)
- **Current Lines 57–72**: Uses an abstract orbital CSS spinner:
  ```tsx
  <div className="relative h-[84px] w-[84px]">
    <div className="absolute inset-0 rounded-full border border-border" />
    <div className="absolute inset-[10px] rounded-full border border-dashed border-border-strong opacity-60" style={{ animation: "spin 4s linear infinite" }} />
    <div className="absolute inset-3 rounded-full border border-border-strong animate-pulse-soft" />
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="h-2 w-2 rounded-full bg-fg shadow-[0_0_12px_color-mix(in_oklab,var(--color-fg)_50%,transparent)]" />
    </div>
    <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2" style={{ animation: "spin 1.6s linear infinite" }}>
      <div className="h-2 w-2 -translate-y-[36px] rounded-full bg-match shadow-[0_0_8px_var(--color-match)]" />
    </div>
  </div>
  ```
- **Identified Gaps**:
  - The face photo being analyzed (`previewUrl`) is only shown as a small `h-12 w-12` header thumbnail (lines 30–41).
  - The main scanning viewport shows an abstract circle spinner instead of rendering the user's face photo with a high-fidelity scanning HUD overlay.
  - Missing HUD features: No animated tech corner reticles/brackets, no vertical/horizontal laser scan sweep line, no facial landmark node grid (pulsing points over eyes, nose, lips), and no real-time cybernetic telemetry text stream ("ALIGNING LANDMARKS", "EXTRACTING 128-D EMBEDDINGS", "COMPARING 1000 STARS").

#### Observation 1.2: Celebrity Match Reveal (`src/components/results/match-results.tsx`)
- **Current Lines 45 & 54**: Results wrap in a static CSS class:
  ```tsx
  <section className="animate-fade-up space-y-5">
  ...
  <article className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-elevated">
  ```
- **Current Lines 68–75**: Match percentage renders instantly as plain text:
  ```tsx
  <p className="text-[2rem] sm:text-[2.25rem] font-medium tabular-nums leading-none text-match tracking-tight">
    {top.matchPercent.toFixed(0)}
    <span className="text-lg text-match/80">%</span>
  </p>
  ```
- **Identified Gaps**:
  - **No Active Match Reveal Animation**: Does not satisfy Requirement R1 Acceptance Criteria: *"Celebrity matches reveal with an active transition (e.g., flip, scale, or fade-in card effect)."*
  - **No Card Flip / Scale Unveil**: Top match appears statically on screen as soon as state changes to `"results"`.
  - **No Match Percentage Counter**: Percentage renders immediately at full value without a counting animation (0% -> target %).
  - **No Staggered Contenders Reveal**: Contenders list (`rest.map`) mounts all at once without cascading fade/slide micro-animations.

#### Observation 1.3: Side-by-Side Face vs Celebrity Comparison View (`src/components/results/match-results.tsx`)
- **Current Lines 83–122**:
  ```tsx
  <div className="flex items-center justify-center gap-4 px-5 py-6 sm:gap-6 sm:px-6">
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28 sm:h-32 sm:w-32 overflow-hidden rounded-full border border-border bg-bg-subtle">
        {youUrl ? (
          <img src={youUrl} alt="You" className="h-full w-full object-cover object-top" />
        ) : ( ... )}
      </div>
      <span className="text-xs text-fg-muted">You</span>
    </div>
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-xs text-fg-subtle" aria-hidden>≈</div>
    <div className="flex flex-col items-center gap-2">
      <CelebrityPortrait initials={top.initials} accentHue={top.accentHue} photoUrl={top.photoUrl} ... size="xl" alt={top.name} />
      <span className="max-w-[7rem] truncate text-xs text-fg-muted text-center">{top.name.split(" ")[0]}</span>
    </div>
  </div>
  ```
- **Identified Gaps**:
  - Uses basic circular avatars (`rounded-full`) which cut off facial structure (jawline, ears, hair).
  - No interactive split-slider or morph comparison view where users can drag to compare user face vs celebrity face directly.
  - No visual feature alignment callouts (e.g., matching lines or landmark callouts connecting eye spacing, nose bridge, jawline).
  - No view mode switcher ("Side-by-Side", "Interactive Split Slider", "Feature Alignment").

---

## 2. Logic Chain

1. **Premise 1**: Requirement R1 dictates an immersive visual design with: (a) high-fidelity scanning HUD overlay during face analysis, (b) dramatic reveal animation for top match, and (c) side-by-side visual comparison between cropped user face and celebrity portrait.
2. **Premise 2**: Based on Observation 1.1, `AnalyzingState.tsx` currently lacks face photo scanning integration and HUD reticles/laser sweeps/telemetry. Replacing the abstract spinner with a dedicated HUD overlay component (`FaceScanningHud`) that embeds the actual user face photo with animated tech reticles, laser sweep, landmark points, and telemetry lines will directly satisfy requirement (a).
3. **Premise 3**: Based on Observation 1.2, `MatchResults.tsx` mounts immediately without reveal drama or percentage count-up. Introducing a `MatchRevealCard` component with card-flip / scale-glow transition, animated percentage counter (`NumberCounter`), and staggered contender entry will satisfy requirement (b) and the acceptance criteria.
4. **Premise 4**: Based on Observation 1.3, `MatchResults.tsx` presents a simple static pair of circular avatars. Creating an enhanced `ComparisonView` component with rounded-rectangle frames, view mode tabs ("Side-by-Side", "Interactive Split Slider", "Feature Alignment"), and an interactive draggable comparison slider will satisfy requirement (c).
5. **Conclusion**: Implementation of R1 can be cleanly achieved via 4 modular components and extended CSS keyframes in `src/styles.css` without adding new third-party dependencies.

---

## 3. Caveats

- **Reduced Motion Support**: All keyframe animations and transitions must respect `@media (prefers-reduced-motion: reduce)` to remain accessible.
- **Image Aspect Ratios**: Face previews extracted from `detectAndDescribe` (`det.faceCanvas`) are 320x320 square canvases. Celebrity portraits from external URLs or local fallbacks vary in aspect ratio and availability, so object-cover and error fallback state must be handled smoothly.
- **No Source Code Edits Made**: This survey report is strictly read-only. No modifications have been made to `src/` files during this investigation.

---

## 4. Conclusion

### Final Assessment & Recommended Strategy

Requirement R1 (Visual Design & Micro-Animations) should be implemented using a modular 4-part architectural blueprint:

#### Component & File Boundaries for R1 Implementation:

1. **`src/styles.css` (CSS & Keyframe Enhancements)**:
   - Add custom animation keyframes:
     - `@keyframes scan-laser-sweep`: 0% to 100% vertical translation of cyan/emerald glowing line across face frame.
     - `@keyframes reticle-pulse`: pulsing opacity and subtle scale for corner tech brackets.
     - `@keyframes card-flip-in`: 3D perspective flip (0 deg to 360 deg or -90 deg to 0 deg).
     - `@keyframes glow-aura`: pulsing background glow for top match card.
     - `@keyframes telemetry-fade`: text tick fade-in.
   - Add helper classes: `.perspective-1000`, `.transform-style-3d`, `.backface-hidden`.

2. **`src/components/scanning/face-scanning-hud.tsx` (NEW)**:
   - **Main Scan Viewport**: Renders user's cropped face photo inside a high-tech HUD box (`aspect-square max-w-[280px]`).
   - **HUD Layer Overlays**:
     - 4 Corner tech reticles (L-shaped bracket corners with glowing accents).
     - Vertical laser scan line sweeping smoothly up and down across the face photo.
     - Simulated/real landmark node points (glowing dots positioned at facial key points).
     - Real-time telemetry log at bottom ("ALIGNING LANDMARKS 68/68", "COMPUTING 128-D VECTOR", "RANKING 1000 CELEBRITIES").

3. **`src/components/results/match-reveal-card.tsx` (NEW)**:
   - **Reveal Stage Management**: Manages state transition from `unrevealed` -> `revealing` -> `revealed`.
   - **Card Flip / Unveil Effect**: Uses 3D card flip or scale-up reveal with glowing aura when matches load.
   - **Animated Percentage Counter**: Uses `src/components/ui/number-counter.tsx` to count from 0% up to calibrated `matchPercent` over 1.2s.
   - **Confetti / Spotlight Pulse**: Displays subtle ambient sparkles or aura burst for top matches.

4. **`src/components/results/comparison-view.tsx` (NEW)**:
   - **Card Framing**: Replaces basic circular avatars with sleek rounded-rectangle cards (`aspect-square` or `aspect-[4/5]`) with subtle border glow.
   - **Interactive Split Slider Mode**: Allows users to drag a central divider left and right to clip/morph between User Face and Celebrity Portrait in real time.
   - **Feature Alignment Callouts**: Highlights matching facial signals (e.g. Eye Spacing, Jawline, Nose Bridge) with connecting badges or lines.
   - **View Mode Switcher**: Tabs for "Side-by-Side", "Interactive Split Slider", and "Landmark Alignment".

5. **`src/components/ui/number-counter.tsx` (NEW)**:
   - Compact helper component that animates a numeric state (0 to value) with easing.

---

## 5. Verification Method

To independently verify the R1 implementation once built:

1. **Type Safety & Build**:
   ```bash
   npm run typecheck
   ```
   *Expected result*: Exit code 0, 0 TypeScript errors.

2. **Unit Test Suite**:
   ```bash
   npm test
   ```
   *Expected result*: Exit code 0, all 57+ unit tests pass cleanly.

3. **Visual Smoke Test & Verification**:
   ```bash
   npm run dev
   ```
   - Open browser or execute `node scripts/browser-smoke.mjs http://127.0.0.1:8080/`.
   - Verify upload/camera capture triggers the high-fidelity `FaceScanningHud`.
   - Verify transition to results triggers the active `MatchRevealCard` flip/scale animation and count-up percentage.
   - Verify `ComparisonView` permits side-by-side and interactive split slider view modes.
