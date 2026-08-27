#!/usr/bin/env node
/**
 * Re-enroll the celebrity gallery with the live AccuFace pipeline:
 * SCRFD-2.5G detect (letterbox 640) → 5-pt Umeyama align (112) → AdaFace IR-101.
 *
 * Mirrors the browser preprocessing exactly (same normalization, anchors,
 * decode, alignment matrix) so probe and gallery embeddings are comparable.
 *
 * Outputs /tmp/twinframe-enroll/embeddings.json with both truncated-256 and
 * full-512 L2-normalized vectors per id, for calibration analysis before the
 * binary gallery is written by write-gallery-v4.mjs.
 *
 * Newly enrolled extra views pass a same-person gate (scripts/lib/extra-gate.mjs)
 * before they are written, so a mislabeled Commons photo cannot poison a
 * celebrity's multi-shot centroid.
 *
 * Usage:
 *   node --experimental-strip-types scripts/enroll-gallery-onnx.mjs [--limit N] [--concurrency N]
 *   node --experimental-strip-types scripts/enroll-gallery-onnx.mjs --extras-only [--ids a,b]
 *
 * `--extras-only` skips the 1000 primaries entirely (hours of CPU) and gates the
 * new views against the primaries already stored in embeddings.v4.q8.bin.
 */
import { createCanvas, loadImage } from "canvas";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compute5PointSimilarityMatrix } from "../src/lib/face/similarity-transform.ts";
import { generateAnchors, nmsFaceBoxes, selectPrimaryFace } from "../src/lib/face/scrfd.ts";
import { estimateSmileMetrics } from "../src/lib/face/types.ts";
import { collectEnrollJobs, resolveExtraViewCap } from "./lib/enroll-jobs.mjs";
import { gateExtraCandidates } from "./lib/extra-gate.mjs";
import { decodeV4Gallery } from "./lib/gallery-binary.mjs";
import { mapProcessPool, parseConcurrencyArg } from "./lib/photo-pool.mjs";

export { selectPrimaryFace };

const ROOT = process.cwd();
const CELEBS = path.join(ROOT, "public/celebs");
const THUMB_PNG = "/tmp/twinframe-thumbs-png";
const OUT_DIR = "/tmp/twinframe-enroll";
const EMBED_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib/embed-worker.mjs");

const limitIdx = process.argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
const EXTRAS_ONLY = process.argv.includes("--extras-only");
const idsIdx = process.argv.indexOf("--ids");
const ONLY_IDS = new Set(
  idsIdx >= 0 ? String(process.argv[idsIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [],
);

const ADAFACE_PATH = path.join(ROOT, "public/models/adaface_ir101_webface12m.onnx");
const ADAFACE_MIN_BYTES = 50 * 1024 * 1024;

export function adafaceModelReady(modelPath = ADAFACE_PATH, minBytes = ADAFACE_MIN_BYTES) {
  try {
    return fs.statSync(modelPath).size >= minBytes;
  } catch {
    return false;
  }
}

/** @type {Promise<{ ort: typeof import("onnxruntime-web"), scrfdSession: any, embedSession: any, embedKind: "adaface" | "edgeface" }> | null} */
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
  const useAda = adafaceModelReady();
  const embedPath = useAda ? ADAFACE_PATH : path.join(ROOT, "public/models/edgeface_m.onnx");
  const embedSession = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(embedPath)), {
    executionProviders: ["wasm"],
  });
  return { ort, scrfdSession, embedSession, embedKind: useAda ? "adaface" : "edgeface" };
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

/** Whole-crop primaries are how the 14-id AdaFace cluster got poisoned. */
export function acceptPrimaryEmbed(result) {
  return Boolean(result?.usedDetection);
}

export function swapRgbToBgr(tensorData, size = 112) {
  const out = new Float32Array(tensorData);
  const ch = size * size;
  for (let i = 0; i < ch; i++) {
    const tmp = out[i];
    out[i] = out[2 * ch + i];
    out[2 * ch + i] = tmp;
  }
  return out;
}

async function embed(tensorData) {
  const { ort, embedSession, embedKind } = await ensureSessions();
  const data = embedKind === "adaface" ? swapRgbToBgr(tensorData) : tensorData;
  const tensor = new ort.Tensor("float32", data, [1, 3, 112, 112]);
  const out = await embedSession.run({ [embedSession.inputNames[0]]: tensor });
  const raw = out[embedSession.outputNames[0]].data;
  return {
    d256: l2(Array.from(raw.slice(0, 256))),
    d512: l2(Array.from(raw)),
    embedKind,
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

/**
 * Same face-centric square the browser crop-review sends to analysis
 * (0.45 pad, 1024px). Distant / full-body probes must use this before embed.
 */
export async function productCropImageFile(filePath, outPath) {
  const img = await loadImage(filePath);
  let faces = await detectFaces(img);
  let primary = selectPrimaryFace(faces);
  let box = primary?.bbox;
  if (!box) {
    const padded = padImage(img);
    faces = await detectFaces(padded.canvas);
    primary = selectPrimaryFace(faces);
    if (primary) {
      box = {
        x: primary.bbox.x - padded.margin,
        y: primary.bbox.y - padded.margin,
        width: primary.bbox.width,
        height: primary.bbox.height,
      };
    }
  }
  if (!box) {
    return { path: filePath, cropped: false, faceCount: 0, score: 0 };
  }
  const pad = 0.45;
  const size = 1024;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const side = Math.max(box.width, box.height) * (1 + pad * 2);
  const cropSide = Math.min(side, Math.min(img.width, img.height));
  let sx = Math.max(0, Math.min(img.width - cropSide, cx - cropSide / 2));
  let sy = Math.max(0, Math.min(img.height - cropSide, cy - cropSide / 2));
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, size, size);
  const dest = outPath ?? path.join(OUT_DIR, "product-crop.jpg");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, canvas.toBuffer("image/jpeg", { quality: 0.92 }));
  return {
    path: dest,
    cropped: true,
    faceCount: faces.length,
    score: primary?.score ?? 0,
    box,
  };
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

  const primary = selectPrimaryFace(faces);
  const usedDetection = Boolean(primary);
  const tensor = usedDetection
    ? alignTensor(alignSource, primary.landmarks)
    : wholeCropTensor(img);
  const emb = await embed(tensor);
  return {
    ...emb,
    usedDetection,
    padded: offset > 0 && usedDetection,
    faceCount: faces.length,
    score: primary?.score ?? 0,
  };
}

