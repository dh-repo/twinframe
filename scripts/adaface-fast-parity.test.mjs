import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "canvas";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FP32 = path.join(ROOT, "public/models/adaface_ir101_webface12m.onnx");
const FP16 = path.join(ROOT, "public/models/adaface_ir101_webface12m.fp16.onnx");
const INT8 = path.join(ROOT, "public/models/adaface_ir101_webface12m.int8.onnx");
const CELEBS = path.join(ROOT, "public/celebs");
const MAX_MEAN_DRIFT = 0.03;
const TARGET = 112;

function sized(p, min) {
  try {
    return fs.statSync(p).size >= min;
  } catch {
    return false;
  }
}

function jpegToBgr(img) {
  const canvas = createCanvas(TARGET, TARGET);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, TARGET, TARGET);
  const { data } = ctx.getImageData(0, 0, TARGET, TARGET);
  const plane = TARGET * TARGET;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = ((data[i * 4 + 2] ?? 0) - 127.5) / 128.0;
    out[plane + i] = ((data[i * 4 + 1] ?? 0) - 127.5) / 128.0;
    out[2 * plane + i] = ((data[i * 4] ?? 0) - 127.5) / 128.0;
  }
  return out;
}

function l2(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] ?? 0) * (v[i] ?? 0);
  const n = Math.sqrt(s);
  const o = new Float32Array(v.length);
  if (!Number.isFinite(n) || n < 1e-12) return o;
  for (let i = 0; i < v.length; i++) o[i] = (v[i] ?? 0) / n;
  return o;
}

function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

async function embedAll(ort, modelPath, tensors) {
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });
  const embs = [];
  for (const tensor of tensors) {
    const out = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", tensor, [1, 3, TARGET, TARGET]),
    });
    const first = out[session.outputNames[0]] ?? Object.values(out)[0];
    assert.equal(first.data.length, 512, `${modelPath} must emit 512-d`);
    embs.push(l2(first.data));
  }
  await session.release();
  return embs;
}

describe("AdaFace fast-path cosine parity vs fp32", () => {
  it("pins the identity gate used to reject full-graph INT8", () => {
    assert.equal(MAX_MEAN_DRIFT, 0.03);
    const reportPath = path.join(ROOT, "reports/adaface-int8-speed.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.liveFastPath, "fp16");
    assert.equal(report.int8Live, false);
    assert.equal(report.studentTrained, false);
    assert.ok(report.cosine.fp16.mean >= 1 - MAX_MEAN_DRIFT);
  });

  it("FP16 of the same IR-101 graph stays within max mean cosine drift", async (t) => {
    if (!sized(FP32, 50 * 1024 * 1024) || !sized(FP16, 20 * 1024 * 1024)) {
      t.skip("AdaFace fp32/fp16 artifacts missing — run npm run model:ensure");
      return;
    }
    const ort = require("onnxruntime-node");
    const jpegs = fs.readdirSync(CELEBS).filter((f) => f.endsWith(".jpg")).sort().slice(0, 6);
    const tensors = [];
    for (const name of jpegs) tensors.push(jpegToBgr(await loadImage(path.join(CELEBS, name))));
    const fp32 = await embedAll(ort, FP32, tensors);
    const fp16 = await embedAll(ort, FP16, tensors);
    const cos = fp32.map((v, i) => cosine(v, fp16[i]));
    const mean = cos.reduce((a, b) => a + b, 0) / cos.length;
    const min = Math.min(...cos);
    assert.ok(mean >= 1 - MAX_MEAN_DRIFT, `fp16 mean cosine ${mean} drifted more than ${MAX_MEAN_DRIFT}`);
    assert.ok(min >= 1 - 0.05, `fp16 min cosine ${min} is identity-breaking`);
  });

  it("does not install INT8 as a live artifact unless it also passes the identity gate", async () => {
    if (!sized(INT8, 8 * 1024 * 1024)) {
      assert.equal(sized(INT8, 8 * 1024 * 1024), false);
      return;
    }
    if (!sized(FP32, 50 * 1024 * 1024)) return;
    const ort = require("onnxruntime-node");
    const jpegs = fs.readdirSync(CELEBS).filter((f) => f.endsWith(".jpg")).sort().slice(0, 4);
    const tensors = [];
    for (const name of jpegs) tensors.push(jpegToBgr(await loadImage(path.join(CELEBS, name))));
    const fp32 = await embedAll(ort, FP32, tensors);
    const int8 = await embedAll(ort, INT8, tensors);
    const mean = fp32.map((v, i) => cosine(v, int8[i])).reduce((a, b) => a + b, 0) / fp32.length;
    assert.ok(
      mean >= 1 - MAX_MEAN_DRIFT,
      `INT8 is on disk but mean cosine ${mean} < gate; delete it so it cannot ship`,
    );
  });
});
