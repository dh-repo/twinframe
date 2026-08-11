# Project: Twinframe Performance & Telemetry Upgrade

## Architecture
- **Pipeline Layer**: `src/lib/face/faceapi-engine.ts`, `src/lib/face/pipeline.ts`
  - Manages TF.js / `@vladmandic/face-api` model loading, canvas downscaling, SSD face detection, CLAHE local contrast boost, and 128-d FaceNet descriptor extraction.
- **Telemetry & Diagnostics**:
  - Measures stage latencies (`modelLoadMs`, `downscaleMs`, `ssdPassMs`, `claheMs`, `embeddingMs`, `totalMs`), canvas downscale dimensions, face count, and detector confidence.
  - Emits formatted telemetry to browser console (`[Twinframe Telemetry] ...`) and updates HUD state.
- **UI Components**:
  - `src/components/app-home.tsx`: High-level workflow, camera/upload handling, 20-second safety timeout, HUD telemetry rendering.
  - `src/components/capture/crop-review.tsx`: Face cropping and preview rendering.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Stage Latency Telemetry | Measure execution times for model load, downscale, SSD pass, CLAHE, embedding extraction, and total pipeline time | M1 | R1 |
| 2 | Console & HUD Telemetry Logging | Format and emit detailed debug telemetry logs to console and HUD overlay | M1 | R1 |
| 3 | 2-Tier Canvas Downscaling | Downscale detection canvas to 800px maxSide (Tier 1) and primary face crop to 320x320 (Tier 2) | M2 | R2 |
| 4 | Decoupled Multi-Face Candidate Pipeline | Run `detectAllFaces` with landmarks only; execute descriptor extraction ONCE ($O(1)$) on primary face crop | M2 | R2 |
| 5 | Downscaled CLAHE Preprocessing | Downscale input to 640px before CPU histogram equalization pass for < 25ms execution | M2 | R2 |
| 6 | Sub-500ms High-Res Multi-Person Performance | Ensure complete face analysis finishes in < 500ms on high-res outdoor photos without 20s timeouts | M2 | R2 |
| 7 | Performance & Telemetry Integration Tests | Verify stage timing telemetry, < 500ms execution, and multi-person face handling under unit & E2E tests | M3 | R1, R2 |
| 8 | Quality Verification & Forensic Audit | Validate `npm test`, `npm run typecheck`, `npm run build`, and clean forensic audit | M3 | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Diagnostics & Telemetry | Instrument stage latencies, console logging, and HUD telemetry in `faceapi-engine.ts`, `pipeline.ts`, and UI components | None | DONE |
| 2 | M2: High-Res Performance & Optimization | Implement 2-tier downscaling, $O(1)$ candidate descriptor extraction, 640px CLAHE, < 500ms execution | M1 | DONE |
| 3 | M3: Integration, E2E Test Suite & Hardening | Build performance/telemetry tests, execute full test suite, typecheck, production build, forensic audit | M2 | DONE |

## Interface Contracts
### `FaceStageLatencies` & `FaceTelemetry` (`src/lib/face/faceapi-engine.ts`)
```typescript
export interface FaceStageLatencies {
  modelLoadMs: number;
  downscaleMs: number;
  ssdPassMs: number;
  claheMs: number;
  embeddingMs: number;
  totalMs: number;
}

export interface FaceTelemetry {
  originalWidth: number;
  originalHeight: number;
  downscaledWidth: number;
  downscaledHeight: number;
  faceCount: number;
  primaryConfidence: number;
  latencies: FaceStageLatencies;
}
```

## Code Layout
- `src/lib/face/faceapi-engine.ts`: Core detection engine, TF.js operations, canvas downscaling, CLAHE contrast boost, descriptor extraction.
- `src/lib/face/pipeline.ts`: High-level analysis pipeline (`analyzeFaceSource`).
- `src/components/app-home.tsx`: App workflow, safety timeout management, HUD telemetry rendering.
- `src/lib/face/**/*.test.ts` & `scripts/**/*.test.mjs`: Unit test and benchmark harness.
