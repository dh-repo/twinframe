#!/usr/bin/env node
/**
 * CPU embed latency / size / cosine-parity probe for AdaFace IR-101 fp32 vs INT8.
 *
 *   node scripts/probe-embed-latency.mjs [--json reports/adaface-int8-speed.json]
 *
 * Uses onnxruntime-node (not browser WASM). Numbers are a CPU baseline, not a
 * product claim. Does not rewrite gallery identity slots.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "canvas";

const require = createRequire(import.meta.url);
const ort = require("onnxruntime-node");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FP32 = path.join(ROOT, "public/models/adaface_ir101_webface12m.onnx");
const FP16 = path.join(ROOT, "public/models/adaface_ir101_webface12m.fp16.onnx");
const INT8 = path.join(ROOT, "public/models/adaface_ir101_webface12m.int8.onnx");
const CELEBS = path.join(ROOT, "public/celebs");
const MIN_FP32 = 50 * 1024 * 1024;
const MIN_INT8 = 8 * 1024 * 1024;
const TARGET = 112;
const WARMUP = 1;
const RUNS = 3;
const PARITY_N = 8;

function sized(p, min) {
  try {
    return fs.statSync(p).size >= min;
  } catch {
    return false;
  }
}

function jpegToBgrNchw(img) {
  const canvas = createCanvas(TARGET, TARGET);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, TARGET, TARGET);
  const { data } = ctx.getImageData(0, 0, TARGET, TARGET);
  const plane = TARGET * TARGET;
  const out = new Float32Array(1 * 3 * plane);
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    out[i] = (b - 127.5) / 128.0;
    out[plane + i] = (g - 127.5) / 128.0;
    out[2 * plane + i] = (r - 127.5) / 128.0;
  }
  return out;
}

function l2(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] ?? 0) * (v[i] ?? 0);
  const n = Math.sqrt(s);
  if (!Number.isFinite(n) || n < 1e-12) return new Float32Array(v.length);
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = (v[i] ?? 0) / n;
  return o;
}

function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

async function embedSession(session, tensor) {
  const t0 = performance.now();
  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", tensor, [1, 3, TARGET, TARGET]) };
  const out = await session.run(feeds);
  const ms = performance.now() - t0;
  const first = out[session.outputNames[0]] ?? Object.values(out)[0];
  return { embedding: l2(first.data), ms, dim: first.data.length };
}

async function timeModel(modelPath, tensors) {
  const tLoad0 = performance.now();
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });
  const loadMs = performance.now() - tLoad0;
  const times = [];
  const embeddings = [];
  for (let i = 0; i < WARMUP; i++) {
    await embedSession(session, tensors[i % tensors.length]);
  }
  for (let i = 0; i < Math.max(RUNS, tensors.length); i++) {
    const tensor = tensors[i % tensors.length];
    const res = await embedSession(session, tensor);
    if (i < tensors.length) embeddings.push(res.embedding);
    if (i < RUNS) times.push(res.ms);
  }
  await session.release();
  times.sort((a, b) => a - b);
  return {
    loadMs,
    medianMs: times[Math.floor(times.length / 2)] ?? 0,
    meanMs: times.reduce((a, b) => a + b, 0) / Math.max(1, times.length),
    dim: embeddings[0]?.length ?? 0,
    embeddings,
    bytes: fs.statSync(modelPath).size,
  };
}

function pickJpegs(n) {
  const names = fs.readdirSync(CELEBS).filter((f) => f.endsWith(".jpg")).sort();
  const picked = [];
  for (const name of names) {
    if (picked.length >= n) break;
    picked.push(path.join(CELEBS, name));
  }
  return picked;
}

const jsonIdx = process.argv.indexOf("--json");
const jsonPath = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null;

if (!sized(FP32, MIN_FP32)) {
  console.log("[probe] AdaFace fp32 missing; run npm run model:ensure");
  process.exit(0);
}

const jpegs = pickJpegs(PARITY_N);
const tensors = [];
for (const p of jpegs) {
  tensors.push(jpegToBgrNchw(await loadImage(p)));
}

console.log(`[probe] fp32 ${FP32} (${(fs.statSync(FP32).size / 1024 / 1024).toFixed(1)} MB)`);
const fp32 = await timeModel(FP32, tensors);
console.log(
  `[probe] fp32 load=${fp32.loadMs.toFixed(0)}ms median_embed=${fp32.medianMs.toFixed(0)}ms dim=${fp32.dim}`,
);

let fp16 = null;
let fp16Cos = [];
if (sized(FP16, MIN_INT8)) {
  console.log(`[probe] fp16 ${FP16} (${(fs.statSync(FP16).size / 1024 / 1024).toFixed(1)} MB)`);
  fp16 = await timeModel(FP16, tensors);
  console.log(
    `[probe] fp16 load=${fp16.loadMs.toFixed(0)}ms median_embed=${fp16.medianMs.toFixed(0)}ms dim=${fp16.dim}`,
  );
  const n = Math.min(fp32.embeddings.length, fp16.embeddings.length);
  for (let i = 0; i < n; i++) fp16Cos.push(cosine(fp32.embeddings[i], fp16.embeddings[i]));
  const meanCos = fp16Cos.reduce((a, b) => a + b, 0) / Math.max(1, fp16Cos.length);
  console.log(`[probe] fp16 cosine vs fp32 mean=${meanCos.toFixed(4)} min=${Math.min(...fp16Cos).toFixed(4)}`);
}

let int8 = null;
let cosines = [];
if (sized(INT8, MIN_INT8)) {
  console.log(`[probe] int8 ${INT8} (${(fs.statSync(INT8).size / 1024 / 1024).toFixed(1)} MB)`);
  int8 = await timeModel(INT8, tensors);
  console.log(
    `[probe] int8 load=${int8.loadMs.toFixed(0)}ms median_embed=${int8.medianMs.toFixed(0)}ms dim=${int8.dim}`,
  );
  const n = Math.min(fp32.embeddings.length, int8.embeddings.length);
  for (let i = 0; i < n; i++) cosines.push(cosine(fp32.embeddings[i], int8.embeddings[i]));
  const meanCos = cosines.reduce((a, b) => a + b, 0) / Math.max(1, cosines.length);
  const minCos = Math.min(...cosines);
  console.log(`[probe] cosine vs fp32 mean=${meanCos.toFixed(4)} min=${minCos.toFixed(4)} n=${n}`);
} else {
  console.log("[probe] INT8 artifact missing — generate with npm run model:ensure");
}

const report = {
  at: new Date().toISOString(),
  provider: "onnxruntime-node-cpu",
  note: "CPU node baseline, not browser WASM. Same 512-d AdaFace IR-101 graph; no new geometry.",
  studentTrained: false,
  studentReason:
    "No WebFace12M corpus and no GPU training cluster in this environment; INT8 of the same IR-101 graph is the honest speed path, and FP16 is the shippable fast path when PTQ fails the identity gate.",
  probes: jpegs.map((p) => path.basename(p)),
  fp32: {
    path: "public/models/adaface_ir101_webface12m.onnx",
    bytes: fp32.bytes,
    loadMs: fp32.loadMs,
    medianEmbedMs: fp32.medianMs,
    meanEmbedMs: fp32.meanMs,
    dim: fp32.dim,
  },
  fp16: fp16
    ? {
        path: "public/models/adaface_ir101_webface12m.fp16.onnx",
        bytes: fp16.bytes,
        loadMs: fp16.loadMs,
        medianEmbedMs: fp16.medianMs,
        meanEmbedMs: fp16.meanMs,
        dim: fp16.dim,
        sizeRatio: fp16.bytes / fp32.bytes,
        speedupMedian: fp32.medianMs / Math.max(1e-6, fp16.medianMs),
      }
    : null,
  int8: int8
    ? {
        path: "public/models/adaface_ir101_webface12m.int8.onnx",
        bytes: int8.bytes,
        loadMs: int8.loadMs,
        medianEmbedMs: int8.medianMs,
        meanEmbedMs: int8.meanMs,
        dim: int8.dim,
        sizeRatio: int8.bytes / fp32.bytes,
        speedupMedian: fp32.medianMs / Math.max(1e-6, int8.medianMs),
      }
    : null,
  cosine: {
    fp16: fp16Cos.length
      ? {
          n: fp16Cos.length,
          mean: fp16Cos.reduce((a, b) => a + b, 0) / fp16Cos.length,
          min: Math.min(...fp16Cos),
          max: Math.max(...fp16Cos),
        }
      : null,
    int8: cosines.length
      ? {
          n: cosines.length,
          mean: cosines.reduce((a, b) => a + b, 0) / cosines.length,
          min: Math.min(...cosines),
          max: Math.max(...cosines),
        }
      : null,
  },
};

console.log(JSON.stringify(report, null, 2));
if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`[probe] wrote ${jsonPath}`);
}
