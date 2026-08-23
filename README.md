# Twinframe

**Celebrity look-alike / doppelgänger matcher** — upload a selfie or use your camera, get
on-device matches against a **1,000-celebrity gallery** (plus extra templates merged at runtime).

## Features

- **Upload** or **webcam / phone camera** capture
- **On-device** face detection + 256-d EdgeFace-M embeddings via ONNX Runtime Web — no photo
  ever leaves your browser
- Auto face crop for small faces / gym selfies, CLAHE contrast boost for hard lighting
- Honest confidence scoring: distance → percent with margin-aware open-set gating; weak matches
  are labeled "nearest neighbor", not sold as look-alikes
- Mobile-first UI

## Accuracy, honestly

Two different numbers exist and they mean different things:

| Protocol | Probes | Rank-1 | What it proves |
|---|---|---|---|
| `scripts/evaluate-accuracy.mjs` tier probes | 273 | ~97% | Pipeline sanity. Probe portraits overlap enrollment imagery, so this is an upper bound, not user-facing accuracy |
| `scripts/evaluate-held-out-v2.ts` held-out photos | 735 | **86.5%** | Photos disjoint from enrollment centroids, scored by the exact matcher the browser runs |

Treat **86.5% held-out Rank-1** as the honest headline number. Methodology lives in code and
tests (`scripts/evaluate-held-out-v2.ts`, `scripts/evaluate-accuracy.test.mjs`) — not in blog
prose. The distance→percent mapping shown in the UI is not yet calibrated against held-out
reliability data.

## Stack

- React 19 · TypeScript · Vite · TanStack Start
- Tailwind CSS v4
- ONNX Runtime Web + SCRFD detection + EdgeFace-M recognition (`@vladmandic/face-api` remains as
  a legacy engine used by enrollment/re-encode tooling)
- Gallery: `public/celebs/embeddings.v4.q8.bin` ("AFv4" int8) + `gallery.buckets.json`

## Quick start

```bash
npm install
npm run dev
```

App serves on `http://0.0.0.0:8080`.

```bash
npm test              # unit + integration
npm run typecheck
npm run build         # also restores ORT wasm assets
```

Eval harnesses:

```bash
node scripts/evaluate-accuracy.mjs --tier 1 --limit 8   # quick sanity slice
node scripts/evaluate-held-out-v2.ts                    # honest held-out rank-1
```

## How matching works

1. Detect face + landmarks (SCRFD)
2. Align to the 112×112 ArcFace canonical frame (5-point Umeyama similarity transform)
3. Extract a 256-d EdgeFace-M descriptor, L2-normalized
4. Cosine distance against every gallery bucket; soft age/gender priors never override geometry
5. Margin-aware percent mapping + presentable-rank policy (#1 any gender; #2+ match the probe's
   confident gender)

Models live in `public/models/`. Portrait thumbnails + embeddings live in `public/celebs/`.

## Privacy

Matching runs **in the browser**. Photos are not uploaded to Twinframe servers for recognition.
Server functions exist only for auth/app shell.

## License

Celebrity photos are sourced from Wikipedia thumbnails for demo/educational use. Model weights
follow their upstream licenses. Code is provided as-is for this project.
