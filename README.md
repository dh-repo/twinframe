# Twinframe

**Celebrity look-alike / doppelgänger matcher** — upload a selfie or use your camera, get
on-device matches against a **1,000-celebrity gallery** (plus extra templates merged at runtime).

## Features

- **Upload** or **webcam / phone camera** capture
- **On-device** face detection + 512-d AdaFace IR-101 embeddings via ONNX Runtime Web — no photo
  ever leaves your browser
- Auto face crop for small faces / gym selfies, CLAHE contrast boost for hard lighting
- Honest confidence scoring: named verdict + calibrated P(closest identity in this gallery);
  Hill similarity is secondary and unlabeled as a twin score. Weak matches are "nearest
  neighbor" or "Distant Twin", never sold as look-alikes
- Mobile-first UI

## Accuracy, honestly

Three different numbers exist and they mean different things:

| Protocol | Probes | Result | What it proves |
|---|---|---|---|
| `scripts/evaluate-accuracy.mjs` tier probes | 313 | 95.6% Top-1 (Tier 1) | Pipeline sanity. Probe portraits overlap enrollment imagery — an upper bound, never user-facing accuracy |
| `scripts/evaluate-held-out-v2.ts` **v2.1 leak-excluded, full 512-d geometry** | 302 clean | **97.7% Rank-1**, 98.7% Rank-5, MRR 0.982 | Probes from photos that contribute to **no** gallery artifact (by path and by content hash), encoded through the same SCRFD → align → AdaFace IR-101 512-d path the browser runs. Tracked in `reports/held-out-v2-baseline.json`. CI gates Rank-1 ≥ 75%. |
| Historical "held-out" reports (≤ 2026-08-23) | 735 / 274 | ~~86.5%~~ / ~~46.0%~~ | Both invalid: the first scored 128-d probes against a 512-d gallery with 531/735 leaked probe files; the second parsed the 512-d binary at a 256 stride, i.e. half-vectors |

Treat **97.7% Rank-1** (`reports/held-out-v2-baseline.json`) as the honest headline and regression gate — celebrity self-retrieval on a different photo, not civilian look-alike agreement. Hill percent in the UI is uncalibrated similarity; `probabilityCorrect` is the calibrated P(rank-1 is the true identity in this 1k gallery). Protocol details: probes encoded through the live ONNX enroll path (SCRFD → Umeyama → AdaFace IR-101, same geometry the browser loads); gate refusals counted as misses; age/gender priors come from recorded detector output exactly as the live pipeline would see them. Methodology lives in code and tests (`scripts/evaluate-held-out-v2.ts`, `scripts/held-out-protocol.test.mjs`, `scripts/held-out-headline.test.mjs`) — not in leftover prose.

## Stack

- React 19 · TypeScript · Vite · TanStack Start
- Tailwind CSS v4
- ONNX Runtime Web + SCRFD detection + AdaFace IR-101 recognition (`@vladmandic/face-api` remains as
  a legacy engine used for age/gender fallback and enrollment/re-encode tooling)
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
3. Extract a 512-d AdaFace IR-101 descriptor, L2-normalized
4. Cosine distance against every gallery bucket; soft age/gender priors never override geometry
5. Named verdict + calibrated P(correct); Hill similarity is secondary. Presentable-rank policy
   (#1 any gender; #2+ match the probe's confident gender)

Models live in `public/models/`. Portrait thumbnails + embeddings live in `public/celebs/`.

## Privacy

Matching runs **in the browser**. Photos are not uploaded to Twinframe servers for recognition.
Server functions exist only for auth/app shell.

## License

Celebrity photos are sourced from Wikipedia thumbnails for demo/educational use. Model weights
follow their upstream licenses. Code is provided as-is for this project.
