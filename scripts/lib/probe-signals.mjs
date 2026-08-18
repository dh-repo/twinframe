/**
 * Node-side detect → signals → EdgeFace embed for evaluation probes.
 *
 * Mirrors the browser/product pipeline exactly: SCRFD-2.5G letterbox-640 detect,
 * the product's own `estimateHeadPose` / `estimateSmileMetrics` on the 5-point
 * landmarks, 5-point Umeyama align to 112, EdgeFace embed. Model sessions are
 * borrowed from scripts/enroll-gallery-onnx.mjs so gallery and probe embeddings
 * stay byte-comparable.
 *
 * Used by scripts/label-hard-probes.mjs (signals only) and
 * scripts/evaluate-held-out.ts (signals + 512-d descriptor).
 */
import { createCanvas, loadImage } from "canvas";
import sharp from "sharp";
import { compute5PointSimilarityMatrix } from "../../src/lib/face/similarity-transform.ts";
import { estimateHeadPose, generateAnchors, nmsFaceBoxes } from "../../src/lib/face/scrfd.ts";
import { estimateSmileMetrics } from "../../src/lib/face/types.ts";
import { ensureSessions } from "../enroll-gallery-onnx.mjs";

/** Bump when a derived signal changes meaning, so caches recompute. */
export const SIGNALS_VERSION = "1.1.0";

const INPUT_DIM = 640;
const anchorsByStride = generateAnchors(INPUT_DIM, INPUT_DIM);

function letterboxTensor(img) {
  const origW = img.width;
  const origH = img.height;
  const scale = Math.min(INPUT_DIM / Math.max(1, origW), INPUT_DIM / Math.max(1, origH));
  const padX = (INPUT_DIM - origW * scale) / 2;
  const padY = (INPUT_DIM - origH * scale) / 2;
  const canvas = createCanvas(INPUT_DIM, INPUT_DIM);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, INPUT_DIM, INPUT_DIM);
  ctx.drawImage(img, 0, 0, origW, origH, padX, padY, origW * scale, origH * scale);
  const rgba = ctx.getImageData(0, 0, INPUT_DIM, INPUT_DIM).data;
  const planeSize = INPUT_DIM * INPUT_DIM;
  const data = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    data[i] = (rgba[i * 4] - 127.5) / 128.0;
    data[planeSize + i] = (rgba[i * 4 + 1] - 127.5) / 128.0;
    data[2 * planeSize + i] = (rgba[i * 4 + 2] - 127.5) / 128.0;
  }
  return { data, scale, padX, padY, origW, origH };
}

async function detectFaces(img, scoreThreshold = 0.4) {
  const { ort, scrfdSession } = await ensureSessions();
  const { data, scale, padX, padY, origW, origH } = letterboxTensor(img);
  const tensor = new ort.Tensor("float32", data, [1, 3, INPUT_DIM, INPUT_DIM]);
  const outputMap = await scrfdSession.run({ [scrfdSession.inputNames[0]]: tensor });

  const byStride = {
    8: { score: outputMap.score_8.data, bbox: outputMap.bbox_8.data, kps: outputMap.kps_8.data },
    16: { score: outputMap.score_16.data, bbox: outputMap.bbox_16.data, kps: outputMap.kps_16.data },
    32: { score: outputMap.score_32.data, bbox: outputMap.bbox_32.data, kps: outputMap.kps_32.data },
  };

  const raw = [];
  for (const stride of [8, 16, 32]) {
    const anchors = anchorsByStride[stride];
    const { score, bbox, kps } = byStride[stride];
    for (let i = 0; i < anchors.length; i++) {
      const s = score[i];
      if (s < scoreThreshold) continue;
      const a = anchors[i];
      const x1 = Math.max(0, (a.cx - bbox[i * 4] * stride - padX) / scale);
      const y1 = Math.max(0, (a.cy - bbox[i * 4 + 1] * stride - padY) / scale);
      const x2 = Math.min(origW, (a.cx + bbox[i * 4 + 2] * stride - padX) / scale);
      const y2 = Math.min(origH, (a.cy + bbox[i * 4 + 3] * stride - padY) / scale);
      const landmarks = new Float32Array(10);
      for (let k = 0; k < 5; k++) {
        landmarks[k * 2] = (a.cx + kps[i * 10 + k * 2] * stride - padX) / scale;
        landmarks[k * 2 + 1] = (a.cy + kps[i * 10 + k * 2 + 1] * stride - padY) / scale;
      }
      raw.push({
        bbox: { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) },
        score: s,
        confidence: s,
        landmarks,
        normalizedBox: { x: 0, y: 0, width: 0, height: 0 },
        normalizedLandmarks: [],
        pose: estimateHeadPose(landmarks),
        smile: estimateSmileMetrics(landmarks),
      });
    }
  }
  return nmsFaceBoxes(raw, 0.4);
}

/** Paste a tight crop onto a grey canvas so SCRFD sees context margin. */
function padImage(img, marginRatio = 0.6) {
  const margin = Math.round(Math.max(img.width, img.height) * marginRatio);
  const w = img.width + margin * 2;
  const h = img.height + margin * 2;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, margin, margin);
  return { canvas, margin };
}

