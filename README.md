# Twinframe

**Celebrity look-alike / doppelgänger matcher** — upload a selfie or use your camera, get on-device EdgeFace matches against a **1,000-celebrity** gallery.

## Features

- **Upload** or **webcam / phone camera** capture
- **On-device** face detection + 512-d EdgeFace embeddings (no photo upload to a server)
- Auto face crop for small faces / gym selfies
- Honest confidence scoring (distance + top-2 margin → percent and verdict)
- Mobile-first UI
- Gallery of **1,000** pre-embedded celebrities (actors, artists, athletes, public figures)

## Stack

- React 19 · TypeScript · Vite · TanStack Start
- Tailwind CSS v4
- SCRFD detection + EdgeFace-S recognition via `onnxruntime-web`
- `@vladmandic/face-api` for age/gender estimation and the FaceNet fallback path
- Celebrity embeddings in `public/celebs/embeddings.v4.q8.bin`

## Quick start

```bash
npm install
npm run dev
```

App serves on `http://0.0.0.0:8080`.

```bash
npm run typecheck
npm test
npm run build
```

## How matching works

1. Detect face (SCRFD) and 5-point landmarks
2. Align / frontalize the face to a 112px tensor
3. Extract a **512-d** EdgeFace descriptor
4. Compare with cosine distance to precomputed celebrity prototypes (primary + multi-shot centroids)
5. Rank top matches with age/gender affinity, then calibrate a match % and verdict from the
   absolute distance and the #1-vs-#2 margin

Models live in `public/models/` (`ort/`, `scrfd/`, `edgeface/`, plus `face-api/` for age/gender).
Portrait thumbnails + embeddings live in `public/celebs/`.

## Project layout

```
src/
  components/     # UI (capture, results, app shell)
  lib/face/       # pipeline, embeddings, scoring, tests
  lib/celebrities/# catalog metadata
public/
  celebs/         # portraits + embeddings.v4.q8.bin + gallery.buckets.json
  models/         # ONNX runtime, SCRFD, EdgeFace, face-api weights
```

## Privacy

Matching runs **in the browser**. Photos are not uploaded to Twinframe servers for recognition.

## License

Celebrity photos are sourced from Wikipedia thumbnails for demo/educational use. Face-api model weights follow their upstream licenses. Code is provided as-is for this project.
