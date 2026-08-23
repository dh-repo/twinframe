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

Three different numbers exist and they mean different things:

| Protocol | Probes | Result | What it proves |
|---|---|---|---|
| `scripts/evaluate-accuracy.mjs` tier probes | 313 | 95.6% Top-1 (Tier 1) | Pipeline sanity. Probe portraits overlap enrollment imagery — an upper bound, never user-facing accuracy |
| `scripts/evaluate-held-out-v2.ts` **v2.1 leak-excluded** | 274 clean | **46.0% Rank-1**, 61.3% Rank-5, MRR 0.535 | Probes from photos that contribute to **no** gallery artifact, encoded through the same SCRFD → align → EdgeFace-512d path the browser runs |
| Historical "held-out" reports (≤ 2026-08-18) | 735 | ~~86.5%~~ | **Invalid**: probes were 128-d FaceNet vectors scored against a 512-d gallery (cross-space), and 531/735 probe files also served as gallery extra-template sources |

Treat **46.0% held-out Rank-1** as the honest headline. Protocol details: 308 clean photos
encoded (307 detected), 33 ids not enrolled in the shipped gallery excluded and reported,
12 gate refusals counted as misses, age/gender priors taken from the recorded detector
output exactly as the live pipeline would see them. Methodology lives in code and tests
(`scripts/evaluate-held-out-v2.ts`, `scripts/held-out-protocol.test.mjs`) — not in blog
prose. The distance→percent mapping shown in the UI is not yet calibrated against
held-out reliability data.

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
