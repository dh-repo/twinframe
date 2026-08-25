#!/usr/bin/env node
/**
 * Aligned model arena v2: compares EdgeFace-M vs AdaFace IR-101 vs GhostFaceNet
 * on SCRFD-detected + 5-point-aligned faces from held-out probe photos ranked
 * against a portrait gallery. All models get identical aligned inputs.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import ort from "onnxruntime-node";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const D = 640;

// --- SCRFD decode (ported from src/lib/face/scrfd.ts) ---
function generateAnchors(w, h) {
  const r = {};
  for (const s of [8, 16, 32]) {
    const a = [];
    for (let y = 0; y < Math.ceil(h / s); y++)
      for (let x = 0; x < Math.ceil(w / s); x++)
        for (let k = 0; k < 2; k++) a.push({ cx: (x + 0.5) * s, cy: (y + 0.5) * s, stride: s });
    r[s] = a;
  }
  return r;
}
function iou(a, b) {
  const xA = Math.max(a.x1, b.x1), yA = Math.max(a.y1, b.y1);
  const xB = Math.min(a.x2, b.x2), yB = Math.min(a.y2, b.y2);
  const inter = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union <= 0 ? 0 : inter / union;
}
function nms(dets, t) {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept = [];
  while (sorted.length) {
    const cur = sorted.shift();
    kept.push(cur);
    for (let i = sorted.length - 1; i >= 0; i--)
      if (iou(cur.bbox, sorted[i].bbox) >= t) sorted.splice(i, 1);
  }
  return kept;
}

const REF = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
function simMatrix(lm) {
  const src = [];
  for (let i = 0; i < 5; i++) src.push([lm[i * 2], lm[i * 2 + 1]]);
  let ss = 0, sx = 0, sy = 0, r0 = 0, r1 = 0, r2 = 0, r3 = 0;
  for (let i = 0; i < 5; i++) {
    const [x, y] = src[i], [u, v] = REF[i];
    ss += x * x + y * y; sx += x; sy += y;
    r0 += x * u + y * v; r1 += -y * u + x * v; r2 += u; r3 += v;
  }
  const A = [[ss, 0, sx, sy, r0], [0, ss, -sy, sx, r1], [sx, -sy, 5, 0, r2], [sy, sx, 0, 5, r3]];
  for (let i = 0; i < 4; i++) {
    let mx = i;
    for (let k = i + 1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[mx][i])) mx = k;
    [A[i], A[mx]] = [A[mx], A[i]];
    if (Math.abs(A[i][i]) < 1e-10) return { invM: [[1, 0, 0], [0, 1, 0]] };
    for (let j = i; j <= 4; j++) A[i][j] /= A[i][i];
    for (let k = 0; k < 4; k++) {
      if (k !== i) { const f = A[k][i]; for (let j = i; j <= 4; j++) A[k][j] -= f * A[i][j]; }
    }
  }
  const a = A[0][2], b = A[0][3], tx = A[1][2], ty = A[1][3];
  const ssq = a * a + b * b || 1e-10, iv = 1 / ssq;
  return { invM: [[a * iv, b * iv, (-a * tx - b * ty) * iv], [-b * iv, a * iv, (b * tx - a * ty) * iv]] };
}

function warp(raw, w, h, lm) {
  const { invM } = simMatrix(lm);
  const out = new Uint8Array(112 * 112 * 3);
  for (let dy = 0; dy < 112; dy++)
    for (let dx = 0; dx < 112; dx++) {
      const sx = invM[0][0] * (dx + 0.5) + invM[0][1] * (dy + 0.5) + invM[0][2];
      const sy = invM[1][0] * (dx + 0.5) + invM[1][1] * (dy + 0.5) + invM[1][2];
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(h - 1, Math.floor(sy)));
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
      const o0 = (y0 * w + x0) * 3, o1 = (y0 * w + x1) * 3, o2 = (y1 * w + x0) * 3, o3 = (y1 * w + x1) * 3;
      const oo = (dy * 112 + dx) * 3;
      for (let c = 0; c < 3; c++)
        out[oo + c] = raw[o0 + c] * (1 - fx) * (1 - fy) + raw[o1 + c] * fx * (1 - fy) + raw[o2 + c] * (1 - fx) * fy + raw[o3 + c] * fx * fy;
    }
  return out;
}

async function detect(sess, raw, w, h) {
  const sc = Math.min(D / w, D / h);
  const px = (D - w * sc) / 2, py = (D - h * sc) / 2;
  const rw = Math.round(w * sc), rh = Math.round(h * sc);
  const lb = Buffer.alloc(D * D * 3, 0);
  const rs = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).resize(rw, rh).raw().toBuffer();
  for (let y = 0; y < rh; y++) {
    const s = y * rw * 3, d = (Math.round(py) + y) * D * 3 + Math.round(px) * 3;
    rs.copy(lb, d, s, s + rw * 3);
  }
  const ps = D * D, f = new Float32Array(3 * ps);
  for (let i = 0; i < ps; i++) { f[i] = lb[i * 3] / 128; f[ps + i] = lb[i * 3 + 1] / 128; f[2 * ps + i] = lb[i * 3 + 2] / 128; }
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", f, [1, 3, D, D]) });
  const anchors = generateAnchors(D, D);
  const map = { 12800: 8, 3200: 16, 800: 32 };
  const parsed = { 8: {}, 16: {}, 32: {} };
  for (const n of Object.keys(out)) {
    const data = out[n].data, dims = out[n].dims;
    let ac, ch;
    if (dims.length === 3) { ac = dims[1]; ch = dims[2]; } else if (dims.length === 2) { ac = dims[0]; ch = dims[1]; }
    const st = ac ? map[ac] : undefined;
    if (!st || !ch) continue;
    if (ch === 1) parsed[st].scoreData = data;
    else if (ch === 2) { parsed[st].scoreData = data; parsed[st].ss = 2; }
    else if (ch === 4) parsed[st].bboxData = data;
    else if (ch === 10) parsed[st].kpsData = data;
  }
  const dets = [];
  for (const stride of [8, 16, 32]) {
    const an = anchors[stride], p = parsed[stride];
    if (!p.scoreData || !p.bboxData || !p.kpsData) continue;
    const ss = p.ss ?? 1;
    for (let i = 0; i < an.length; i++) {
      const sc = ss === 2 ? p.scoreData[i * 2 + 1] : p.scoreData[i];
      if (sc < 0.4) continue;
      const a = an[i];
      dets.push({
        score: sc,
        bbox: { x1: (a.cx - p.bboxData[i * 4] * stride - px) / sc, y1: (a.cy - p.bboxData[i * 4 + 1] * stride - py) / sc, x2: (a.cx + p.bboxData[i * 4 + 2] * stride - px) / sc, y2: (a.cy + p.bboxData[i * 4 + 3] * stride - py) / sc },
        landmarks: (() => { const l = new Float32Array(10); for (let k = 0; k < 5; k++) { l[k * 2] = (a.cx + p.kpsData[i * 10 + k * 2] * stride - px) / sc; l[k * 2 + 1] = (a.cy + p.kpsData[i * 10 + k * 2 + 1] * stride - py) / sc; } return l; })(),
      });
    }
  }
  return nms(dets, 0.4)[0] ?? null;
}

// --- Models ---
const MODELS = {
  edgeface_m: { file: "public/models/edgeface_m.onnx", layout: "nchw", channels: "rgb" },
  adaface_ir101: { file: "models-arena/adaface_ir101_webface12m.onnx", layout: "nchw", channels: "bgr" },
};

const sessions = {};
for (const [name, m] of Object.entries(MODELS)) {
  sessions[name] = await ort.InferenceSession.create(path.join(ROOT, m.file), { executionProviders: ["cpu"] });
}

function embed(session, aligned, layout, channels) {
  const size = 112, ps = size * size;
  const swap = channels === "bgr";
  const ch = (i) => { const r = aligned[i * 3], g = aligned[i * 3 + 1], b = aligned[i * 3 + 2]; return swap ? [b, g, r] : [r, g, b]; };
  let t;
  if (layout === "nchw") {
    t = new Float32Array(3 * ps);
    for (let i = 0; i < ps; i++) { const [r, g, b] = ch(i); t[i] = (r - 127.5) / 128; t[ps + i] = (g - 127.5) / 128; t[2 * ps + i] = (b - 127.5) / 128; }
    return { tensor: new ort.Tensor("float32", t, [1, 3, size, size]), raw: t };
  }
  t = new Float32Array(ps * 3);
  for (let i = 0; i < ps; i++) { const [r, g, b] = ch(i); t[i * 3] = (r - 127.5) / 128; t[i * 3 + 1] = (g - 127.5) / 128; t[i * 3 + 2] = (b - 127.5) / 128; }
  return { tensor: new ort.Tensor("float32", t, [1, size, size, 3]), raw: t };
}

function l2(v) { let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i]; n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v; }

// --- Data ---
const portraits = fs.readdirSync(CELEBS).filter(f => f.endsWith(".jpg")).sort()
  .map(f => ({ id: f.replace(/\.jpg$/, ""), file: path.join(CELEBS, f) }));

const probeFiles = [];
const heldOutDir = path.join(CELEBS, "held-out");
for (const dir of fs.readdirSync(heldOutDir).sort()) {
  const sub = path.join(heldOutDir, dir);
  if (!fs.statSync(sub).isDirectory()) continue;
  const files = fs.readdirSync(sub).filter(f => f.endsWith(".jpg")).sort().slice(0, 1);
  for (const f of files) probeFiles.push({ id: dir, file: path.join(sub, f) });
}

console.log(`[arena-v2] portraits: ${portraits.length} | held-out probes: ${probeFiles.length}`);

// --- Phase 1: enroll portraits ---
const enroll = Object.fromEntries(Object.keys(MODELS).map(k => [k, new Map()]));
let enrolled = 0, noFace = 0;
for (const p of portraits) {
  try {
    const { data, info } = await sharp(p.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const det = await detect(sessions ? Object.values(sessions)[0] : null, data, info.width, info.height).catch(() => null);
    // Use scrfd session specifically
    const d2 = await detect(sessions["edgeface_m"] ? await ort.InferenceSession.create(path.join(ROOT, "public/models/scrfd_2.5g.onnx"), { executionProviders: ["cpu"] }) : null, data, info.width, info.height).catch(() => null);
    // Just use the scrfd session directly
    const scrfdSess = sessions["_scrfd"] || (sessions["_scrfd"] = await ort.InferenceSession.create(path.join(ROOT, "public/models/scrfd_2.5g.onnx"), { executionProviders: ["cpu"] }));
    const detection = await detect(scrfdSess, data, info.width, info.height);
    if (!detection) { noFace++; continue; }
    const aligned = warp(data, info.width, info.height, detection.landmarks);
    for (const [name, m] of Object.entries(MODELS)) {
      const { tensor } = embed(sessions[name], aligned, m.layout, m.channels);
      const out = await sessions[name].run({ [sessions[name].inputNames[0]]: tensor });
      const vec = l2(Float32Array.from(out[Object.keys(out)[0]].data));
      enroll[name].set(p.id, vec);
    }
    enrolled++;
  } catch (e) { console.log(`[err] ${p.id}: ${e.message.slice(0, 80)}`); }
  if (enrolled % 100 === 0) console.log(`[enroll] ${enrolled}/${portraits.length}`);
}
console.log(`[enroll] done: ${enrolled} ok, ${noFace} no-face`);

// --- Phase 2: rank held-out probes ---
const probes = Object.fromEntries(Object.keys(MODELS).map(k => [k, new Map()]));
let probeNoFace = 0;
for (const p of probeFiles) {
  try {
    const { data, info } = await sharp(p.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const scrfdSess = sessions["_scrfd"] || (sessions["_scrfd"] = await ort.InferenceSession.create(path.join(ROOT, "public/models/scrfd_2.5g.onnx"), { executionProviders: ["cpu"] }));
    const det = await detect(scrfdSess, data, info.width, info.height);
    if (!det) { probeNoFace++; continue; }
    const aligned = warp(data, info.width, info.height, det.landmarks);
    for (const [name, m] of Object.entries(MODELS)) {
      const { tensor } = embed(sessions[name], aligned, m.layout, m.channels);
      const out = await sessions[name].run({ [sessions[name].inputNames[0]]: tensor });
      const vec = l2(Float32Array.from(out[Object.keys(out)[0]].data));
      probes[name].set(p.id + "|" + path.basename(p.file), vec);
    }
  } catch (e) { console.log(`[probe-err] ${p.id}: ${e.message.slice(0, 80)}`); }
}
console.log(`[probes] done: ${probeFiles.length - probeNoFace} ok, ${probeNoFace} no-face`);

// --- Phase 3: score ---
console.log("\n" + "=".repeat(72));
for (const [name, pmap] of Object.entries(probes)) {
  const emap = enroll[name];
  let r1 = 0, r5 = 0, mrrSum = 0, n = 0;
  for (const [key, qv] of pmap) {
    const trueId = key.split("|")[0];
    if (!emap.has(trueId)) continue;
    const scored = [];
    for (const [eid, ev] of emap) {
      let d = 0;
      for (let i = 0; i < qv.length; i++) d += qv[i] * ev[i];
      scored.push({ id: eid, s: d });
    }
    scored.sort((a, b) => b.s - a.s);
    const rank = scored.findIndex(x => x.id === trueId) + 1;
    n++;
    if (rank === 1) r1++;
    if (rank >= 1 && rank <= 5) r5++;
    if (rank > 0) mrrSum += 1 / rank;
  }
  if (n === 0) continue;
  console.log(
    `${name.padEnd(24)} Rank-1 ${((r1 / n) * 100).toFixed(1)}%  Rank-5 ${((r5 / n) * 100).toFixed(1)}%  MRR ${(mrrSum / n).toFixed(3)}  (n=${n})`
  );
}
console.log("(identical SCRFD + 5pt-aligned probes ranked against portrait gallery)");
