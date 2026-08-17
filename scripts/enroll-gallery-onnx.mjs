#!/usr/bin/env node
/**
 * Re-enroll the celebrity gallery with the REAL AccuFace pipeline:
 * SCRFD-2.5G detect (letterbox 640) → 5-pt Umeyama align (112) → EdgeFace embed.
 *
 * Mirrors the browser preprocessing exactly (same normalization, anchors,
 * decode, alignment matrix) so probe and gallery embeddings are comparable.
 *
 * Outputs /tmp/twinframe-enroll/embeddings.json with both truncated-256 and
 * full-512 L2-normalized vectors per id, for calibration analysis before the
 * binary gallery is written by write-gallery-v4.mjs.
 *
 * Usage:
 *   node --experimental-strip-types scripts/enroll-gallery-onnx.mjs [--limit N] [--concurrency N]
 */
import { createCanvas, loadImage } from "canvas";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compute5PointSimilarityMatrix } from "../src/lib/face/similarity-transform.ts";
import { generateAnchors, nmsFaceBoxes } from "../src/lib/face/scrfd.ts";
import { estimateSmileMetrics } from "../src/lib/face/types.ts";
import { collectEnrollJobs } from "./lib/enroll-jobs.mjs";
import { mapProcessPool, parseConcurrencyArg } from "./lib/photo-pool.mjs";

const ROOT = process.cwd();
const CELEBS = path.join(ROOT, "public/celebs");
const THUMB_PNG = "/tmp/twinframe-thumbs-png";
const OUT_DIR = "/tmp/twinframe-enroll";
const EMBED_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib/embed-worker.mjs");

const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;

/** @type {Promise<{ ort: typeof import("onnxruntime-web"), scrfdSession: any, edgeSession: any }> | null} */
let sessionsPromise = null;

export function ensureSessions() {
  if (!sessionsPromise) sessionsPromise = loadSessions();
  return sessionsPromise;
}

async function loadSessions() {
  // Parent enroll/calibrate stay model-free; only embed workers load ORT.
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = 1;
  const scrfdSession = await ort.InferenceSession.create(
    new Uint8Array(fs.readFileSync(path.join(ROOT, "public/models/scrfd_2.5g.onnx"))),
    { executionProviders: ["wasm"] },
  );
  const edgeSession = await ort.InferenceSession.create(
    new Uint8Array(fs.readFileSync(path.join(ROOT, "public/models/edgeface_m.onnx"))),
    { executionProviders: ["wasm"] },
  );
  return { ort, scrfdSession, edgeSession };
}

const anchorsByStride = generateAnchors(640, 640);

function imageToLetterboxTensor(img) {
  const inputDim = 640;
  const origW = img.width;
  const origH = img.height;
  const scale = Math.min(inputDim / Math.max(1, origW), inputDim / Math.max(1, origH));
  const padX = (inputDim - origW * scale) / 2;
  const padY = (inputDim - origH * scale) / 2;
  const canvas = createCanvas(inputDim, inputDim);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, inputDim, inputDim);
  ctx.drawImage(img, 0, 0, origW, origH, padX, padY, origW * scale, origH * scale);
  const rgba = ctx.getImageData(0, 0, inputDim, inputDim).data;
  const planeSize = inputDim * inputDim;
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
  const { data, scale, padX, padY, origW, origH } = imageToLetterboxTensor(img);
  const tensor = new ort.Tensor("float32", data, [1, 3, 640, 640]);
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
        pose: { yaw: 0, pitch: 0, roll: 0 },
        smile: estimateSmileMetrics(landmarks),
      });
    }
  }
  return nmsFaceBoxes(raw, 0.4);
}

