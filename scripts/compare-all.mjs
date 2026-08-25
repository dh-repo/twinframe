import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const TMP = "/var/folders/kp/gcr9sjgd67s21jj17s01l9rr0000gn/T/opencode";

function rank(probeVec, enroll) {
  const scored = [];
  for (const [id, vec] of enroll) {
    let d = 0;
    for (let i = 0; i < probeVec.length; i++) d += probeVec[i] * vec[i];
    scored.push({ id, s: d });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored;
}
function evalModel(probeCases, enroll) {
  let r1 = 0, r5 = 0, mrrSum = 0, n = 0;
  const misses = [];
  for (const c of probeCases) {
    if (!c.ok || !c.descriptor?.length) continue;
    const scored = rank(c.descriptor, enroll);
    const r = scored.findIndex((s) => s.id === c.id) + 1;
    n++;
    if (r === 1) r1++;
    if (r >= 1 && r <= 5) r5++;
    if (r > 0) mrrSum += 1 / r;
    else misses.push(`${c.id} → ${scored[0]?.id}`);
  }
  return { r1, r5, mrrSum, n, misses };
}

// --- AdaFace IR-101 WebFace12M ---
const adaEnroll = JSON.parse(fs.readFileSync(`${TMP}/adaface-enroll.json`, "utf8"));
const adaProbes = JSON.parse(fs.readFileSync(`${TMP}/adaface-probes.json`, "utf8"));
const adaE = new Map();
for (const c of adaEnroll.cases) if (c.ok && c.descriptor?.length) adaE.set(c.id, c.descriptor);
const ada = evalModel(adaProbes.cases, adaE);
console.log(`AdaFace IR-101 WebFace12M (n=${ada.n}):`);
console.log(`  Rank-1 ${((ada.r1 / ada.n) * 100).toFixed(1)}% | Rank-5 ${((ada.r5 / ada.n) * 100).toFixed(1)}% | MRR ${(ada.mrrSum / ada.n).toFixed(3)}`);
if (ada.misses.length) console.log(`  misses: ${ada.misses.slice(0, 6).join(", ")}`);

// --- GhostFaceNetV1 W1.3 S1 ---
const ghostEnroll = JSON.parse(fs.readFileSync(`${TMP}/ghost-enroll.json`, "utf8"));
const ghostProbes = JSON.parse(fs.readFileSync(`${TMP}/ghost-probes.json`, "utf8"));
const ghostE = new Map();
for (const c of ghostEnroll.cases) if (c.ok && c.descriptor?.length) ghostE.set(c.id, c.descriptor);
const ghost = evalModel(ghostProbes.cases, ghostE);
console.log(`\nGhostFaceNetV1 W1.3 S1 (n=${ghost.n}):`);
console.log(`  Rank-1 ${((ghost.r1 / ghost.n) * 100).toFixed(1)}% | Rank-5 ${((ghost.r5 / ghost.n) * 100).toFixed(1)}% | MRR ${(ghost.mrrSum / ghost.n).toFixed(3)}`);

// --- EdgeFace-M shipped ---
const bin = fs.readFileSync(path.join(ROOT, "public/celebs/embeddings.v4.q8.bin"));
const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const dim = view.getUint16(12, true), scale = view.getFloat32(16, true);
const buckets = JSON.parse(fs.readFileSync(path.join(ROOT, "public/celebs/gallery.buckets.json"), "utf8"));
const edgeE = new Map();
for (let i = 0; i < buckets.length; i++) {
  const off = 32 + i * dim;
  const v = new Float32Array(dim);
  let n = 0;
  for (let j = 0; j < dim; j++) { v[j] = (bin[off + j] - 128) * scale; n += v[j] * v[j]; }
  n = Math.sqrt(n) || 1;
  for (let j = 0; j < dim; j++) v[j] /= n;
  edgeE.set(buckets[i].id, Array.from(v));
}
const held = JSON.parse(fs.readFileSync(path.join(ROOT, "public/celebs/held-out/descriptors.json"), "utf8"));
const edge = evalModel(held.cases, edgeE);
console.log(`\nEdgeFace-M shipped (n=${edge.n}):`);
console.log(`  Rank-1 ${((edge.r1 / edge.n) * 100).toFixed(1)}% | Rank-5 ${((edge.r5 / edge.n) * 100).toFixed(1)}% | MRR ${(edge.mrrSum / edge.n).toFixed(3)}`);
if (edge.misses.length) console.log(`  misses: ${edge.misses.slice(0, 6).join(", ")}`);