/** Enrolled primaries straight from the shipping binary — no re-enroll needed. */
function shippedPrimaries() {
  const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
  const buf = fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin"));
  const { header, vectors } = decodeV4Gallery(buf);
  if (header.vectorCount !== buckets.length) {
    throw new Error(`binary has ${header.vectorCount} vectors, buckets has ${buckets.length}`);
  }
  const byId = new Map();
  for (let i = 0; i < buckets.length; i++) {
    if (!byId.has(buckets[i].id)) byId.set(buckets[i].id, vectors[i]);
  }
  return byId;
}

/** Already-shipped extra templates, so a re-fetched duplicate view is rejected. */
function shippedExtras() {
  const p = path.join(CELEBS, "extra-templates.json");
  const byId = new Map();
  if (!fs.existsSync(p)) return byId;
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const t of data.templates ?? []) {
    const list = byId.get(t.id) ?? [];
    list.push(t.descriptor);
    byId.set(t.id, list);
  }
  return byId;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buckets = JSON.parse(
    fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"),
  );
  const selected = ONLY_IDS.size > 0 ? buckets.filter((b) => ONLY_IDS.has(b.id)) : buckets;
  const list = selected.slice(0, LIMIT === Infinity ? selected.length : LIMIT);
  const extraViewCap = resolveExtraViewCap();
  const allJobs = collectEnrollJobs(list, {
    celebsDir: CELEBS,
    thumbDir: THUMB_PNG,
    extraViewCap,
  });
  const embedJobs = allJobs.filter((j) =>
    EXTRAS_ONLY ? j.kind === "extra" : j.kind !== "missing",
  );
  const concurrency = parseConcurrencyArg();
  const t0 = Date.now();

  console.log(
    `enroll jobs=${embedJobs.length} mode=${EXTRAS_ONLY ? "extras-only" : "full"} ` +
      `extraViewCap=${extraViewCap} concurrency=${concurrency}`,
  );
  if (embedJobs.length === 0) {
    console.log("nothing to enroll");
    return;
  }

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
  const extraCandidates = [];
  let detected = 0;
  let refusedWholeCrop = 0;
  let missing = allJobs.filter((j) => j.kind === "missing").length;
  if (!EXTRAS_ONLY) {
    for (const b of allJobs) {
      if (b.kind === "missing") console.error("no image for", b.id);
    }
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
      if (!acceptPrimaryEmbed(r)) {
        refusedWholeCrop++;
        missing++;
        console.error("primary detection failed — refusing whole-crop", job.id);
        continue;
      }
      detected++;
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
      extraCandidates.push({
        id: job.id,
        source: job.source,
        usedDetection: r.usedDetection,
        score: Math.round(r.score * 1000) / 1000,
        d256: r.d256,
        d512: r.d512,
        descriptor: r.d512,
      });
      continue;
    }
    if (job.kind === "missing") continue;
    const _exhaustive = job.kind;
    throw new Error(`unknown enroll job kind: ${_exhaustive}`);
  }

  if (process.env.TWINFRAME_DUMP_CANDIDATES) {
    fs.writeFileSync(process.env.TWINFRAME_DUMP_CANDIDATES, JSON.stringify(extraCandidates));
  }

  const primaries = EXTRAS_ONLY
    ? shippedPrimaries()
    : new Map(rows.map((r) => [r.id, Float32Array.from(r.d512)]));
  const existingById = EXTRAS_ONLY ? shippedExtras() : new Map();
  const gate = gateExtraCandidates(extraCandidates, {
    primaries,
    existingById,
    maxPerId: extraViewCap,
  });
  const extras = gate.accepted.map(({ descriptor: _drop, ...keep }) => keep);

  console.log(
    `\ndetected=${detected} refusedWholeCrop=${refusedWholeCrop} missing=${missing} elapsed=${Math.round((Date.now() - t0) / 1000)}s`,
  );
  console.log(
    `extras gate: accepted=${gate.stats.accepted} rejected=${gate.stats.rejected} ` +
      `ids=${gate.stats.idsWithNewViews} maxDist=${gate.stats.maxDistance} ` +
      `reasons=${JSON.stringify(gate.stats.byReason)}`,
  );

  if (!EXTRAS_ONLY) {
    fs.writeFileSync(path.join(OUT_DIR, "embeddings.json"), JSON.stringify(rows));
  }
  fs.writeFileSync(path.join(OUT_DIR, "extras.json"), JSON.stringify(extras));
  fs.writeFileSync(
    path.join(OUT_DIR, "extras-gate.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), ...gate.stats, rejected: gate.rejected }, null, 2),
  );
  console.log(
    `wrote ${OUT_DIR}/extras.json (${extras.length})` +
      (EXTRAS_ONLY ? " + extras-gate.json (primaries untouched)" : ` + embeddings.json (${rows.length})`),
  );
}

if (process.argv[1] && process.argv[1].endsWith("enroll-gallery-onnx.mjs")) {
  await main();
}
