import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  parseV4BinaryHeader,
  l2Normalize,
  dotProduct256,
  cosineDistance256,
  cosineDistance,
  distanceToMatchPercent,
} from "./embeddings.ts";

describe("Feature 13: 1,000 Celebrity Catalog Re-Encoding & Gallery Migration", () => {
  test("1. parseV4BinaryHeader Header Parsing", () => {
    // Construct valid 32-byte header buffer
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    const uint8 = new Uint8Array(buf);

    // "AFv4" -> 0x41, 0x46, 0x76, 0x34
    uint8.set([0x41, 0x46, 0x76, 0x34], 0);
    view.setUint16(4, 0x0400, true); // Version 4.0
    view.setUint16(6, 0x0001, true); // Flags
    view.setUint32(8, 2972, true); // Vector Count
    view.setUint16(12, 256, true); // Dimension
    view.setUint8(14, 1); // QuantType
    view.setFloat32(16, 0.0035, true); // Global Scale
    view.setFloat32(20, 0.0, true); // Offset
    view.setUint32(24, 0x12345678, true); // Checksum

    const header = parseV4BinaryHeader(buf);

    assert.ok(header, "Header parser must return valid V4BinaryHeader object");
    assert.equal(header.magic, "AFv4");
    assert.equal(header.version, 0x0400);
    assert.equal(header.vectorCount, 2972);
    assert.equal(header.dimension, 256);
    assert.equal(header.quantType, 1);
    assert.ok(Math.abs(header.globalScale - 0.0035) < 1e-6);
  });

  test("2. parseV4BinaryHeader Invalid Buffer Handling", () => {
    // Short buffer (< 32 bytes)
    assert.equal(parseV4BinaryHeader(new ArrayBuffer(16)), null);

    // Bad magic bytes
    const buf = new ArrayBuffer(32);
    new Uint8Array(buf).set([0x42, 0x41, 0x44, 0x21], 0); // "BAD!"
    assert.equal(parseV4BinaryHeader(buf), null);
  });

  test("3. Real Production embeddings.v4.q8.bin Header Audit", () => {
    const binPath = path.resolve(process.cwd(), "public/celebs/embeddings.v4.q8.bin");
    assert.ok(fs.existsSync(binPath), "public/celebs/embeddings.v4.q8.bin must exist on disk");

    const fileBuf = fs.readFileSync(binPath);
    const arrayBuf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);

    const header = parseV4BinaryHeader(arrayBuf);
    assert.ok(header, "Production binary file header must be valid");
    assert.equal(header.magic, "AFv4");
    assert.equal(header.dimension, 512);
    // Count is whatever the catalog holds (slots get dropped for identity
    // collisions); the invariants that matter are internal consistency.
    assert.ok(header.vectorCount >= 900 && header.vectorCount <= 1100, `implausible count ${header.vectorCount}`);
    assert.ok(header.globalScale > 0 && header.globalScale < 0.01);
    // The checksum field is advisory: nothing in the load path validates it and
    // surgery scripts (drop-gallery-slot, patch-gallery-slot) do not recompute it.
    // Pin that contract so a future "validation" change cannot silently corrupt
    // patched galleries.
    assert.equal(header.checksum, 0, "checksum must stay 0 (advisory) or all writers must recompute it");
    assert.equal(
      fileBuf.byteLength,
      32 + header.vectorCount * 512,
      "File byte size must equal header (32) + vectorCount * dim",
    );
  });

  test("4. Vector Math & Hill Curve Calibration Precision", () => {
    const v1 = l2Normalize(new Float32Array(256).fill(1));
    const v2 = l2Normalize(new Float32Array(256).fill(1));
    const v3 = l2Normalize(new Float32Array(256).map((_, i) => (i % 2 === 0 ? 1 : -1)));

    assert.ok(Math.abs(dotProduct256(v1, v2) - 1.0) < 1e-5);
    assert.ok(Math.abs(cosineDistance256(v1, v2) - 0.0) < 1e-5);
    assert.ok(Math.abs(cosineDistance256(v1, v3) - 1.0) < 1e-4);

    // Hill: P(0) = 100%, P(HILL_D0=0.6) = 50%
    assert.equal(distanceToMatchPercent(0.0), 100.0);
    assert.equal(distanceToMatchPercent(0.6), 50.0);
  });

  test("4b. cosineDistance pins min-length-prefix semantics for mismatched dims", () => {
    // PINNED FOOTGUN: for vectors of different length, cosineDistance compares only the
    // first min(len) coordinates and returns a plausible [0,2] value instead of throwing.
    // Cross-embedding-space comparison (e.g. a 128-d probe vs a 512-d gallery) is
    // mathematically meaningless, which is why scripts/evaluate-held-out-v2.ts enforces
    // probe dim == gallery header dim before ranking anything.
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 0]);
    const d = cosineDistance(a, b);
    assert.ok(Math.abs(d - 0) < 1e-6, `identical prefixes must give distance 0, got ${d}`);

    const c = new Float32Array([-1, 0]);
    const dOpp = cosineDistance(a, c);
    assert.ok(Math.abs(dOpp - 2) < 1e-6, `opposite prefixes must give distance 2, got ${dOpp}`);
  });

  test("5. Catalog Synchronization Audit across Binary and JSON", () => {
    const binPath = path.resolve(process.cwd(), "public/celebs/embeddings.v4.q8.bin");
    const bucketsPath = path.resolve(process.cwd(), "public/celebs/gallery.buckets.json");
    const indexPath = path.resolve(process.cwd(), "public/celebs/index.json");

    const fileBuf = fs.readFileSync(binPath);
    const arrayBuf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
    const header = parseV4BinaryHeader(arrayBuf);
    const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf8"));
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

    assert.ok(header);
    assert.equal(buckets.length, index.length, "buckets and index must cover the same ids");
    assert.equal(new Set(buckets.map((b: { id: string }) => b.id)).size, buckets.length, "bucket ids must be unique");
    assert.equal(header.vectorCount, buckets.length, "Binary vector count must exactly match gallery buckets");
  });

  test("6. Zero Duplicate Thumbnails Audit (1,000 Unique SHA-256 Hashes)", () => {
    const thumbs96Dir = path.resolve(process.cwd(), "public/celebs/thumbs/96");
    const thumbs192Dir = path.resolve(process.cwd(), "public/celebs/thumbs/192");

    const files96 = fs.readdirSync(thumbs96Dir).filter((f) => f.endsWith(".webp"));
    const hashes96 = new Set(files96.map((f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(thumbs96Dir, f))).digest("hex")));

    const files192 = fs.readdirSync(thumbs192Dir).filter((f) => f.endsWith(".webp"));
    const hashes192 = new Set(files192.map((f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(thumbs192Dir, f))).digest("hex")));

    // Thumbs must track the catalog exactly — one per bucket id, no orphans,
    // no duplicates (counts follow the catalog rather than a frozen number).
    const bucketIds = new Set(
      (JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/celebs/gallery.buckets.json"), "utf8")) as Array<{ id: string }>).map((b) => b.id),
    );
    const ids96 = new Set(files96.map((f) => f.replace(/\.webp$/, "")));
    const ids192 = new Set(files192.map((f) => f.replace(/\.webp$/, "")));
    assert.deepEqual(ids96, bucketIds, "thumbs/96 must map 1:1 onto gallery buckets");
    assert.deepEqual(ids192, bucketIds, "thumbs/192 must map 1:1 onto gallery buckets");
    assert.equal(hashes96.size, files96.length, "All thumbs/96/ images must have distinct SHA-256 hashes");
    assert.equal(hashes192.size, files192.length, "All thumbs/192/ images must have distinct SHA-256 hashes");
  });

  test("7. Demographic Ground-Truth Quality Audit", () => {
    const indexPath = path.resolve(process.cwd(), "public/celebs/index.json");
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const map = new Map(index.map((e: { id: string }) => [e.id, e]));

    // Check key ground-truth demographics
    const travis = map.get("travis-scott") as { gender: string; baseAge: number };
    assert.ok(travis);
    assert.equal(travis.gender, "male");
    assert.equal(travis.baseAge, 33);

    const penelope = map.get("penelope-cruz") as { gender: string; baseAge: number };
    assert.ok(penelope);
    assert.equal(penelope.gender, "female");
    assert.equal(penelope.baseAge, 50);

    const billie = map.get("billie-eilish") as { gender: string; baseAge: number };
    assert.ok(billie);
    assert.equal(billie.gender, "female");
    assert.equal(billie.baseAge, 22);

    const andy = map.get("andy-mikita") as { gender: string; baseAge: number };
    assert.ok(andy);
    assert.equal(andy.gender, "male");
    assert.equal(andy.baseAge, 55);

    const dwayne = map.get("dwayne-johnson") as { gender: string; baseAge: number };
    assert.ok(dwayne);
    assert.equal(dwayne.gender, "male");
    assert.equal(dwayne.baseAge, 52);

    const zendaya = map.get("zendaya") as { gender: string; baseAge: number };
    assert.ok(zendaya);
    assert.equal(zendaya.gender, "female");
    assert.equal(zendaya.baseAge, 27);
  });

  test("8. Binary Dequantization & L2-Normalization Precision", () => {
    const binPath = path.resolve(process.cwd(), "public/celebs/embeddings.v4.q8.bin");
    const fileBuf = fs.readFileSync(binPath);
    const arrayBuf = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
    const header = parseV4BinaryHeader(arrayBuf);
    assert.ok(header);

    const dataView = new Uint8Array(arrayBuf, 32);
    const scale = header.globalScale;
    const N = header.vectorCount;
    const D = header.dimension;

    for (let i = 0; i < N; i++) {
      const offset = i * D;
      const vec = new Float32Array(D);
      let normSq = 0;
      for (let j = 0; j < D; j++) {
        const u = dataView[offset + j];
        const val = (u - 128) * scale;
        vec[j] = val;
        normSq += val * val;
      }
      assert.ok(normSq > 0, `Vector ${i} must not be zero vector`);
      const normalized = l2Normalize(vec);
      let l2Norm = 0;
      for (let j = 0; j < D; j++) {
        assert.ok(!isNaN(normalized[j]) && isFinite(normalized[j]));
        l2Norm += normalized[j] * normalized[j];
      }
      assert.ok(Math.abs(Math.sqrt(l2Norm) - 1.0) < 1e-4, `Vector ${i} must be L2 normalized to 1.0`);
    }
  });

  test("9. Recalibrated Hill Curve Monotonicity, Boundaries, & Empirical Distance Mapping", () => {
    // 1. Exact Hill curve calibration check (d0=0.60, n=4.1 — EdgeFace-512)
    assert.equal(distanceToMatchPercent(0.0), 100.0);
    assert.equal(distanceToMatchPercent(0.30), 94.5);
    assert.equal(distanceToMatchPercent(0.45), 76.5);
    assert.equal(distanceToMatchPercent(0.6), 50.0);
    assert.equal(distanceToMatchPercent(0.85), 19.3);
    assert.equal(distanceToMatchPercent(1.2), 5.5);

    // 2. High match percent for genuine same-person distances (EdgeFace-512 unseen photo p50 ≈ 0.37)
    const pTop = distanceToMatchPercent(0.37);
    assert.ok(pTop >= 80.0 && pTop <= 95.0, `Expected genuine self in 80-95%, got ${pTop}%`);

    // 3. Low match percent for random background faces (EdgeFace random impostor ≈ 0.9+)
    const pBackground = distanceToMatchPercent(0.9);
    assert.ok(pBackground < 20.0, `Expected background match < 20%, got ${pBackground}%`);

    // 4. Strict monotonic decrease
    let prev = distanceToMatchPercent(0);
    for (let d = 0.01; d <= 2.0; d += 0.01) {
      const curr = distanceToMatchPercent(d);
      assert.ok(curr <= prev, `Monotonicity violation at d=${d}: p(${d - 0.01})=${prev} < p(${d})=${curr}`);
      prev = curr;
    }

    // 5. Robustness against negative, infinite, NaN inputs
    assert.equal(distanceToMatchPercent(-0.5), 100.0);
    assert.equal(distanceToMatchPercent(Infinity), 0.0);
    assert.equal(distanceToMatchPercent(NaN), 0.0);
  });

  test("10. Cosine Metric Invariance & Precision under L2 Normalization", () => {
    const rawA = new Float32Array(256);
    const rawB = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      rawA[i] = Math.sin(i * 0.1) * 5.0; // unnormalized scale 5
      rawB[i] = Math.sin(i * 0.1) * 12.0; // unnormalized scale 12 (same direction)
    }

    const normA = l2Normalize(rawA);
    const normB = l2Normalize(rawB);

    assert.ok(Math.abs(cosineDistance256(normA, normB) - 0.0) < 1e-5);
    assert.equal(distanceToMatchPercent(cosineDistance256(normA, normB)), 100.0);
  });
});
