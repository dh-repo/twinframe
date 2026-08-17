#!/usr/bin/env node
/**
 * Write the AccuFace v5 binary gallery from /tmp/twinframe-enroll:
 *  - public/celebs/embeddings.v4.q8.bin  (AFv4 header, 512-d uint8-biased)
 *  - public/celebs/embeddings.v4.meta.json (version 5.0.0)
 *  - public/celebs/extra-templates.json (real EdgeFace 512-d multi-shot views)
 *
 * Usage: node scripts/write-gallery-v4.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CELEBS = path.join(ROOT, "public/celebs");
const DIM = 512;

const rows = JSON.parse(fs.readFileSync("/tmp/twinframe-enroll/embeddings.json", "utf8"));
const extras = JSON.parse(fs.readFileSync("/tmp/twinframe-enroll/extras.json", "utf8"));
const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));

const byId = new Map(rows.map((r) => [r.id, r]));
const missing = buckets.filter((b) => !byId.has(b.id));
if (missing.length > 0) {
  throw new Error(`missing enrollments for ${missing.length} ids: ${missing.slice(0, 5).map((b) => b.id).join(", ")}`);
}

// Global symmetric quantization scale across all vectors
let maxAbs = 0;
for (const r of rows) {
  for (const v of r.d512) maxAbs = Math.max(maxAbs, Math.abs(v));
}
const scale = maxAbs / 127;

const header = Buffer.alloc(32);
header.write("AFv4", 0, "ascii");
header.writeUint16LE(4, 4); // version
header.writeUint16LE(0, 6); // flags
header.writeUint32LE(buckets.length, 8);
header.writeUint16LE(DIM, 12);
header.writeUint16LE(1, 14); // quantType: uint8-biased
header.writeFloatLE(scale, 16);
header.writeFloatLE(0, 20); // globalOffset
header.writeUint32LE(0, 24); // checksum (unused by loader)
header.writeUint32LE(0, 28);

const payload = Buffer.alloc(buckets.length * DIM);
for (let i = 0; i < buckets.length; i++) {
  const r = byId.get(buckets[i].id);
  for (let j = 0; j < DIM; j++) {
    const q = Math.max(-127, Math.min(127, Math.round(r.d512[j] / scale)));
    payload[i * DIM + j] = q + 128;
  }
}

fs.writeFileSync(path.join(CELEBS, "embeddings.v4.q8.bin"), Buffer.concat([header, payload]));

const meta = {
  version: "5.0.0",
  model: "EdgeFace-S-gamma05-512d",
  dim: DIM,
  countCelebs: buckets.length,
  countBuckets: buckets.length,
  quantization: "int8-symmetric-header",
  scale,
  maxAbs,
  headerSize: 32,
  detector: "SCRFD-2.5G-bnkps",
  files: {
    q8: "/celebs/embeddings.v4.q8.bin",
    biohash: "/celebs/embeddings.v4.biohash.bin",
    meta: "/celebs/embeddings.v4.meta.json",
    index: "/celebs/index.json",
    buckets: "/celebs/gallery.buckets.json",
  },
  enrolledAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(CELEBS, "embeddings.v4.meta.json"), JSON.stringify(meta, null, 2));

const templateFile = {
  version: "2.0.0",
  model: meta.model,
  dim: DIM,
  templates: extras.map((e) => ({
    id: e.id,
    source: e.source,
    descriptor: e.d512.map((v) => Math.round(v * 100000) / 100000),
  })),
};
fs.writeFileSync(path.join(CELEBS, "extra-templates.json"), JSON.stringify(templateFile));

console.log(
  `wrote bin (${32 + payload.length} bytes, ${buckets.length}x${DIM}), meta v${meta.version}, extras=${extras.length}`,
);
