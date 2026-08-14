# Original User Request

## Initial Request — 2026-08-14T14:32:26Z

Diagnose and maximize the celebrity face-matching accuracy in Twinframe by resolving embedding distortion bottlenecks, standardizing landmark alignment parity, recalibrating similarity distance metrics, and establishing an objective ground-truth evaluation benchmark.

Working directory: /Volumes/LaCie/GitHub/twinframe
Integrity mode: development

## Requirements

### R1. Ground-Truth Evaluation & Accuracy Benchmark
Build an automated, reproducible accuracy evaluation harness (e.g. Node/Playwright/WASM test runner) with a ground-truth dataset of known celebrity test images across varying poses, lighting, and expressions. The harness must calculate and report Top-1 accuracy, Top-5 accuracy, Mean Reciprocal Rank (MRR), and Cosine distance margin between true positives and nearest distractors.

### R2. Feature Extraction & Alignment Parity Audit
Audit and align the facial pre-processing pipeline so that query images and gallery reference embeddings use identical canonical 5-point landmark similarity transforms (112x112 EdgeFace/ArcFace standard coordinates). Eliminate any uncoordinated transforms, session-bound Anti-GAN projections, or lossy biohashing distortions that degrade query-to-gallery cosine similarity.

### R3. Similarity Metric & Ranking Recalibration
Recalibrate the candidate scoring and ranking algorithms. Ensure raw L2-normalized cosine similarity is the primary determinant of identity matching, and refine secondary priors (age/gender affinities) so they do not override strong visual facial embedding matches. Calibrate the Hill curve probability mapping so percentage scores accurately reflect true confidence.

### R4. Gallery Embeddings Quality Optimization
Audit and enhance the celebrity embedding catalog (`embeddings.v4.q8.bin` / gallery database). Verify embedding normalization, evaluate precision quantization impact (FP32/FP16 vs INT8), and ensure multi-shot or high-quality frontal representations for enrolled celebrities.

## Acceptance Criteria

### Accuracy & Benchmarking
- [ ] Automated evaluation script runs across the test benchmark suite and reports Top-1, Top-5 accuracy, and latency breakdown.
- [ ] Top-1 celebrity match accuracy on the ground-truth test suite improves significantly over baseline (targeting ≥ 85% Top-1, ≥ 95% Top-5 on clear frontal/moderate pose test sets).
- [ ] True celebrity matches exhibit distinct positive cosine similarity margins against negative distractors.

### Pipeline Correctness & Integrity
- [ ] Query embeddings and gallery embeddings share identical dimensional space, normalization, and canonical 5-point reference coordinate alignment.
- [ ] Disabling or bypassing destructive session projections preserves pure feature descriptor fidelity.
- [ ] `npm run typecheck`, unit tests, and production build (`npm run build`) pass with zero errors.

## Follow-up — 2026-08-14T14:33:01Z
User note on hardware: "Dont be afraid to make use of the massive GPU power you have available here our Mac Studio" — prioritize full local compute, WebGPU/Metal acceleration, high-precision FP16/FP32 pipelines, and comprehensive multi-shot embeddings where applicable.

## Follow-up — 2026-08-14T14:58:17Z
User query: "Are we using as much GPU power as possible".
Directives:
1. Ensure WebGPU (Metal backend on macOS) execution provider is prioritized with zero-copy texture/buffer bindings in runtime ONNX engines.
2. Configure WGSL compute passes for max parallel workgroups.
3. Use multi-threaded SIMD / CoreML / Metal acceleration for gallery re-embedding and batch evaluation passes.
4. Report current GPU utilization status across client pipeline and CLI tools.


## Follow-up — 2026-08-14T14:58:17Z

User query: "Are we using as much GPU power as possible". 
Instruction to Teamwork Lead & Workers: Ensure WebGPU (Metal backend on macOS) execution provider is prioritized with zero-copy texture/buffer bindings in runtime ONNX engines, configure WGSL compute passes for max parallel workgroups, and use multi-threaded SIMD / CoreML / Metal acceleration for gallery re-embedding and batch evaluation passes. Report current GPU utilization status across client pipeline and CLI tools.