function alignedTensor(source, landmarks, targetSize = 112) {
  const { M } = compute5PointSimilarityMatrix(landmarks, targetSize);
  const canvas = createCanvas(targetSize, targetSize);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.setTransform(M[0][0], M[1][0], M[0][1], M[1][1], M[0][2], M[1][2]);
  ctx.drawImage(source, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rgba = ctx.getImageData(0, 0, targetSize, targetSize).data;
  const planeSize = targetSize * targetSize;
  const tensor = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensor[i] = (rgba[i * 4] - 127.5) / 128.0;
    tensor[planeSize + i] = (rgba[i * 4 + 1] - 127.5) / 128.0;
    tensor[2 * planeSize + i] = (rgba[i * 4 + 2] - 127.5) / 128.0;
  }
  return tensor;
}

function wholeCropTensor(img, targetSize = 112) {
  const canvas = createCanvas(targetSize, targetSize);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, targetSize, targetSize);
  const rgba = ctx.getImageData(0, 0, targetSize, targetSize).data;
  const planeSize = targetSize * targetSize;
  const tensor = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensor[i] = (rgba[i * 4] - 127.5) / 128.0;
    tensor[planeSize + i] = (rgba[i * 4 + 1] - 127.5) / 128.0;
    tensor[2 * planeSize + i] = (rgba[i * 4 + 2] - 127.5) / 128.0;
  }
  return tensor;
}

function l2(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  return Array.from(v, (x) => x / n);
}

/**
 * Rec.709 mean luma (0-1) of the detection box region of the source image.
 * Sampled on a 48×48 downscale — enough for an exposure statistic.
 */
export function meanLumaOfRegion(source, box, sampleDim = 48) {
  const sx = Math.max(0, Math.min(source.width - 1, Math.round(box.x)));
  const sy = Math.max(0, Math.min(source.height - 1, Math.round(box.y)));
  const sw = Math.max(1, Math.min(source.width - sx, Math.round(box.width)));
  const sh = Math.max(1, Math.min(source.height - sy, Math.round(box.height)));
  const canvas = createCanvas(sampleDim, sampleDim);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sampleDim, sampleDim);
  const rgba = ctx.getImageData(0, 0, sampleDim, sampleDim).data;
  let sum = 0;
  const pixels = sampleDim * sampleDim;
  for (let i = 0; i < pixels; i++) {
    sum += 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  }
  return sum / pixels / 255;
}

/**
 * node-canvas decodes JPEG/PNG only, and the corpus contains WebP files (some
 * named .jpg). Fall back to a sharp → PNG transcode so no probe is silently lost.
 */
export async function loadRaster(filePath) {
  try {
    return await loadImage(filePath);
  } catch {
    const png = await sharp(filePath).png().toBuffer();
    return loadImage(png);
  }
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * Detect, derive hard-probe signals, and optionally embed one image file.
 *
 * `signals.glasses` is never set here — geometry cannot see eyewear. Supply it
 * through the hand-label override file (see scripts/label-hard-probes.mjs).
 *
 * @param {string} filePath
 * @param {{ embed?: boolean }} [options]
 */
export async function analyzeProbeImage(filePath, options = {}) {
  const withEmbedding = options.embed !== false;
  const img = await loadRaster(filePath);
  let faces = await detectFaces(img);
  let alignSource = img;
  let offset = 0;

  if (faces.length === 0) {
    // 192px thumbs can fill the whole letterbox; retry with grey margin.
    const { canvas, margin } = padImage(img);
    faces = await detectFaces(canvas);
    alignSource = canvas;
    offset = margin;
  }

  const face = faces[0] ?? null;
  const usedDetection = face !== null;
  const boxInSource = face
    ? {
        x: face.bbox.x - offset,
        y: face.bbox.y - offset,
        width: face.bbox.width,
        height: face.bbox.height,
      }
    : null;

  const signals = {};
  if (boxInSource) {
    signals.meanLuma = round(meanLumaOfRegion(img, boxInSource), 4);
    signals.faceCoverage = round(
      (boxInSource.width * boxInSource.height) / Math.max(1, img.width * img.height),
      4,
    );
  }
  if (face) {
    signals.yawDeg = face.pose.yaw;
    signals.smileIntensity = round(face.smile.smileIntensity, 4);
  }

  // Kept next to the signals so a reader can see when smileIntensity is clamped
  // (smileRatio well past 0.92 means the proxy saturated, not that the smile grew).
  const diagnostics = face
    ? {
        smileRatio: face.smile.smileRatio,
        commissureElevation: face.smile.commissureElevation,
        pitchDeg: face.pose.pitch,
        rollDeg: face.pose.roll,
      }
    : null;

  let descriptor512 = null;
  let descriptor256 = null;
  if (withEmbedding) {
    const { ort, edgeSession } = await ensureSessions();
    const tensorData = face
      ? alignedTensor(alignSource, face.landmarks)
      : wholeCropTensor(img);
    const tensor = new ort.Tensor("float32", tensorData, [1, 3, 112, 112]);
    const out = await edgeSession.run({ [edgeSession.inputNames[0]]: tensor });
    const raw = out[edgeSession.outputNames[0]].data;
    descriptor512 = l2(Array.from(raw));
    descriptor256 = l2(Array.from(raw.slice(0, 256)));
  }

  return {
    signalsVersion: SIGNALS_VERSION,
    usedDetection,
    padded: offset > 0 && usedDetection,
    faceCount: faces.length,
    score: face ? round(face.score, 4) : 0,
    imageWidth: img.width,
    imageHeight: img.height,
    bbox: boxInSource,
    pose: face ? face.pose : null,
    signals,
    diagnostics,
    descriptor512,
    descriptor256,
  };
}