function alignTensor(img, landmarks, targetSize = 112) {
  const { M } = compute5PointSimilarityMatrix(landmarks, targetSize);
  const canvas = createCanvas(targetSize, targetSize);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.setTransform(M[0][0], M[1][0], M[0][1], M[1][1], M[0][2], M[1][2]);
  ctx.drawImage(img, 0, 0);
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

async function embed(tensorData) {
  const { ort, edgeSession } = await ensureSessions();
  const tensor = new ort.Tensor("float32", tensorData, [1, 3, 112, 112]);
  const out = await edgeSession.run({ [edgeSession.inputNames[0]]: tensor });
  const raw = out[edgeSession.outputNames[0]].data;
  return {
    d256: l2(Array.from(raw.slice(0, 256))),
    d512: l2(Array.from(raw)),
  };
}

/** Paste a tight face crop onto a larger canvas so SCRFD sees context margin. */
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

export async function embedImageFile(filePath) {
  const img = await loadImage(filePath);
  let faces = await detectFaces(img);
  let alignSource = img;
  let offset = 0;

  if (faces.length === 0) {
    // Tight crops (192px thumbs) can fill the letterbox; retry with margin.
    const { canvas, margin } = padImage(img);
    faces = await detectFaces(canvas);
    alignSource = canvas;
    offset = margin;
  }

  const usedDetection = faces.length > 0;
  const tensor = usedDetection
    ? alignTensor(alignSource, faces[0].landmarks)
    : wholeCropTensor(img);
  const emb = await embed(tensor);
  return {
    ...emb,
    usedDetection,
    padded: offset > 0 && usedDetection,
    faceCount: faces.length,
    score: faces[0]?.score ?? 0,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buckets = JSON.parse(
    fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"),
  );
  const list = buckets.slice(0, LIMIT === Infinity ? buckets.length : LIMIT);
  const allJobs = collectEnrollJobs(list, { celebsDir: CELEBS, thumbDir: THUMB_PNG });
  const embedJobs = allJobs.filter((j) => j.kind !== "missing");
  const concurrency = parseConcurrencyArg();
  const t0 = Date.now();

  console.log(
    `enroll jobs=${embedJobs.length} missingImages=${allJobs.length - embedJobs.length} concurrency=${concurrency}`,
  );

  const poolResults = await mapProcessPool(embedJobs, {
    workerPath: EMBED_WORKER,
    concurrency,
    onProgress(done, total) {
      if (done % 50 !== 0 && done !== total) return;
      const rate = done / Math.max(0.001, (Date.now() - t0) / 1000);
      process.stdout.write(
        `\r${done}/${total} (${rate.toFixed(1)}/s, eta ${(Math.max(0, total - done) / rate).toFixed(0)}s)`,
      );
    },
  });

  const rows = [];
  const extras = [];
  let detected = 0;
  let fallback = 0;
  let missing = allJobs.length - embedJobs.length;
  for (const b of allJobs) {
    if (b.kind === "missing") console.error("no image for", b.id);
  }

  for (let i = 0; i < embedJobs.length; i++) {
    const job = embedJobs[i];
    const result = poolResults[i];
    if (!result?.ok) {
      if (job.kind === "primary") {
        missing++;
        console.error("embed failed", job.id, String(result?.error ?? "").slice(0, 120));
      }
      continue;
    }
    const r = result.value;
    if (job.kind === "primary") {
      if (r.usedDetection) detected++;
      else fallback++;
      rows.push({
        id: job.id,
        source: job.source,
        usedDetection: r.usedDetection,
        score: Math.round(r.score * 1000) / 1000,
        d256: r.d256,
        d512: r.d512,
      });
      continue;
    }
    if (job.kind === "extra") {
      if (!r.usedDetection) continue;
      extras.push({
        id: job.id,
        source: job.source,
        score: Math.round(r.score * 1000) / 1000,
        d256: r.d256,
        d512: r.d512,
      });
      continue;
    }
    const _exhaustive = job.kind;
    throw new Error(`unknown enroll job kind: ${_exhaustive}`);
  }

  console.log(
    `\ndetected=${detected} fallback=${fallback} missing=${missing} extras=${extras.length} elapsed=${Math.round((Date.now() - t0) / 1000)}s`,
  );
  fs.writeFileSync(path.join(OUT_DIR, "embeddings.json"), JSON.stringify(rows));
  fs.writeFileSync(path.join(OUT_DIR, "extras.json"), JSON.stringify(extras));
  console.log(`wrote ${OUT_DIR}/embeddings.json (${rows.length}) + extras.json (${extras.length})`);
}

if (process.argv[1] && process.argv[1].endsWith("enroll-gallery-onnx.mjs")) {
  await main();
}
