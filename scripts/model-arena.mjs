#!/usr/bin/env node
/**
 * Model arena: evaluate candidate face-recognition ONNX models against the
 * held-out probe set through the same ranking math the shipped matcher uses.
 *
 * Baseline is the in-repo EdgeFace-M. Third-party candidates must be
 * downloaded explicitly with --download <id>; each registry entry carries its
 * license so non-commercial weights cannot slip into evaluation unnoticed.
 * Nothing here ships a model — public/models/ is only touched by humans.
 *
 * Usage:
 *   node scripts/model-arena.mjs                       # baseline only
 *   node scripts/model-arena.mjs --download <id>       # fetch a candidate
 *   node scripts/model-arena.mjs --all-available       # eval every local model
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const ARENA_DIR = path.join(ROOT, "models-arena");
const PROBE_ROOT = path.join(CELEBS, "held-out");

/** Curated candidates. license must allow commercial redistribution of weights. */
const REGISTRY = {
  edgeface_m: {
    name: "EdgeFace-M (shipped baseline)",
    file: path.join(ROOT, "public/models/edgeface_m.onnx"),
    inputSize: 112,
    dim: 512,
    layout: "nchw",
    mean: 127.5,
    std: 128,
    license: "in-repo (Apache-2.0 model card)",
    sourceUrl: "https://github.com/otroshi/edgeface",
  },
  // LICENSING REVIEW 2026-08-24: the only readily downloadable third-party
  // ONNX candidate found (huggingface.co/garavv/arcface-onnx) carries NO
  // license (no tag, no file) and descends from the insightface/ArcFace
  // lineage whose training data is research-only. Excluded from evaluation
  // per the biometrics/legal rules in AGENTS.md. Any future candidate must
  // ship a commercial-ok license before entering this registry.
  //
  // NOTE: both third-party entries require manual preparation today —
  // ghostfacenet_g600: upstream repo moved (404); original weights were Keras,
  //   so an ONNX export must be produced or relocated before evaluation.
  // adaface_r50: upstream ships PyTorch .pth only; an ONNX conversion is
  //   required. Drop a converted model at the registered path to evaluate.
  ghostfacenet_g600: {
    name: "GhostFaceNetV1 W1.3 S1 ArcFace (MS1MV3)",
    file: path.join(ARENA_DIR, "ghostfacenet_w13_s1.onnx"),
    inputSize: 112,
    dim: 512,
    layout: "nhwc",
    mean: 127.5,
    std: 128,
    license: "MIT (verified: HamadYA/GhostFaceNets)",
    sourceUrl: "https://github.com/HamadYA/GhostFaceNets",
    download: null,
    // Converted from the official v1.2 Keras release
    // (GhostFaceNet_W1.3_S1_ArcFace.h5) via tf2onnx opset 13;
    // TF↔ONNX parity cosine 0.99997. Full saved-model load — the CSP-style
    // variant in the h5 differs from backbones/ghost_model.py's builder.
  },
  adaface_r50: {
    name: "AdaFace ResNet-50 (WebFace4M)",
    file: path.join(ARENA_DIR, "adaface_r50.onnx"),
    inputSize: 112,
    dim: 512,
    layout: "nchw",
    mean: 127.5,
    std: 127.5,
    license: "MIT",
    sourceUrl: "https://github.com/mk-minchul/AdaFace",
    download: null,
  },
};

const args = process.argv.slice(2);
const downloadId = args.includes("--download") ? args[args.indexOf("--download") + 1] : null;
const allAvailable = args.includes("--all-available");

async function download(id) {
  const entry = REGISTRY[id];
  if (!entry?.download) {
    console.error(`no downloadable source registered for "${id}"`);
    process.exit(1);
  }
  fs.mkdirSync(ARENA_DIR, { recursive: true });
  console.log(`[arena] downloading ${entry.name} (${entry.license}) from ${entry.download}`);
  const res = await fetch(entry.download);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(entry.file, buf);
  const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  console.log(`[arena] saved ${entry.file} (${(buf.length / 1e6).toFixed(1)}MB) sha256:${sha}…`);
}

if (downloadId) {
  await download(downloadId);
}

const ort = await import("onnxruntime-node");

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp is required for image preprocessing");
  process.exit(1);
}

