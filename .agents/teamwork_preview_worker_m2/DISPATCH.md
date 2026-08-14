## 2026-08-11T19:00:33Z
Implement Milestone 2 (SCRFD-2.5G Detection & Expression-Aware 3D UV Frontalization) for Twinframe AccuFace v4.0 architecture.
Working directory: /Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_worker_m2.
Read /Volumes/LaCie/GitHub/twinframe/.agents/ORIGINAL_REQUEST.md, /Volumes/LaCie/GitHub/twinframe/PROJECT.md, and exploration reports in /Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_explorer_m2_1/handoff.md, teamwork_preview_explorer_m2_2/handoff.md, and teamwork_preview_explorer_m2_3/handoff.md.

Requirements:
1. SCRFD-2.5G Face Detection (src/lib/face/scrfd.ts): ONNX model loading via onnx-engine.ts, multi-stride anchor parsing (strides 8, 16, 32), score filtering (>= 0.40), NMS, 5-point landmark extraction, pose estimation (yaw, pitch, roll).
2. ExpNorm 3D UV WGSL Frontalization (src/lib/face/exp-norm-wgsl.ts): WGSL compute shader executing 10-basis blendshape residual subtraction, 3D UV mapping, and bilinear texture sampling for |yaw| > 25°. WebGPU buffer bindings and safe CPU/5-point fallback.
3. 5-Point Similarity Fallback & Pipeline Integration (src/lib/face/pipeline.ts, src/lib/face/types.ts): 5-point Umeyama similarity transform for |yaw| <= 25° mapping to canonical 112x112 InsightFace landmarks. Update pipeline.ts, FaceStageLatencies, and FaceTelemetry.
4. Testing & Verification: Create unit tests, run npm run typecheck, npm test, npm run build.
