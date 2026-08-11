# Twinframe

**Celebrity look-alike / doppelgänger matcher** — upload a selfie or use your camera, get on-device FaceNet matches against a **267-celebrity** gallery.

## Features

- **Upload** or **webcam / phone camera** capture
- **On-device** face detection + 128-d FaceNet embeddings (no photo upload to a server)
- Auto face crop for small faces / gym selfies
- Honest confidence scoring (distance → percent)
- Mobile-first UI
- Gallery of **267** pre-embedded celebrities (actors, artists, athletes, public figures)

## Stack

- React 19 · TypeScript · Vite · TanStack Start
- Tailwind CSS v4
- `@vladmandic/face-api` (FaceNet-style recognition models)
- Celebrity embeddings in `public/celebs/embeddings.json`

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

1. Detect face (SSD MobileNet) and landmarks
2. Crop / normalize the face
3. Extract a **128-d** face descriptor
4. Compare with Euclidean distance to precomputed celebrity descriptors
5. Rank top matches with age/gender affinity and calibrated match %

Models live in `public/models/face-api/`. Portrait thumbnails + embeddings live in `public/celebs/`.

## Project layout

```
src/
  components/     # UI (capture, results, app shell)
  lib/face/       # pipeline, embeddings, scoring, tests
  lib/celebrities/# catalog metadata
public/
  celebs/         # portraits + embeddings.json
  models/face-api/# face-api weights
```

## Privacy

Matching runs **in the browser**. Photos are not uploaded to Twinframe servers for recognition.

## License

Celebrity photos are sourced from Wikipedia thumbnails for demo/educational use. Face-api model weights follow their upstream licenses. Code is provided as-is for this project.