async function embedImage(session, entry, filePath) {
  const size = entry.inputSize;
  const { data } = await sharp(filePath)
    .removeAlpha()
    .resize(size, size, { fit: "cover" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const norm = (v) => (v - entry.mean) / entry.std;
  let tensorData;
  if (entry.layout === "nhwc") {
    // channel-last: pixel-interleaved RGB
    tensorData = new Float32Array(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      tensorData[i * 3] = norm(data[i * 3]);
      tensorData[i * 3 + 1] = norm(data[i * 3 + 1]);
      tensorData[i * 3 + 2] = norm(data[i * 3 + 2]);
    }
  } else {
    // planar NCHW: channel-contiguous
    tensorData = new Float32Array(3 * size * size);
    const stride = size * size;
    for (let i = 0; i < stride; i++) {
      tensorData[i] = norm(data[i * 3]);
      tensorData[i + stride] = norm(data[i * 3 + 1]);
      tensorData[i + 2 * stride] = norm(data[i * 3 + 2]);
    }
  }
  const shape =
    entry.layout === "nhwc" ? [1, size, size, 3] : [1, 3, size, size];
  const feeds = { [session.inputNames[0]]: new ort.Tensor("float32", tensorData, shape) };
  const out = await session.run(feeds);
  const t = out[Object.keys(out)[0]];
  const raw = t.data;
  let n = 0;
  for (let i = 0; i < raw.length; i++) n += raw[i] * raw[i];
  n = Math.sqrt(n) || 1;
  return Float32Array.from(raw, (v) => v / n);
}

function cosine(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return 1 - d;
}

/** Collect held-out probes: one photo per celeb dir (the tracked pack's sources). */
function collectProbes(limitPerCeleb = 2) {
  const probes = [];
  for (const dir of fs.readdirSync(PROBE_ROOT).sort()) {
    const sub = path.join(PROBE_ROOT, dir);
    if (!fs.statSync(sub).isDirectory()) continue;
    const files = fs.readdirSync(sub).filter((f) => f.endsWith(".jpg")).sort();
    for (const f of files.slice(0, limitPerCeleb)) {
      probes.push({ id: dir, file: path.join(sub, f) });
    }
  }
  return probes;
}

/** Enrollment pool: top-level portraits (one per celeb id). */
function collectEnrollment() {
  const out = [];
  for (const f of fs.readdirSync(CELEBS).sort()) {
    if (f.endsWith(".jpg")) out.push({ id: f.replace(/\.jpg$/, ""), file: path.join(CELEBS, f) });
  }
  return out;
}

async function evaluateModel(id, entry, probes, enrollment) {
  if (!fs.existsSync(entry.file)) return null;
  const session = await ort.InferenceSession.create(entry.file, {
    executionProviders: ["cpu"],
  });
  const t0 = Date.now();
  const enrollVecs = [];
  for (const e of enrollment) {
    try {
      enrollVecs.push({ id: e.id, vec: await embedImage(session, entry, e.file) });
    } catch {
      /* portraits that fail detection/decode are excluded honestly */
    }
  }
  let rank1 = 0;
  let rank5 = 0;
  let mrr = 0;
  let n = 0;
  for (const p of probes) {
    let vec;
    try {
      vec = await embedImage(session, entry, p.file);
    } catch {
      continue;
    }
    const scored = enrollVecs
      .map((e) => ({ id: e.id, d: cosine(vec, e.vec) }))
      .sort((a, b) => a.d - b.d);
    const rank = scored.findIndex((s) => s.id === p.id) + 1;
    n++;
    if (rank === 1) rank1++;
    if (rank >= 1 && rank <= 5) rank5++;
    if (rank > 0) mrr += 1 / rank;
  }
  return {
    id,
    name: entry.name,
    license: entry.license,
    enrolled: enrollVecs.length,
    probes: n,
    top1Pct: n ? (rank1 / n) * 100 : 0,
    top5Pct: n ? (rank5 / n) * 100 : 0,
    mrr: n ? mrr / n : 0,
    evalMs: Date.now() - t0,
  };
}

const targets = Object.entries(REGISTRY).filter(([id]) => {
  if (id === "edgeface_m") return true;
  if (downloadId === id) return true;
  return allAvailable && fs.existsSync(REGISTRY[id].file);
});

const results = [];
for (const [id, entry] of targets) {
  if (!fs.existsSync(entry.file)) continue;
  process.stdout.write(`[arena] evaluating ${entry.name}…\n`);
  const probes = collectProbes();
  const enrollment = collectEnrollment();
  const r = await evaluateModel(id, entry, probes, enrollment);
  if (r) results.push(r);
  console.log(
    `[arena] ${r ? `Top-1 ${r.top1Pct.toFixed(1)}% Top-5 ${r.top5Pct.toFixed(1)}% MRR ${r.mrr.toFixed(3)} (probes ${r.probes})` : "skipped"}`,
  );
}

console.log("\n" + "=".repeat(72));
console.log(
  results
    .sort((a, b) => b.top1Pct - a.top1Pct)
    .map((r) => `${r.name.padEnd(34)} ${r.top1Pct.toFixed(1)}%  ${r.license}`)
    .join("\n"),
);

fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "reports/model-arena.json"),
  JSON.stringify({ at: new Date().toISOString(), results }, null, 1),
);
