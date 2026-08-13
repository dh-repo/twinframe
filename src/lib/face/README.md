# Twinframe matching engine v2

## Pipeline

1. **Detect** — SSD MobileNet face detector (auto-finds small faces in full-body shots)
2. **Crop** — padded 320×320 portrait for preview; **Dlib eye/mouth align → 150×150** for FaceNet
3. **Describe** — FaceNet 128-d embedding (`faceRecognitionNet`) + age/gender
4. **Rank** — Euclidean distance vs pre-enrolled celebrity embeddings
5. **Calibrate** — distance → honest match % (≈0.40 strong, ≈0.55 borderline)
6. **Explain** — facial structure / age / presentation signals

Re-encode the gallery after this align change (`node scripts/re-encode-browser.mjs`) so query and enroll share the same crop. Do not treat live quality as improved until that pack is rebuilt.

## Gallery

- Photos: `public/celebs/*.jpg` (Wikipedia thumbnails)
- Embeddings: `public/celebs/embeddings.json` (precomputed FaceNet vectors)
- Re-enroll after adding photos: run the enrollment Playwright script used at build time

## Tests

```bash
npm run test:match
```

| Suite | Guards |
| --- | --- |
| `math.test.ts` | Clamp, Lab, L1/cosine helpers |
| `geometry.test.ts` | Landmark utilities / quality (legacy path) |
| `match.test.ts` | Distance calibration, geometry self-ID regression, gallery integrity |

## Accuracy upgrade path

1. More enrollment photos per celebrity (avg of 3+ embeddings)
2. ArcFace / InsightFace server for higher quality descriptors
3. Hard-negative mining from user feedback (“not me”)
4. Expand gallery; keep self-ID + probe cluster tests green
