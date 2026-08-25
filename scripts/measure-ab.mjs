import fs from "node:fs";
import path from "node:path";

function loadDescriptors(f) {
  return JSON.parse(fs.readFileSync(f, "utf8")).cases.filter(c => c.ok && c.descriptor?.length);
}
function loadSlots() {
  const bin = fs.readFileSync(path.join(process.cwd(), "public/celebs/embeddings.v4.q8.bin"));
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const dim = view.getUint16(12, true), scale = view.getFloat32(16, true);
  const buckets = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/celebs/gallery.buckets.json"), "utf8"));
  const map = new Map();
  for (let i = 0; i < buckets.length; i++) {
    const off = 32 + i * dim;
    const v = new Float32Array(dim);
    let n = 0;
    for (let j = 0; j < dim; j++) { v[j] = (bin[off + j] - 128) * scale; n += v[j] * v[j]; }
    n = Math.sqrt(n) || 1;
    for (let j = 0; j < dim; j++) v[j] /= n;
    map.set(buckets[i].id, v);
  }
  return map;
}
function rank1(probes, enroll) {
  let hits = 0, n = 0;
  for (const c of probes) {
    if (!enroll.has(c.id)) continue;
    let best = -Infinity, bestId = "";
    for (const [id, vec] of enroll) {
      let d = 0;
      for (let i = 0; i < c.descriptor.length; i++) d += c.descriptor[i] * vec[i];
      if (d > best) { best = d; bestId = id; }
    }
    n++;
    if (bestId === c.id) hits++;
  }
  return { pct: n ? (hits / n * 100) : 0, n };
}

const tta = loadDescriptors("/var/folders/kp/gcr9sjgd67s21jj17s01l9rr0000gn/T/opencode/tta-probes.json");
const notta = loadDescriptors("public/celebs/held-out/descriptors.json");
const full = loadDescriptors("public/celebs/tier-descriptors-full.json");
const slots = loadSlots();

console.log("=== A/B/C decomposition ===");
const a = rank1(notta, slots);
console.log(`A) non-TTA probes vs current slots:        ${a.pct.toFixed(1)}% (n=${a.n})  [BASELINE]`);
const b = rank1(tta, slots);
console.log(`B) TTA probes vs current slots:            ${b.pct.toFixed(1)}% (n=${b.n})  [TTA effect]`);
// full-res re-enroll: patch slots with full descriptors, then re-measure
const fullMap = new Map(full.filter(c => c.ok && c.descriptor?.length).map(c => [c.id, c.descriptor]));
const patchedSlots = new Map(slots);
for (const [id, desc] of fullMap) {
  if (!patchedSlots.has(id)) continue;
  const v = new Float32Array(desc);
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  patchedSlots.set(id, v);
}
const c1 = rank1(notta, patchedSlots);
console.log(`C) non-TTA probes vs full-res slots:       ${c1.pct.toFixed(1)}% (n=${c1.n})  [full-res effect]`);
const d = rank1(tta, patchedSlots);
console.log(`D) TTA probes vs full-res slots:           ${d.pct.toFixed(1)}% (n=${d.n})  [TTA + full-res]`);
