/**
 * Batch re-enroll slots from full-res live-pipeline descriptors.
 * Reads public/celebs/tier-descriptors-full.json and patches each slot
 * via the same AFv4 binary write as patch-gallery-slot.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const full = JSON.parse(fs.readFileSync(path.join(CELEBS, "tier-descriptors-full.json"), "utf8"));
const bin = fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin"));
if (bin.subarray(0, 4).toString("latin1") !== "AFv4") throw new Error("Bad v4 magic");
const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const count = view.getUint32(8, true);
const dim = view.getUint16(12, true);
const scale = view.getFloat32(16, true);
const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(CELEBS, "index.json"), "utf8"));

let patched = 0, skipped = 0;
for (const c of full.cases) {
  if (!c.ok || !c.descriptor?.length || c.descriptor.length !== dim) { skipped++; continue; }
  const idx = buckets.findIndex((b) => b.id === c.id);
  if (idx < 0) { skipped++; continue; }
  const vec = c.descriptor;
  let n = 0;
  for (let j = 0; j < dim; j++) n += vec[j] * vec[j];
  n = Math.sqrt(n) || 1;
  const byteOff = 32 + idx * dim;
  for (let j = 0; j < dim; j++) {
    const q = Math.max(-127, Math.min(127, Math.round((vec[j] / n) / scale)));
    bin[byteOff + j] = q + 128;
  }
  patched++;
}
fs.writeFileSync(path.join(CELEBS, "embeddings.v4.q8.bin"), bin);
console.log(`re-enrolled ${patched} slots from full-res descriptors (${skipped} skipped)`);
