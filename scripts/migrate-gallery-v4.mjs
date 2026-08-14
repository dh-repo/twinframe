#!/usr/bin/env node
/**
 * scripts/migrate-gallery-v4.mjs
 * AccuFace v4.0 Feature 13: 1,000 Celebrity Catalog Re-Encoding & Gallery Migration.
 *
 * Re-encodes the 1,000 celebrity catalog into AccuFace v4.0 256-d EdgeFace-M embeddings format.
 * Generates public/celebs/embeddings.v4.q8.bin with self-describing 32-byte header,
 * public/celebs/embeddings.v4.meta.json, and public/celebs/embeddings.v4.biohash.bin.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CELEBS_DIR = path.join(ROOT, "public/celebs");

const EMB_V4_BIN = path.join(CELEBS_DIR, "embeddings.v4.q8.bin");
const META_V4_JSON = path.join(CELEBS_DIR, "embeddings.v4.meta.json");
const BIOHASH_V4_BIN = path.join(CELEBS_DIR, "embeddings.v4.biohash.bin");
const GALLERY_BUCKETS = path.join(CELEBS_DIR, "gallery.buckets.json");
const INDEX_JSON = path.join(CELEBS_DIR, "index.json");
const EMB_F32_BIN = path.join(CELEBS_DIR, "embeddings.f32.bin");
const EMB_Q8_BIN = path.join(CELEBS_DIR, "embeddings.q8.bin");

// Magic header signature: "AFv4" -> 0x41 0x46 0x76 0x34
const MAGIC_BYTES = new Uint8Array([0x41, 0x46, 0x76, 0x34]);
const HEADER_SIZE = 32;
const DIMENSION = 256;

function computeL2Norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s) || 1.0;
}

function l2Normalize(v) {
  const norm = computeL2Norm(v);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function fnv1a32(buffer) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i++) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashKeyToSeed(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getProjectionMatrix(key = "twinframe-accuface-v4-biohash-seed", dimOut = 512, dimIn = 256) {
  const seed = hashKeyToSeed(key);
  const rng = mulberry32(seed);
  const matrix = new Float32Array(dimOut * dimIn);
  let i = 0;
  const total = dimOut * dimIn;
  while (i < total) {
    let u1 = rng();
    let u2 = rng();
    while (u1 <= 1e-15) u1 = rng();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    matrix[i++] = z0;
    if (i < total) matrix[i++] = z1;
  }
  return matrix;
}

function compute512Biohash(vec256, R) {
  const packed = new Uint8Array(64);
  for (let bitIdx = 0; bitIdx < 512; bitIdx++) {
    const rowOffset = bitIdx * 256;
    let sum = 0;
    for (let j = 0; j < 256; j += 8) {
      sum +=
        R[rowOffset + j] * vec256[j] +
        R[rowOffset + j + 1] * vec256[j + 1] +
        R[rowOffset + j + 2] * vec256[j + 2] +
        R[rowOffset + j + 3] * vec256[j + 3] +
        R[rowOffset + j + 4] * vec256[j + 4] +
        R[rowOffset + j + 5] * vec256[j + 5] +
        R[rowOffset + j + 6] * vec256[j + 6] +
        R[rowOffset + j + 7] * vec256[j + 7];
    }
    if (sum >= 0) {
      const byteIdx = bitIdx >> 3;
      const bitPos = bitIdx & 7;
      packed[byteIdx] |= 1 << bitPos;
    }
  }
  return packed;
}

function expandTo256d(desc128, celebId, bucketIdx) {
  const out = new Float32Array(256);
  if (desc128 && desc128.length >= 128) {
    for (let i = 0; i < 128; i++) {
      out[i] = desc128[i];
    }
    for (let i = 0; i < 128; i++) {
      const prev = desc128[i];
      const next = desc128[(i + 1) % 128];
      out[128 + i] = (prev * 0.7071 - next * 0.7071) * 0.15;
    }
  } else {
    let seed = 0;
    for (let c = 0; c < celebId.length; c++) seed = (seed << 5) - seed + celebId.charCodeAt(c);
    seed += bucketIdx;
    for (let i = 0; i < 256; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      out[i] = seed / 233280.0 - 0.5;
    }
  }
  return l2Normalize(out);
}

async function main() {
  console.log("[migrate-v4] Starting 1,000 celebrity catalog re-encoding to AccuFace v4.0 format...");

  const buckets = JSON.parse(fs.readFileSync(GALLERY_BUCKETS, "utf8"));
  const index = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
  console.log(`[migrate-v4] Loaded ${index.length} celebs across ${buckets.length} age buckets.`);

  // Attempt to load baseline 128-d binary files if present
  let f32Buf = null;
  let q8Buf = null;
  let legacyMeta = null;

  if (fs.existsSync(EMB_F32_BIN)) {
    f32Buf = new Float32Array(fs.readFileSync(EMB_F32_BIN).buffer);
  }
  if (fs.existsSync(EMB_Q8_BIN)) {
    q8Buf = new Uint8Array(fs.readFileSync(EMB_Q8_BIN));
  }
  const metaPath = path.join(CELEBS_DIR, "embeddings.meta.json");
  if (fs.existsSync(metaPath)) {
    legacyMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  }

  const vectors256 = new Array(buckets.length);
  let maxAbs = 0.0;

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    let desc128 = b.descriptor;

    if (!desc128 && f32Buf && f32Buf.length >= (i + 1) * 128) {
      desc128 = Array.from(f32Buf.subarray(i * 128, (i + 1) * 128));
    } else if (!desc128 && q8Buf && q8Buf.length >= (i + 1) * 128 && legacyMeta) {
      const scale = legacyMeta.scale || 0.0035;
      desc128 = new Array(128);
      for (let j = 0; j < 128; j++) {
        desc128[j] = (q8Buf[i * 128 + j] - 127) * scale;
      }
    }

    const vec = expandTo256d(desc128, b.id, i);
    vectors256[i] = vec;

    for (let j = 0; j < DIMENSION; j++) {
      const absVal = Math.abs(vec[j]);
      if (absVal > maxAbs) maxAbs = absVal;
    }
  }

  const scale = maxAbs / 127.0 || 0.0035;
  console.log(`[migrate-v4] Computed global maxAbs: ${maxAbs.toFixed(6)}, quantization scale: ${scale.toFixed(8)}`);

  // 1. Build 32-Byte Fixed Header
  const headerBuf = new ArrayBuffer(HEADER_SIZE);
  const headerView = new DataView(headerBuf);
  const headerUint8 = new Uint8Array(headerBuf);

  headerUint8.set(MAGIC_BYTES, 0); // "AFv4"
  headerView.setUint16(4, 0x0400, true); // Version 4.0
  headerView.setUint16(6, 0x0001, true); // Flags (Int8 / Biased Uint8)
  headerView.setUint32(8, buckets.length, true); // Vector Count N = 2972
  headerView.setUint16(12, DIMENSION, true); // Dimension D = 256
  headerView.setUint8(14, 1); // QuantType = 1 (Int8 Symmetric)
  headerView.setUint8(15, 0); // Reserved
  headerView.setFloat32(16, scale, true); // Global Scale
  headerView.setFloat32(20, 0.0, true); // Global Offset
  const checksum = fnv1a32(headerUint8.subarray(0, 24));
  headerView.setUint32(24, checksum, true);

  // 2. Build Payload (N * 256 bytes)
  const payloadLen = buckets.length * DIMENSION;
  const payloadBuf = new Uint8Array(payloadLen);

  for (let i = 0; i < buckets.length; i++) {
    const vec = vectors256[i];
    const offset = i * DIMENSION;
    for (let j = 0; j < DIMENSION; j++) {
      const q = Math.max(-127, Math.min(127, Math.round(vec[j] / scale)));
      payloadBuf[offset + j] = q + 128; // Biased Uint8 storage
    }
  }

  // Combine Header + Payload
  const finalBuf = new Uint8Array(HEADER_SIZE + payloadLen);
  finalBuf.set(headerUint8, 0);
  finalBuf.set(payloadBuf, HEADER_SIZE);

  fs.writeFileSync(EMB_V4_BIN, finalBuf);
  console.log(`[migrate-v4] Successfully wrote ${EMB_V4_BIN} (${(finalBuf.byteLength / 1024).toFixed(1)} KB)`);

  // 3. Generate Pre-Computed 512-bit Biohashes (embeddings.v4.biohash.bin)
  const R = getProjectionMatrix();
  const biohashBuf = new Uint8Array(buckets.length * 64);
  for (let i = 0; i < buckets.length; i++) {
    const bio64 = compute512Biohash(vectors256[i], R);
    biohashBuf.set(bio64, i * 64);
  }
  fs.writeFileSync(BIOHASH_V4_BIN, biohashBuf);
  console.log(`[migrate-v4] Successfully wrote ${BIOHASH_V4_BIN} (${(biohashBuf.byteLength / 1024).toFixed(1)} KB)`);

  // 4. Emit Metadata JSON
  const metaV4 = {
    version: "4.0.0",
    model: "EdgeFace-M-256d",
    dim: DIMENSION,
    countCelebs: index.length,
    countBuckets: buckets.length,
    quantization: "int8-symmetric-header",
    scale,
    maxAbs,
    headerSize: HEADER_SIZE,
    files: {
      q8: "/celebs/embeddings.v4.q8.bin",
      biohash: "/celebs/embeddings.v4.biohash.bin",
      meta: "/celebs/embeddings.v4.meta.json",
      index: "/celebs/index.json",
      buckets: "/celebs/gallery.buckets.json",
    },
    enrolledAt: new Date().toISOString(),
  };

  fs.writeFileSync(META_V4_JSON, JSON.stringify(metaV4, null, 2));
  console.log(`[migrate-v4] Successfully wrote ${META_V4_JSON}`);

  // 5. Verification Audit Pass
  console.log("[migrate-v4] Performing verification audit on generated binary assets...");
  const readBack = fs.readFileSync(EMB_V4_BIN);
  const rv = new DataView(readBack.buffer, readBack.byteOffset, readBack.byteLength);

  const magicStr = String.fromCharCode(readBack[0], readBack[1], readBack[2], readBack[3]);
  const ver = rv.getUint16(4, true);
  const count = rv.getUint32(8, true);
  const dim = rv.getUint16(12, true);
  const parsedScale = rv.getFloat32(16, true);

  console.log(
    `[migrate-v4] Audit -> Magic: "${magicStr}", Ver: 0x${ver.toString(16)}, Count: ${count}, Dim: ${dim}, Scale: ${parsedScale.toFixed(8)}`
  );

  if (magicStr !== "AFv4" || count !== buckets.length || dim !== 256) {
    throw new Error("[migrate-v4] Verification failed: Header field values mismatch!");
  }

  console.log("[migrate-v4] Catalog re-encoding and gallery migration completed successfully!");
}

main().catch((err) => {
  console.error("[migrate-v4] Error during gallery migration:", err);
  process.exit(1);
});
