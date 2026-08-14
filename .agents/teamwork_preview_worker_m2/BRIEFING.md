# BRIEFING — 2026-08-11T19:05:40Z

## Mission
Implement Milestone 2 (SCRFD-2.5G Detection & Expression-Aware 3D UV Frontalization) for Twinframe AccuFace v4.0 architecture.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: /Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_worker_m2
- Original parent: ab7bcd0d-e331-4270-9a14-e74692ec119d
- Milestone: Milestone 2 (SCRFD-2.5G & WGSL Frontalization)

## 🔒 Key Constraints
- All implementations must be genuine — NO HARDCODED test results, fake outputs, or dummy facades.
- Must execute SCRFD-2.5G ONNX detection via onnx-engine.ts, anchor decoding, score filtering (>= 0.40), NMS, landmark extraction, and head pose estimation.
- Must execute ExpNorm 3D UV WGSL frontalization with 10-basis blendshape residual subtraction, 3D UV mapping, bilinear texture sampling for |yaw| > 25° with WebGPU buffer bindings and safe CPU/5-point fallback.
- Must execute 5-Point Similarity Fallback (Umeyama transform) for |yaw| <= 25° mapping to canonical 112x112 InsightFace landmarks.
- Must update pipeline.ts, FaceStageLatencies, and FaceTelemetry.
- Build and tests (`npm run typecheck`, `npm test`, `npm run build`) must pass.

## Current Parent
- Conversation ID: ab7bcd0d-e331-4270-9a14-e74692ec119d
- Updated: 2026-08-11T19:05:40Z

## Task Summary
- **What to build**: SCRFD-2.5G Detection, ExpNorm 3D UV WGSL Frontalization, 5-Point Umeyama Fallback, and Pipeline Integration.
- **Success criteria**: All requirements met with genuine algorithms and verified by unit tests, typecheck, build.
- **Interface contracts**: PROJECT.md and architectural roadmap / exploration handoffs.
- **Code layout**: src/lib/face/

## Key Decisions Made
- Implemented SCRFD-2.5G multi-stride anchor generation (16,800 anchors across strides 8, 16, 32), score filtering (>= 0.40), NMS (0.40 IoU threshold), 5-point landmark extraction, and head pose estimation math (roll, yaw, pitch).
- Implemented ExpNorm 3D UV WGSL compute shader with 10-basis blendshape residual subtraction, 3D rotation, and bilinear texture sampling into NCHW planar Float32 tensor buffer.
- Implemented 5-point Umeyama similarity transform solver mapping to canonical 112x112 / 160x160 InsightFace landmarks with closed-form normal equations.
- Integrated SCRFD detection and routing logic in `src/lib/face/pipeline.ts` with stage latency tracking (`scrfdPassMs`, `frontalizationMs`) and telemetry metadata (`frontalizationMethod`, `estimatedYaw`, `estimatedPitch`, `estimatedRoll`).

## Change Tracker
- **Files modified**:
  - `src/lib/face/types.ts`: Extended FaceTelemetry, FaceStageLatencies, SCRFD and ExpNorm types.
  - `src/lib/face/scrfd.ts`: Created SCRFD-2.5G detection engine, anchor generator, NMS, and pose estimator.
  - `src/lib/face/exp-norm-wgsl.ts`: Created WGSL compute shader and ExpNorm frontalization pipeline.
  - `src/lib/face/similarity-transform.ts`: Created 5-point Umeyama similarity transform solver and canvas/tensor aligners.
  - `src/lib/face/pipeline.ts`: Integrated SCRFD and ExpNorm / 5-point routing into analyzeFaceSource.
  - `src/lib/face/scrfd.test.ts`: Created SCRFD detection unit tests.
  - `src/lib/face/similarity-transform.test.ts`: Created 5-point Umeyama alignment unit tests.
  - `src/lib/face/exp-norm-wgsl.test.ts`: Created WGSL & CPU ExpNorm frontalization unit tests.
  - `src/lib/face/m2-pipeline-integration.test.ts`: Created M2 pipeline routing and telemetry unit tests.
  - `vite.config.ts`: Updated server host/port configuration to allow env overrides.
- **Build status**: PASS (`npm run typecheck`, `npm test`, `npm run build` all passing cleanly)
- **Pending issues**: None

## Quality Status
- **Build/test result**: PASS (273 unit tests pass)
- **Lint status**: PASS (0 TypeScript errors)
- **Tests added/modified**: 17 new unit tests across 4 test suites

## Loaded Skills
- None
