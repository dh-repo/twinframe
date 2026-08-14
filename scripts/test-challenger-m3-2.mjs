#!/usr/bin/env node
/**
 * scripts/test-challenger-m3-2.mjs
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — Milestone 3
 * R4: Gallery Embeddings Catalog, Quantization, & Metadata Quality Optimization
 *
 * Objectives:
 * 1. Demographic Prior Edge Cases with Corrected Metadata (Travis Scott, Penelope Cruz, Billie Eilish, Dwayne Johnson, etc.)
 * 2. Biohash Binary Parsing (embeddings.v4.biohash.bin), Bit Diversity, WASM/TS Parity, and Fallback Resilience
 * 3. Binary Catalog & Dequantization Integrity (32-byte header, FNV-1a checksum, L2 normalization, duplicate audit)
 * 4. Thumbnail SHA-256 Uniqueness (1,000 distinct hashes in thumbs/96 and thumbs/192)
 * 5. Full Pipeline & Candidate Matching Stress Tests (rankByDescriptor with extreme priors, invalid inputs, edge-case queries)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  parseV4BinaryHeader,
  l2Normalize,
  dotProduct256,
  cosineDistance256,
  distanceToMatchPercent,
  genderAffinity,
  ageAffinity,
  computeMatchConfidence,
  rankPercentsFromDistances,
} from "../src/lib/face/embeddings.ts";

import {
  rankByDescriptor,
} from "../src/lib/face/match.ts";

import {
  computeBiohash,
  screenBiohashCandidates,
  hammingDistance64BytesTS,
  popcount32,
  getProjectionMatrix,
  hashKeyToSeed,
} from "../src/lib/face/biohash.ts";

const ROOT = process.cwd();
const CELEBS_DIR = path.resolve(ROOT, "public/celebs");
const V4_Q8_BIN = path.resolve(CELEBS_DIR, "embeddings.v4.q8.bin");
const V4_BIOHASH_BIN = path.resolve(CELEBS_DIR, "embeddings.v4.biohash.bin");
const BUCKETS_JSON = path.resolve(CELEBS_DIR, "gallery.buckets.json");
const INDEX_JSON = path.resolve(CELEBS_DIR, "index.json");
const THUMBS_96_DIR = path.resolve(CELEBS_DIR, "thumbs/96");
const THUMBS_192_DIR = path.resolve(CELEBS_DIR, "thumbs/192");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function runTest(name, fn) {
  totalTests++;
  const t0 = performance.now();
  try {
    fn();
    const duration = performance.now() - t0;
    passedTests++;
    testResults.push({ name, status: "PASS", duration, error: null });
    console.log(`  ✓ [PASS] ${name} (${duration.toFixed(2)}ms)`);
  } catch (err) {
    const duration = performance.now() - t0;
    failedTests++;
    testResults.push({ name, status: "FAIL", duration, error: err });
    console.error(`  ✗ [FAIL] ${name} (${duration.toFixed(2)}ms):`, err.message);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  const t0 = performance.now();
  try {
    await fn();
    const duration = performance.now() - t0;
    passedTests++;
    testResults.push({ name, status: "PASS", duration, error: null });
    console.log(`  ✓ [PASS] ${name} (${duration.toFixed(2)}ms)`);
  } catch (err) {
    const duration = performance.now() - t0;
    failedTests++;
    testResults.push({ name, status: "FAIL", duration, error: err });
    console.error(`  ✗ [FAIL] ${name} (${duration.toFixed(2)}ms):`, err.message);
  }
}

console.log("================================================================================");
console.log("   TWINFRAME M3 EMPIRICAL CHALLENGER ADVERSARIAL STRESS TEST SUITE               ");
console.log("================================================================================\n");

// ============================================================================
// SECTION 1: Catalog Metadata Verification & Demographic Prior Edge Cases
// ============================================================================
console.log("--- SECTION 1: Catalog Metadata Verification & Demographic Prior Edge Cases ---");

const indexData = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
const bucketsData = JSON.parse(fs.readFileSync(BUCKETS_JSON, "utf8"));
const indexMap = new Map(indexData.map((e) => [e.id, e]));
const bucketMap = new Map(bucketsData.map((e) => [e.id, e]));

runTest("1.1 Catalog size and ID alignment (1,000 items in index.json and gallery.buckets.json)", () => {
  assert.equal(indexData.length, 1000, "index.json must contain exactly 1000 profiles");
  assert.equal(bucketsData.length, 1000, "gallery.buckets.json must contain exactly 1000 buckets");
  for (let i = 0; i < 1000; i++) {
    const idxEntry = indexData[i];
    const bktEntry = bucketsData[i];
    assert.equal(idxEntry.id, bktEntry.id, `Index ID ${idxEntry.id} must match bucket ID ${bktEntry.id} at index ${i}`);
    assert.equal(idxEntry.gender, bktEntry.gender, `Gender mismatch for ${idxEntry.id}: ${idxEntry.gender} vs ${bktEntry.gender}`);
    assert.equal(idxEntry.baseAge, bktEntry.age, `BaseAge mismatch for ${idxEntry.id}: ${idxEntry.baseAge} vs ${bktEntry.age}`);
  }
});

runTest("1.2 Corrected demographic ground-truth assertions (Travis Scott, Penelope Cruz, Billie Eilish, Dwayne Johnson, etc.)", () => {
  const groundTruthChecks = [
    { id: "travis-scott", expectedGender: "male", expectedAge: 33 },
    { id: "penelope-cruz", expectedGender: "female", expectedAge: 50 },
    { id: "billie-eilish", expectedGender: "female", expectedAge: 22 },
    { id: "dwayne-johnson", expectedGender: "male", expectedAge: 52 },
    { id: "andy-mikita", expectedGender: "male", expectedAge: 55 },
    { id: "jenna-ortega", expectedGender: "female", expectedAge: 21 },
    { id: "timothee-chalamet", expectedGender: "male", expectedAge: 31 },
    { id: "zendaya", expectedGender: "female", expectedAge: 27 },
    { id: "scarlett-johansson", expectedGender: "female", expectedAge: 35 },
    { id: "chris-hemsworth", expectedGender: "male", expectedAge: 47 },
    { id: "cillian-murphy", expectedGender: "male", expectedAge: 46 },
    { id: "florence-pugh", expectedGender: "female", expectedAge: 25 },
    { id: "margot-robbie", expectedGender: "female", expectedAge: 33 },
    { id: "tom-holland", expectedGender: "male", expectedAge: 28 },
  ];

  for (const check of groundTruthChecks) {
    const entry = indexMap.get(check.id);
    assert.ok(entry, `Entry for ${check.id} must exist in catalog`);
    assert.equal(entry.gender, check.expectedGender, `Gender for ${check.id} must be ${check.expectedGender} (got ${entry.gender})`);
    assert.equal(entry.baseAge, check.expectedAge, `Age for ${check.id} must be ${check.expectedAge} (got ${entry.baseAge})`);
  }
});

runTest("1.3 Adversarial Demographic Prior Inversion Stress Test", () => {
  const travis = bucketMap.get("travis-scott");
  const penelope = bucketMap.get("penelope-cruz");
  const billie = bucketMap.get("billie-eilish");
  const dwayne = bucketMap.get("dwayne-johnson");

  // Create mock celebrity embedding structures
  const dummyDesc = new Float32Array(256).fill(1 / 16); // unit L2 vector
  const makeCeleb = (bkt) => ({
    id: bkt.id,
    name: bkt.name,
    path: bkt.path,
    descriptor: dummyDesc,
    age: bkt.age,
    gender: bkt.gender,
    genderProb: bkt.genderProb,
  });

  const travisEmb = makeCeleb(travis);
  const penelopeEmb = makeCeleb(penelope);
  const billieEmb = makeCeleb(billie);
  const dwayneEmb = makeCeleb(dwayne);

  // Case A: Querying male prior matching Travis Scott
  const gAffMaleTravis = genderAffinity("male", 0.99, travisEmb);
  assert.equal(gAffMaleTravis, 1.0, "Male query matching male celebrity must have genderAffinity = 1.0");

  // Case B: Querying female prior against Travis Scott (cross-gender penalty)
  const gAffFemaleTravis = genderAffinity("female", 0.99, travisEmb);
  assert.ok(gAffFemaleTravis >= 0.75 && gAffFemaleTravis <= 0.80, `Cross-gender affinity must be bounded in [0.75, 0.80] (got ${gAffFemaleTravis})`);

  // Case C: Querying unknown gender
  const gAffUnknown = genderAffinity("unknown", 0.5, travisEmb);
  assert.equal(gAffUnknown, 1.0, "Unknown gender query must have genderAffinity = 1.0");

  // Case D: Querying female prior matching Penelope Cruz and Billie Eilish
  assert.equal(genderAffinity("female", 0.99, penelopeEmb), 1.0);
  assert.equal(genderAffinity("female", 0.99, billieEmb), 1.0);

  // Case E: Querying male prior matching Dwayne Johnson
  assert.equal(genderAffinity("male", 0.99, dwayneEmb), 1.0);

  // Case F: Age affinity edge cases
  assert.equal(ageAffinity(33, 33), 1.0, "Exact age match must yield affinity 1.0");
  const ageAffDiff10 = ageAffinity(33, 43);
  assert.ok(ageAffDiff10 > 0.80 && ageAffDiff10 < 0.95, "10-year age difference should have gentle affinity");
  const ageAffDiff40 = ageAffinity(20, 60);
  assert.ok(ageAffDiff40 > 0.10 && ageAffDiff40 < 0.20, "40-year age difference should yield smooth non-zero affinity");

  // Case G: Malformed / extreme prior values
  assert.ok(isFinite(genderAffinity("male", -1.0, travisEmb)));
  assert.ok(isFinite(genderAffinity("male", 5.0, travisEmb)));
  assert.ok(isFinite(genderAffinity("male", NaN, travisEmb)));
  assert.ok(isFinite(ageAffinity(-50, 150)));
});

// ============================================================================
// SECTION 2: Binary Catalog & Quantization Parity (embeddings.v4.q8.bin)
// ============================================================================
console.log("\n--- SECTION 2: Binary Catalog & Quantization Parity (embeddings.v4.q8.bin) ---");

const q8Buffer = fs.readFileSync(V4_Q8_BIN);
const q8ArrayBuf = q8Buffer.buffer.slice(q8Buffer.byteOffset, q8Buffer.byteOffset + q8Buffer.byteLength);
const header = parseV4BinaryHeader(q8ArrayBuf);

runTest("2.1 AccuFace v4.0 Binary Header Format & Structure", () => {
  assert.ok(header, "parseV4BinaryHeader must succeed on embeddings.v4.q8.bin");
  assert.equal(header.magic, "AFv4");
  assert.equal(header.version, 0x0400);
  assert.equal(header.vectorCount, 1000);
  assert.equal(header.dimension, 256);
  assert.equal(header.quantType, 1);
  assert.ok(header.globalScale > 0.001 && header.globalScale < 0.01, `Global scale ${header.globalScale} must be in realistic range`);
  assert.equal(header.globalOffset, 0.0);
  assert.equal(q8Buffer.byteLength, 32 + 1000 * 256, "Total file size must be 256,032 bytes");
});

runTest("2.2 FNV-1a Header Checksum Verification (Bytes 0..24)", () => {
  const headerBytes = new Uint8Array(q8ArrayBuf, 0, 24);
  let hash = 2166136261;
  for (let i = 0; i < headerBytes.length; i++) {
    hash ^= headerBytes[i];
    hash = Math.imul(hash, 16777619);
  }
  const computedChecksum = hash >>> 0;
  assert.equal(computedChecksum, header.checksum, `Header checksum must match header.checksum (${computedChecksum} vs ${header.checksum})`);
});

const dequantizedGallery = [];

runTest("2.3 Dequantization, L2-Norm, and Non-Degenerate Vector Precision", () => {
  const payload = new Uint8Array(q8ArrayBuf, 32);
  const scale = header.globalScale;
  const N = header.vectorCount;
  const D = header.dimension;

  for (let i = 0; i < N; i++) {
    const off = i * D;
    const raw = new Float32Array(D);
    let rawNormSq = 0;
    for (let j = 0; j < D; j++) {
      const u = payload[off + j];
      const val = (u - 128) * scale;
      raw[j] = val;
      rawNormSq += val * val;
    }
    assert.ok(rawNormSq > 0.05, `Vector ${i} (${bucketsData[i]?.id}) must have sufficient magnitude`);

    const normalized = l2Normalize(raw);
    let normSq = 0;
    for (let j = 0; j < D; j++) {
      assert.ok(!isNaN(normalized[j]) && isFinite(normalized[j]), `Vector ${i} dim ${j} must be finite`);
      normSq += normalized[j] * normalized[j];
    }
    const norm = Math.sqrt(normSq);
    assert.ok(Math.abs(norm - 1.0) < 1e-4, `Vector ${i} must have unit L2 norm (got ${norm})`);

    dequantizedGallery.push({
      id: bucketsData[i].id,
      name: bucketsData[i].name,
      path: bucketsData[i].path,
      descriptor: normalized,
      age: bucketsData[i].age,
      gender: bucketsData[i].gender,
      genderProb: bucketsData[i].genderProb,
    });
  }
  assert.equal(dequantizedGallery.length, 1000);
});

runTest("2.4 Mutual Distance & Identity Collision Analysis across Gallery", () => {
  const collisionPairs = [];

  for (let i = 0; i < dequantizedGallery.length; i++) {
    for (let j = i + 1; j < dequantizedGallery.length; j++) {
      const d = cosineDistance256(dequantizedGallery[i].descriptor, dequantizedGallery[j].descriptor);
      if (d < 1e-5) {
        collisionPairs.push({ idA: dequantizedGallery[i].id, idB: dequantizedGallery[j].id, dist: d });
      }
    }
  }

  // Expect at most the 1 residual catalog alias group (gwenyth-paltrow / gwyneth-paltrow)
  // All 499,499 other pairs must be completely collision-free
  assert.ok(collisionPairs.length <= 1, `Residual collisions must be at most 1 (found ${collisionPairs.length})`);
  if (collisionPairs.length === 1) {
    assert.equal(collisionPairs[0].idA, "gwenyth-paltrow");
    assert.equal(collisionPairs[0].idB, "gwyneth-paltrow");
  }
});

runTest("2.5 Thumbnail SHA-256 Uniqueness (1,000 files in thumbs/96/ and thumbs/192/)", () => {
  const files96 = fs.readdirSync(THUMBS_96_DIR).filter((f) => f.endsWith(".webp"));
  const hashes96 = new Set(files96.map((f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(THUMBS_96_DIR, f))).digest("hex")));

  const files192 = fs.readdirSync(THUMBS_192_DIR).filter((f) => f.endsWith(".webp"));
  const hashes192 = new Set(files192.map((f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(THUMBS_192_DIR, f))).digest("hex")));

  assert.equal(files96.length, 1000, "thumbs/96 must have exactly 1000 files");
  assert.equal(hashes96.size, 1000, `All 1,000 thumbs/96 files must have unique SHA-256 hashes (got ${hashes96.size})`);
  assert.equal(files192.length, 1000, "thumbs/192 must have exactly 1000 files");
  assert.equal(hashes192.size, 1000, `All 1,000 thumbs/192 files must have unique SHA-256 hashes (got ${hashes192.size})`);
});

// ============================================================================
// SECTION 3: Biohash Binary Parsing (embeddings.v4.biohash.bin) & Fallback Resilience
// ============================================================================
console.log("\n--- SECTION 3: Biohash Binary Parsing & Fallback Resilience ---");

const biohashBuffer = fs.readFileSync(V4_BIOHASH_BIN);

runTest("3.1 embeddings.v4.biohash.bin File Format & Size", () => {
  assert.equal(biohashBuffer.byteLength, 64000, "Biohash binary file must be exactly 64,000 bytes (1000 x 64 bytes)");
});

runTest("3.2 Biohash Bit Diversity & Healthy Popcount Distribution", () => {
  const popcounts = [];
  const hashSet = new Set();

  for (let i = 0; i < 1000; i++) {
    const chunk = biohashBuffer.subarray(i * 64, i * 64 + 64);
    let setBits = 0;
    for (let b = 0; b < 64; b++) {
      let byte = chunk[b];
      while (byte > 0) {
        setBits += byte & 1;
        byte >>= 1;
      }
    }
    popcounts.push(setBits);
    assert.ok(setBits >= 150 && setBits <= 362, `Biohash ${i} (${bucketsData[i]?.id}) popcount ${setBits} out of 512 is outside healthy statistical range`);

    const hex = Buffer.from(chunk).toString("hex");
    hashSet.add(hex);
  }

  const sum = popcounts.reduce((a, b) => a + b, 0);
  const meanPopcount = sum / popcounts.length;
  assert.ok(meanPopcount >= 200 && meanPopcount <= 280, `Mean popcount (${meanPopcount.toFixed(1)}) must be within [200, 280]`);
  assert.ok(hashSet.size >= 999, `At least 999 unique biohashes out of 1000 (got ${hashSet.size})`);
});

runAsyncTest("3.3 WASM Popcount vs TypeScript SWAR Popcount Parity", async () => {
  const queryVec = dequantizedGallery[0].descriptor;
  const queryBio = computeBiohash(queryVec);
  assert.equal(queryBio.hash.length, 64);

  const catalogBytes = new Uint8Array(biohashBuffer.buffer, biohashBuffer.byteOffset, biohashBuffer.byteLength);

  // Run with WASM
  const resWasm = await screenBiohashCandidates(queryBio.hash, catalogBytes, 1000, {
    maxHammingDistance: 220,
    topM: 50,
    forceTS: false,
  });

  // Run with TypeScript
  const resTS = await screenBiohashCandidates(queryBio.hash, catalogBytes, 1000, {
    maxHammingDistance: 220,
    topM: 50,
    forceTS: true,
  });

  assert.equal(resWasm.providerUsed, "wasm");
  assert.equal(resTS.providerUsed, "typescript");
  assert.equal(resWasm.candidates.length, resTS.candidates.length, "WASM and TS must return same candidate count");

  for (let i = 0; i < resWasm.candidates.length; i++) {
    const cw = resWasm.candidates[i];
    const ct = resTS.candidates[i];
    assert.equal(cw.index, ct.index, `Candidate ${i} index mismatch: ${cw.index} vs ${ct.index}`);
    assert.equal(cw.hammingDistance, ct.hammingDistance, `Candidate ${i} distance mismatch: ${cw.hammingDistance} vs ${ct.hammingDistance}`);
  }
});

runAsyncTest("3.4 Candidate Screening Fallback Resilience (Empty catalog, tight threshold, corrupt buffer)", async () => {
  const dummyQuery = new Uint8Array(64);

  // Fallback when threshold is impossibly tight (e.g. maxHammingDistance = 10 where 0 pass)
  const catalogBytes = new Uint8Array(biohashBuffer.buffer, biohashBuffer.byteOffset, biohashBuffer.byteLength);
  const tightRes = await screenBiohashCandidates(dummyQuery, catalogBytes, 1000, {
    maxHammingDistance: 10,
    minCandidates: 15,
    topM: 20,
  });
  assert.ok(tightRes.candidates.length >= 15, `Must fallback to top candidates when none pass cutoff (got ${tightRes.candidates.length})`);

  // Error handling on invalid inputs
  let threwBadLength = false;
  try {
    await screenBiohashCandidates(new Uint8Array(32), catalogBytes, 1000);
  } catch {
    threwBadLength = true;
  }
  assert.ok(threwBadLength, "Must throw on invalid query hash length (< 64 bytes)");

  let threwBadCatalog = false;
  try {
    await screenBiohashCandidates(dummyQuery, new Uint8Array(500), 1000);
  } catch {
    threwBadCatalog = true;
  }
  assert.ok(threwBadCatalog, "Must throw on catalog buffer size mismatch");
});

// ============================================================================
// SECTION 4: End-to-End Matcher Stress Tests (rankByDescriptor)
// ============================================================================
console.log("\n--- SECTION 4: End-to-End Matcher Stress Tests (rankByDescriptor) ---");

runTest("4.1 Self-Identification Matrix (First 50 Celebrities Self-Match at Rank 1)", () => {
  for (let i = 0; i < 50; i++) {
    const celeb = dequantizedGallery[i];
    const query = {
      descriptor: celeb.descriptor,
      age: celeb.age,
      gender: celeb.gender,
      genderProbability: celeb.genderProb,
    };
    const matches = rankByDescriptor(query, dequantizedGallery, 5);
    assert.ok(matches.length > 0);
    assert.equal(matches[0].celebrityId, celeb.id, `Self query for ${celeb.id} must return ${celeb.id} as Rank 1 (got ${matches[0].celebrityId})`);
    assert.ok(matches[0].distance < 0.05, `Self distance for ${celeb.id} must be < 0.05 (got ${matches[0].distance})`);
    assert.ok(matches[0].matchPercent >= 99.0, `Self match percent for ${celeb.id} must be >= 99.0% (got ${matches[0].matchPercent}%)`);
  }
});

runTest("4.2 Adversarial UserFaceQuery Inputs (Zero vector, Out-of-bounds metrics)", () => {
  // Degenerate zero vector
  const zeroQuery = {
    descriptor: new Float32Array(256),
    age: 30,
    gender: "unknown",
    genderProbability: 0.5,
  };
  const zeroMatches = rankByDescriptor(zeroQuery, dequantizedGallery, 5);
  assert.equal(zeroMatches.length, 5);
  for (const m of zeroMatches) {
    assert.ok(!isNaN(m.matchPercent) && isFinite(m.matchPercent));
    assert.ok(!isNaN(m.distance) && isFinite(m.distance));
  }

  // Extreme quality metrics
  const extremeQuery = {
    descriptor: dequantizedGallery[5].descriptor,
    age: 999,
    gender: "female",
    genderProbability: 100.0,
    detConfidence: 100.0,
    sharpness: 100.0,
    faceCoverage: 100.0,
  };
  const extremeMatches = rankByDescriptor(extremeQuery, dequantizedGallery, 5);
  assert.equal(extremeMatches.length, 5);
  for (const m of extremeMatches) {
    assert.ok(m.confidenceScore >= 10 && m.confidenceScore <= 100);
  }
});

// ============================================================================
// SUMMARY REPORT
// ============================================================================
console.log("\n================================================================================");
console.log(`   TEST EXECUTION SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log("================================================================================\n");

if (failedTests > 0) {
  process.exit(1);
}
