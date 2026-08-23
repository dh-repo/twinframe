#!/usr/bin/env node
/**
 * Remove a celebrity slot from the shipped gallery atomically: rewrites the
 * AFv4 binary without that vector and drops the bucket/index entries so all
 * three artifacts stay aligned.
 *
 * Usage: node scripts/drop-gallery-slot.mjs --id gwenyth-paltrow
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

const idIdx = process.argv.indexOf("--id");
const id = idIdx >= 0 ? process.argv[idIdx + 1] : undefined;
if (!id) {
  console.error("usage: --id <celeb-id>");
  process.exit(1);
}

const binPath = path.join(CELEBS, "embeddings.v4.q8.bin");
const bin = fs.readFileSync(binPath);
if (bin.subarray(0, 4).toString("latin1") !== "AFv4") throw new Error("Bad v4 magic");
const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const count = view.getUint32(8, true);
const dim = view.getUint16(12, true);

const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(CELEBS, "index.json"), "utf8"));

if (count !== buckets.length) throw new Error(`header ${count} != buckets ${buckets.length}`);
const slot = buckets.findIndex((b) => b.id === id);
if (slot < 0) throw new Error(`id not in buckets: ${id}`);

// Rewrite binary minus that record.
const out = Buffer.alloc(bin.byteLength - dim);
bin.subarray(0, 32 + slot * dim).copy(out, 0);
bin.subarray(32 + (slot + 1) * dim).copy(out, 32 + slot * dim);
view.setUint32(8, count - 1, true);
out.subarray(0, 32).set(bin.subarray(0, 32));
fs.writeFileSync(binPath, out);

fs.writeFileSync(
  path.join(CELEBS, "gallery.buckets.json"),
  JSON.stringify(buckets.filter((b) => b.id !== id), null, 2),
);
fs.writeFileSync(
  path.join(CELEBS, "index.json"),
  JSON.stringify(index.filter((e) => e.id !== id), null, 2),
);
// Remove orphaned thumbs so the dirs stay aligned with the catalog.
for (const size of [96, 192]) {
  const thumbPath = path.join(CELEBS, `thumbs/${size}/${id}.webp`);
  if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
}
const metaPath = path.join(CELEBS, "embeddings.v4.meta.json");
if (fs.existsSync(metaPath)) {
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.countBuckets = count - 1;
  meta.countCelebs = count - 1;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}
console.log(`dropped slot "${id}" (was row ${slot}); gallery now ${count - 1} buckets`);
