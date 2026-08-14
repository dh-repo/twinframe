## 2026-08-11T19:09:53Z
Implement Milestone 3 (EdgeFace-M 256-d Feature Extraction & Metric Recalibration) for Twinframe AccuFace v4.0 architecture.
Working directory: /Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_worker_m3.
Read /Volumes/LaCie/GitHub/twinframe/.agents/ORIGINAL_REQUEST.md, /Volumes/LaCie/GitHub/twinframe/PROJECT.md, and exploration handoffs in /Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_explorer_m3_1/handoff.md, teamwork_preview_explorer_m3_2/handoff.md, and teamwork_preview_explorer_m3_3/handoff.md.

Requirements:
1. EdgeFace-M 256-d Feature Extraction (src/lib/face/edgeface.ts): ONNX model loading via onnx-engine.ts, NCHW [1, 3, 112, 112] Float32 preprocessing, 256-d embedding extraction, L2 normalization (v_hat = v / ||v||_2) with zero-vector fallback.
2. Cosine Distance Recalibration (src/lib/face/match.ts): Pure L2-normalized Cosine distance (d = 1 - a_hat^T * b_hat) replacing legacy ensemble distance, 8-way loop unrolling for 256-d dot products, bounds clamping (d in [0.0, 2.0]).
3. Hill Curve Parameter Recalibration & Pipeline Integration (src/lib/face/embeddings.ts, src/lib/face/pipeline.ts, src/lib/face/types.ts): Update Hill curve probability mapping P(d) = 100 / (1 + (d / 0.38)^4.5) with d0 = 0.38, n = 4.5. Integrate into pipeline.ts. Update FaceStageLatencies (embeddingPassMs) and FaceTelemetry.
4. Testing & Build Verification: Create unit test suites, run npm run typecheck, npm test, npm run build.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Write your handoff report in /Volumes/LaCie/GitHub/twinframe/.agents/teamwork_preview_worker_m3/handoff.md.
