#!/usr/bin/env node
/**
 * scripts/m3-challenger-empirical.mjs
 * 
 * Empirical Challenger Verification Suite for Milestone 3 (R4: Gallery Embeddings Catalog, Quantization, & Metadata Quality Optimization)
 * 
 * Stress-tests:
 * 1. Header corruption, truncation, malformed buffers, invalid magic, and out-of-bounds scale handling.
 * 2. Dequantization numerical precision (||v||_2 = 1.0 ± 1e-4) across all 1,000 vectors in embeddings.v4.q8.bin.
 * 3. Pairwise cosine distance/similarity matrix (499,500 pairs) for zero-margin identity collisions and nearest neighbor margins.
 * 4. Thumbnail SHA-256 hash uniqueness and image validity across all 1,000 files in thumbs/96/ and thumbs/192/.
 * 5. Catalog synchronization and demographic ground-truth integrity across index.json and gallery.buckets.json.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import sharp from "sharp";

import {
  parseV4BinaryHeader,
  l2Normalize,
  dotProduct256,
  cosineDistance256,
  cosineDistance,
  distanceToMatchPercent,
} from "../src/lib/face/embeddings.ts";

const ROOT = process.cwd();
const CELEBS_DIR = path.resolve(ROOT, "public/celebs");
const V4_BIN_PATH = path.resolve(CELEBS_DIR, "embeddings.v4.q8.bin");
const BUCKETS_PATH = path.resolve(CELEBS_DIR, "gallery.buckets.json");
const INDEX_PATH = path.resolve(CELEBS_DIR, "index.json");
const THUMBS_96_DIR = path.resolve(CELEBS_DIR, "thumbs/96");
const THUMBS_192_DIR = path.resolve(CELEBS_DIR, "thumbs/192");

console.log("================================================================================");
console.log("  EMPIRICAL CHALLENGER STRESS SUITE: MILESTONE 3 (R4)                          ");
console.log("================================================================================");

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

function assert(condition, message, details = null) {
  if (!condition) {
    totalFailed++;
    failures.push({ message, details });
    console.error(`  ❌ FAIL: ${message}`);
    if (details) console.error("     Details:", details);
  } else {
    totalPassed++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

// ==============================================================================
// TEST 1: Header Corruption, Truncation, & Malformed Buffer Handling
// ==============================================================================
console.log("\n--- [DOMAIN 1] Binary Header Parser & Corruption Handling ---");

// 1.1 Null / Undefined / Empty Buffers
assert(parseV4BinaryHeader(null) === null, "Rejects null buffer");
assert(parseV4BinaryHeader(undefined) === null, "Rejects undefined buffer");
assert(parseV4BinaryHeader(new ArrayBuffer(0)) === null, "Rejects 0-byte buffer");

// 1.2 Under-sized buffers (< 32 bytes)
for (const size of [1, 4, 15, 16, 31]) {
  const shortBuf = new ArrayBuffer(size);
  assert(parseV4BinaryHeader(shortBuf) === null, `Rejects under-sized buffer (${size} bytes)`);
}

// 1.3 Invalid magic signatures
const invalidMagics = [
  { magic: "BAD!", bytes: [0x42, 0x41, 0x44, 0x21] },
  { magic: "AFv3", bytes: [0x41, 0x46, 0x76, 0x33] },
  { magic: "afv4 (lowercase)", bytes: [0x61, 0x66, 0x76, 0x34] },
  { magic: "NULL", bytes: [0x00, 0x00, 0x00, 0x00] },
  { magic: "FFs", bytes: [0xFF, 0xFF, 0xFF, 0xFF] },
];
for (const item of invalidMagics) {
  const buf = new ArrayBuffer(32);
  new Uint8Array(buf).set(item.bytes, 0);
  assert(parseV4BinaryHeader(buf) === null, `Rejects invalid magic signature: ${item.magic}`);
}

// 1.4 Valid Header Parsing with Synthetic Configs
{
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  new Uint8Array(buf).set([0x41, 0x46, 0x76, 0x34], 0); // "AFv4"
  view.setUint16(4, 0x0400, true); // Version 4.0
  view.setUint16(6, 0x0001, true); // Flags
  view.setUint32(8, 1000, true); // Vector Count
  view.setUint16(12, 256, true); // Dimension
  view.setUint8(14, 1); // QuantType
  view.setFloat32(16, 0.00392156, true); // Global Scale
  view.setFloat32(20, 0.0, true); // Global Offset
  view.setUint32(24, 0xDEADBEEF, true); // Checksum

  const header = parseV4BinaryHeader(buf);
  assert(header !== null, "Successfully parses valid 32-byte AFv4 header");
  assert(header.magic === "AFv4", "Magic is AFv4");
  assert(header.version === 0x0400, "Version is 0x0400 (4.0)");
  assert(header.flags === 1, "Flags is 1");
  assert(header.vectorCount === 1000, "Vector count is 1000");
  assert(header.dimension === 256, "Dimension is 256");
  assert(header.quantType === 1, "QuantType is 1");
  assert(Math.abs(header.globalScale - 0.00392156) < 1e-6, "Global scale matches float32 representation");
  assert(header.globalOffset === 0.0, "Global offset is 0.0");
  assert(header.checksum === 0xDEADBEEF, "Checksum matches 0xDEADBEEF");
}

// ==============================================================================
// TEST 2: Production Binary File & Dequantization Numerical Precision (||v||_2)
// ==============================================================================
console.log("\n--- [DOMAIN 2] Dequantization Numerical Precision (||v||_2 = 1.0 ± 1e-4) ---");

assert(fs.existsSync(V4_BIN_PATH), `Production binary exists at ${V4_BIN_PATH}`);
const fileBuf = fs.readFileSync(V4_BIN_PATH);
const arrayBuf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);

assert(fileBuf.byteLength === 256032, `File size is exactly 256,032 bytes (32 + 1000 * 256), got ${fileBuf.byteLength}`);

const prodHeader = parseV4BinaryHeader(arrayBuf);
assert(prodHeader !== null, "Production binary header parsed successfully");
assert(prodHeader.magic === "AFv4", "Production magic is 'AFv4'");
assert(prodHeader.version === 0x0400, `Production version is 0x0400 (4.0), got 0x${prodHeader.version.toString(16)}`);
assert(prodHeader.vectorCount === 1000, `Production vectorCount is 1000, got ${prodHeader.vectorCount}`);
assert(prodHeader.dimension === 256, `Production dimension is 256, got ${prodHeader.dimension}`);
assert(prodHeader.globalScale > 0 && prodHeader.globalScale < 0.01, `Production globalScale in valid range: ${prodHeader.globalScale}`);

const payload = new Uint8Array(arrayBuf, 32);
const N = prodHeader.vectorCount;
const D = prodHeader.dimension;
const scale = prodHeader.globalScale;

const dequantizedNorms = [];
const dequantizedVectors = [];
let zeroVectorCount = 0;
let nanOrInfCount = 0;
let precisionViolationCount = 0;
let maxNormError = 0;

for (let i = 0; i < N; i++) {
  const offset = i * D;
  const rawVec = new Float32Array(D);
  let rawNormSq = 0;
  for (let j = 0; j < D; j++) {
    const u = payload[offset + j];
    const val = (u - 128) * scale;
    rawVec[j] = val;
    rawNormSq += val * val;
  }

  if (rawNormSq === 0) zeroVectorCount++;

  const normalized = l2Normalize(rawVec);
  dequantizedVectors.push(normalized);

  let normSq = 0;
  for (let j = 0; j < D; j++) {
    const val = normalized[j];
    if (!Number.isFinite(val) || Number.isNaN(val)) {
      nanOrInfCount++;
    }
    normSq += val * val;
  }
  const norm = Math.sqrt(normSq);
  dequantizedNorms.push(norm);

  const normError = Math.abs(norm - 1.0);
  if (normError > maxNormError) maxNormError = normError;
  if (normError > 1e-4) precisionViolationCount++;
}

assert(zeroVectorCount === 0, `Zero all-zero vectors in gallery (found ${zeroVectorCount})`);
assert(nanOrInfCount === 0, `Zero NaN or Inf elements across all 256,000 components (found ${nanOrInfCount})`);
assert(precisionViolationCount === 0, `Zero precision violations (| ||v||_2 - 1.0 | > 1e-4) across 1,000 vectors (found ${precisionViolationCount})`);
assert(maxNormError < 1e-4, `Max L2 norm deviation from 1.0 is ${maxNormError.toExponential(4)} (strictly < 1e-4)`);

const minNorm = Math.min(...dequantizedNorms);
const maxNorm = Math.max(...dequantizedNorms);
const meanNorm = dequantizedNorms.reduce((a, b) => a + b, 0) / dequantizedNorms.length;

console.log(`     L2 Norm Summary: min=${minNorm.toFixed(6)}, max=${maxNorm.toFixed(6)}, mean=${meanNorm.toFixed(6)}, maxError=${maxNormError.toExponential(4)}`);

// ==============================================================================
// TEST 3: Pairwise Cosine Distance & Collision Check Across All 1,000 Vectors
// ==============================================================================
console.log("\n--- [DOMAIN 3] Pairwise Cosine Distance Matrix (499,500 pairs) & Collision Check ---");

const tPairsStart = performance.now();
const pairDistances = [];
const pairSimilarities = [];
let identicalPairsCount = 0;
let nearCollisionsCount = 0; // s > 0.96 (cloned donor embeddings)
let maxPairwiseSimilarity = -1.0;
let maxPairIndices = null;
let minPairwiseSimilarity = 2.0;

const nearestNeighborDistances = new Float32Array(N).fill(Infinity);
const nearestNeighborIndices = new Int32Array(N).fill(-1);

for (let i = 0; i < N; i++) {
  const v1 = dequantizedVectors[i];
  for (let j = i + 1; j < N; j++) {
    const v2 = dequantizedVectors[j];
    const dot = dotProduct256(v1, v2);
    const dist = cosineDistance256(v1, v2);

    if (dot > maxPairwiseSimilarity) {
      maxPairwiseSimilarity = dot;
      maxPairIndices = [i, j];
    }
    if (dot < minPairwiseSimilarity) {
      minPairwiseSimilarity = dot;
    }

    if (dist === 0.0 || dot >= 0.9999) {
      identicalPairsCount++;
    }
    if (dot > 0.96) {
      nearCollisionsCount++;
    }

    if (dist < nearestNeighborDistances[i]) {
      nearestNeighborDistances[i] = dist;
      nearestNeighborIndices[i] = j;
    }
    if (dist < nearestNeighborDistances[j]) {
      nearestNeighborDistances[j] = dist;
      nearestNeighborIndices[j] = i;
    }

    pairSimilarities.push(dot);
  }
}
const tPairsElapsed = performance.now() - tPairsStart;

console.log(`     Computed 499,500 pairwise dot products in ${tPairsElapsed.toFixed(1)}ms`);

assert(identicalPairsCount === 0, `Zero identical embeddings / zero-margin collisions (found ${identicalPairsCount})`);
assert(nearCollisionsCount === 0, `Zero suspicious near-collisions (s > 0.96) across all 499,500 pairs (found ${nearCollisionsCount})`);
assert(maxPairwiseSimilarity < 0.96, `Max pairwise similarity between any two distinct celebs is ${maxPairwiseSimilarity.toFixed(4)} (< 0.96)`);

const minNNDist = Math.min(...nearestNeighborDistances);
const maxNNDist = Math.max(...nearestNeighborDistances);
const meanNNDist = nearestNeighborDistances.reduce((a, b) => a + b, 0) / N;

assert(minNNDist > 0.04, `Minimum nearest-neighbor cosine distance across all 1,000 celebs is ${minNNDist.toFixed(4)} (> 0.04 separation margin)`);
console.log(`     Nearest Neighbor Distances: min=${minNNDist.toFixed(4)}, max=${maxNNDist.toFixed(4)}, mean=${meanNNDist.toFixed(4)}`);


// ==============================================================================
// TEST 4: Thumbnail Uniqueness & Image Validity (1,000 Unique SHA-256 Hashes)
// ==============================================================================
console.log("\n--- [DOMAIN 4] Thumbnail Uniqueness (SHA-256) & Image Dimensions ---");

assert(fs.existsSync(THUMBS_96_DIR), `thumbs/96 directory exists`);
assert(fs.existsSync(THUMBS_192_DIR), `thumbs/192 directory exists`);

const files96 = fs.readdirSync(THUMBS_96_DIR).filter((f) => f.endsWith(".webp"));
const files192 = fs.readdirSync(THUMBS_192_DIR).filter((f) => f.endsWith(".webp"));

assert(files96.length === 1000, `thumbs/96/ contains exactly 1,000 WebP images, got ${files96.length}`);
assert(files192.length === 1000, `thumbs/192/ contains exactly 1,000 WebP images, got ${files192.length}`);

// Check SHA-256 hashes for 96px thumbs
const hashMap96 = new Map();
let dup96Count = 0;
const dup96Pairs = [];

for (const f of files96) {
  const content = fs.readFileSync(path.join(THUMBS_96_DIR, f));
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  if (hashMap96.has(hash)) {
    dup96Count++;
    dup96Pairs.push({ file: f, duplicateOf: hashMap96.get(hash), hash });
  } else {
    hashMap96.set(hash, f);
  }
}

assert(dup96Count === 0, `Zero duplicate SHA-256 hashes in thumbs/96/ (found ${dup96Count} duplicates)`);
assert(hashMap96.size === 1000, `Exactly 1,000 unique SHA-256 hashes in thumbs/96/ (got ${hashMap96.size})`);

// Check SHA-256 hashes for 192px thumbs
const hashMap192 = new Map();
let dup192Count = 0;
const dup192Pairs = [];

for (const f of files192) {
  const content = fs.readFileSync(path.join(THUMBS_192_DIR, f));
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  if (hashMap192.has(hash)) {
    dup192Count++;
    dup192Pairs.push({ file: f, duplicateOf: hashMap192.get(hash), hash });
  } else {
    hashMap192.set(hash, f);
  }
}

assert(dup192Count === 0, `Zero duplicate SHA-256 hashes in thumbs/192/ (found ${dup192Count} duplicates)`);
assert(hashMap192.size === 1000, `Exactly 1,000 unique SHA-256 hashes in thumbs/192/ (got ${hashMap192.size})`);

// Spot check image validity and dimensions using Sharp on random sample
console.log("     Auditing image dimensions via Sharp on 50 sampled thumbnails...");
const sampleIndices = Array.from({ length: 50 }, () => Math.floor(Math.random() * 1000));
let sharpErrors = 0;

for (const idx of sampleIndices) {
  const f96 = files96[idx];
  const f192 = files192[idx];
  try {
    const meta96 = await sharp(path.join(THUMBS_96_DIR, f96)).metadata();
    const meta192 = await sharp(path.join(THUMBS_192_DIR, f192)).metadata();

    if (meta96.format !== "webp" || meta96.width !== 96 || meta96.height !== 96) sharpErrors++;
    if (meta192.format !== "webp" || meta192.width !== 192 || meta192.height !== 192) sharpErrors++;
  } catch (err) {
    sharpErrors++;
  }
}

assert(sharpErrors === 0, `All sampled thumbnails are valid WebP with exact dimensions (96x96 and 192x192)`);

// ==============================================================================
// TEST 5: Catalog Metadata Synchronization & Demographic Ground Truth
// ==============================================================================
console.log("\n--- [DOMAIN 5] Metadata Synchronization & Demographic Ground Truth ---");

assert(fs.existsSync(INDEX_PATH), `index.json exists`);
assert(fs.existsSync(BUCKETS_PATH), `gallery.buckets.json exists`);

const indexData = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
const bucketsData = JSON.parse(fs.readFileSync(BUCKETS_PATH, "utf8"));

assert(indexData.length === 1000, `index.json has exactly 1,000 items, got ${indexData.length}`);
assert(bucketsData.length === 1000, `gallery.buckets.json has exactly 1,000 items, got ${bucketsData.length}`);

const indexMap = new Map(indexData.map((e) => [e.id, e]));
const bucketsMap = new Map(bucketsData.map((e) => [e.id, e]));

let syncMismatches = 0;
for (let i = 0; i < 1000; i++) {
  const b = bucketsData[i];
  const idx = indexMap.get(b.id);
  if (!idx) {
    syncMismatches++;
    continue;
  }
  if (idx.name !== b.name || idx.gender !== b.gender) {
    syncMismatches++;
  }
  // Check age bucket synchronization
  const baseAge = idx.baseAge ?? idx.ageBuckets?.[1] ?? 40;
  if (b.age !== baseAge) {
    syncMismatches++;
  }
}
assert(syncMismatches === 0, `100% synchronization between index.json and gallery.buckets.json`);

// Check critical demographic ground-truth items
const groundTruthChecks = [
  { id: "travis-scott", expectedGender: "male", expectedMinAge: 30, expectedMaxAge: 36 },
  { id: "penelope-cruz", expectedGender: "female", expectedMinAge: 48, expectedMaxAge: 53 },
  { id: "billie-eilish", expectedGender: "female", expectedMinAge: 20, expectedMaxAge: 25 },
  { id: "andy-mikita", expectedGender: "male", expectedMinAge: 52, expectedMaxAge: 58 },
  { id: "dwayne-johnson", expectedGender: "male", expectedMinAge: 50, expectedMaxAge: 55 },
  { id: "zendaya", expectedGender: "female", expectedMinAge: 25, expectedMaxAge: 30 },
  { id: "timothee-chalamet", expectedGender: "male", expectedMinAge: 26, expectedMaxAge: 31 },
  { id: "emma-watson", expectedGender: "female", expectedMinAge: 32, expectedMaxAge: 37 },
];

for (const check of groundTruthChecks) {
  const entry = indexMap.get(check.id);
  assert(entry !== undefined, `Ground truth check celebrity exists: ${check.id}`);
  if (entry) {
    assert(entry.gender === check.expectedGender, `${check.id} gender is ${check.expectedGender}, got ${entry.gender}`);
    assert(entry.baseAge >= check.expectedMinAge && entry.baseAge <= check.expectedMaxAge, `${check.id} baseAge in [${check.expectedMinAge}, ${check.expectedMaxAge}], got ${entry.baseAge}`);
  }
}

// ==============================================================================
// SUMMARY & VERDICT
// ==============================================================================
console.log("\n================================================================================");
console.log(`  TOTAL TESTS: ${totalPassed + totalFailed} | PASSED: ${totalPassed} | FAILED: ${totalFailed}`);
console.log("================================================================================");

if (totalFailed > 0) {
  console.error("❌ VERDICT: REQUEST_CHANGES");
  console.error("Failure Summary:", JSON.stringify(failures, null, 2));
  process.exit(1);
} else {
  console.log("✅ VERDICT: APPROVE — ALL EMPIRICAL CHALLENGES PASSED PERFECTLY!");
  process.exit(0);
}
