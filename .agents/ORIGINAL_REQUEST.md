# Original User Request

## 2026-08-10T23:55:17Z

Twinframe is an on-device celebrity look-alike/doppelgänger matcher app built with React 19, TypeScript, Vite, TanStack Start, and Tailwind CSS v4. The target is to enhance the application into the best possible celebrity match product.

Working directory: /Users/damian/GitHub/twinframe
Integrity mode: development

## Requirements

### R1. Enhance Visual Design & Micro-Animations
- Implement an immersive, premium user experience with rich CSS/Tailwind animations.
- Design a high-fidelity "scanning" HUD overlay during face detection and analysis.
- Create a dramatic "reveal" animation when displaying the top celebrity doppelgänger match.
- Provide a side-by-side visual comparison showing the cropped user face next to the matched celebrity's portrait.

### R2. Enhance the Matching Algorithm & Scoring Calibration
- Refine the face normalization/similarity pipeline. Ensure face descriptor comparisons (Euclidean distance) map to user-friendly, calibrated similarity percentages (e.g., honest scaling where typical matches fall in a realistic range and perfect match is 100%).
- Factor in auxiliary metrics (like age or gender affinity estimation if provided by the model outputs) to refine ranking and match confidence scoring.

### R3. Expand and Polish the Celebrity Gallery Catalog
- Expand the existing celebrity database (defined in `public/celebs/embeddings.json` and portraits) to include more diverse, internationally recognized actors, artists, athletes, and public figures.
- Ensure the assets (images, metadata, precomputed embeddings) are clean and correctly loaded.

## Acceptance Criteria

### UI & Animations
- Scanning overlay exhibits smooth transitions and animation effects.
- Celebrity matches reveal with an active transition (e.g., flip, scale, or fade-in card effect).
- Top match features a side-by-side comparison element of the cropped face and the target celebrity photo.

### Algorithm & Verification
- Euclidean-to-percentage mapping is calibrated (non-linear scaling so that raw distance is translated to a readable percentage).
- All existing and new unit tests (`npm test` and `npm run typecheck`) pass successfully.
- Visual smoke test via Playwright passes cleanly without console errors.
