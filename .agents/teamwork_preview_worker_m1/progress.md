# Progress Log

Last visited: 2026-08-11T18:45:58Z

- [x] Initialized workspace and briefing.
- [x] Read ORIGINAL_REQUEST.md, PROJECT.md, and Explorer analysis/handoff files.
- [x] Package & Assets: Add `onnxruntime-web` to package.json and create `scripts/copy-ort-assets.mjs` to copy ORT WASM assets to `public/models/ort/`.
- [x] Implement `src/lib/face/onnx-engine.ts` (WebGPU / WASM SIMD, session manager, hardware probe).
- [x] Implement `src/lib/face/face-worker.ts` and `src/lib/face/worker-client.ts` (Zero-copy transfers, correlation map, bitmap cleanup, timeout/error handling).
- [x] Implement `src/lib/face/smoothing.ts` (OneEuroFilter & LandmarkSmoother).
- [x] Extend `src/lib/face/types.ts` and instrument `src/lib/face/pipeline.ts` with telemetry timers.
- [x] Implement unit tests in `onnx-engine.test.ts`, `face-worker.test.ts`, `smoothing.test.ts`.
- [x] Verify `npm run typecheck` (0 errors), `npm test` (233/233 pass), `npm run build` (Vercel Nitro build succeeds).
- [x] Write handoff.md and changes.md.
