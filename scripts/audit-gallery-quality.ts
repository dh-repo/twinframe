#!/usr/bin/env tsx
/**
 * Phase 0/1 — Gallery quality audit for Twinframe FaceNet-128 gallery.
 *
 * Reports:
 *  - unique descriptors vs bucket count
 *  - same-id clone rate (pre-collapse)
 *  - cross-id exact collision groups
 *  - near-collision pairs (ensemble dist < threshold)
 *  - suspiciously small-norm / near-zero vectors
 *  - recommended exclusions for re-encode / loader
 *
 * Usage:
 *   npx tsx scripts/audit-gallery-quality.ts
 *   npx tsx scripts/audit-gallery-quality.ts --json public/celebs/gallery-audit.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadGalleryDataNode,
  getPreCollapseGalleryStats,
  getCanonicalCelebId,
} from "./evaluate-match-accuracy.ts";
import { ensembleDistance } from "../src/lib/face/embeddings.ts";
import { collapseSameIdDescriptorClones } from "../src/lib/face/gallery-dedupe.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function fingerprint(d: ArrayLike<number>): string {
  let a = 0;
  let b = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i] ?? 0;
    a = (a + v * (i + 1)) % 1e9;
    b = (b + v * (i + 1) * (i + 3)) % 1e9;
  }
  return `${a.toFixed(6)}:${b.toFixed(6)}`;
}

function l2(d: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += (d[i] ?? 0) * (d[i] ?? 0);
  return Math.sqrt(s);
}

function main() {
  const jsonOutIdx = process.argv.indexOf("--json");
  const jsonOut =
    jsonOutIdx >= 0
      ? process.argv[jsonOutIdx + 1] || path.join(CELEBS, "gallery-audit.json")
      : path.join(CELEBS, "gallery-audit.json");

  // Force fresh load
  const gallery = loadGalleryDataNode(ROOT);
  const pre = getPreCollapseGalleryStats();

  // Re-load raw buckets from disk for pre-collapse analysis
  const meta = JSON.parse(fs.readFileSync(path.join(CELEBS, "embeddings.meta.json"), "utf8"));
  const buckets = JSON.parse(
    fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"),
  ) as Array<{
    id: string;
    name: string;
    age: number;
    gender: string;
  }>;
  const q8Path = path.join(CELEBS, "embeddings.q8.bin");
  const dim = meta.dim || 128;
  const scale = meta.scale || 0.00293;
  const q8 = fs.readFileSync(q8Path);
  const u8 = new Uint8Array(q8.buffer, q8.byteOffset, q8.byteLength);

  type Row = {
    id: string;
    name: string;
    age: number;
    gender: string;
    desc: Float32Array;
    fp: string;
    norm: number;
  };

  const raw: Row[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const off = i * dim;
    const desc = new Float32Array(dim);
    let sum = 0;
    for (let j = 0; j < dim; j++) {
      const q = (u8[off + j] ?? 127) - 127;
      const v = q * scale;
      desc[j] = v;
      sum += v * v;
    }
    const n = Math.sqrt(sum) || 1;
    for (let j = 0; j < dim; j++) desc[j]! /= n;
    raw.push({
      id: b.id,
      name: b.name,
      age: b.age,
      gender: b.gender,
      desc,
      fp: fingerprint(desc),
      norm: l2(desc),
    });
  }

  // Fingerprint groups
  const byFp = new Map<string, Row[]>();
  for (const r of raw) {
    const list = byFp.get(r.fp) ?? [];
    list.push(r);
    byFp.set(r.fp, list);
  }

  const multiIdGroups: Array<{ ids: string[]; names: string[]; count: number }> = [];
  const multiBucketSameId = [...byFp.values()].filter(
    (g) => g.length > 1 && new Set(g.map((x) => x.id)).size === 1,
  ).length;

  for (const g of byFp.values()) {
    const ids = [...new Set(g.map((x) => getCanonicalCelebId(x.id)))];
    if (ids.length > 1) {
      multiIdGroups.push({
        ids,
        names: [...new Set(g.map((x) => x.name))],
        count: g.length,
      });
    }
  }
  multiIdGroups.sort((a, b) => b.count - a.count);

  // Near-collisions across ids (sample brute-force on unique per id after collapse)
  const collapsed = collapseSameIdDescriptorClones(
    raw.map((r) => ({
      id: r.id,
      name: r.name,
      path: "",
      descriptor: Array.from(r.desc),
      age: r.age,
      gender: r.gender as "male" | "female",
      genderProb: 0.9,
    })),
  );

  const NEAR = 0.12;
  const nearPairs: Array<{ a: string; b: string; dist: number }> = [];
  for (let i = 0; i < collapsed.length; i++) {
    for (let j = i + 1; j < collapsed.length; j++) {
      const ca = collapsed[i]!;
      const cb = collapsed[j]!;
      if (getCanonicalCelebId(ca.id) === getCanonicalCelebId(cb.id)) continue;
      const d = ensembleDistance(ca.descriptor, cb.descriptor);
      if (d < NEAR) {
        nearPairs.push({ a: ca.id, b: cb.id, dist: d });
      }
    }
  }
  nearPairs.sort((x, y) => x.dist - y.dist);

  // Suspect low-variance / weird vectors (possible noise fallbacks)
  const suspects: Array<{ id: string; name: string; reason: string }> = [];
  for (const r of collapsed) {
    const d = r.descriptor;
    let maxAbs = 0;
    let mean = 0;
    for (let i = 0; i < d.length; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(d[i] ?? 0));
      mean += d[i] ?? 0;
    }
    mean /= d.length;
    if (maxAbs < 0.05) {
      suspects.push({ id: r.id, name: r.name, reason: `tiny maxAbs=${maxAbs.toFixed(4)}` });
    }
    // very flat after L2 is rare for real FaceNet; check entropy-ish via std
    let varSum = 0;
    for (let i = 0; i < d.length; i++) {
      const x = (d[i] ?? 0) - mean;
      varSum += x * x;
    }
    const std = Math.sqrt(varSum / d.length);
    if (std < 0.02) {
      suspects.push({ id: r.id, name: r.name, reason: `low std=${std.toFixed(4)}` });
    }
  }

  const uniqueIds = new Set(raw.map((r) => r.id)).size;
  const report = {
    timestamp: new Date().toISOString(),
    meta: {
      version: meta.version,
      model: meta.model,
      dim,
      enrolledNote: meta.enrolled ?? null,
    },
    counts: {
      rawBuckets: raw.length,
      uniqueIds,
      uniqueFingerprints: byFp.size,
      collapsedBuckets: gallery.length,
      multiBucketSameIdGroups: multiBucketSameId,
      crossIdExactCollisionGroups: multiIdGroups.length,
      nearCrossIdPairsDistLt: NEAR,
      nearCrossIdPairCount: nearPairs.length,
      suspectVectors: suspects.length,
    },
    preCollapse: pre,
    sameIdCloneRate: pre.sameIdCloneRate,
    crossIdExactCollisions: multiIdGroups.slice(0, 40),
    nearCollisions: nearPairs.slice(0, 50),
    suspects: suspects.slice(0, 50),
    recommendations: [
      multiIdGroups.length > 0
        ? `CRITICAL: ${multiIdGroups.length} exact cross-id collision groups — re-encode or exclude listed IDs`
        : "No exact cross-id collisions",
      pre.sameIdCloneRate > 0.5
        ? `HIGH: same-id age-bucket clone rate ${(pre.sameIdCloneRate * 100).toFixed(1)}% — stop writing fake multi-age clone rows`
        : "Same-id clone rate OK",
      nearPairs.length > 20
        ? `MED: ${nearPairs.length} near-collisions (dist < ${NEAR}) — gallery crowded; expand diverse multi-photo enroll`
        : "Near-collision count modest",
      suspects.length > 0
        ? `MED: ${suspects.length} suspect low-energy vectors — check re-encode misses / random fallbacks`
        : "No low-energy suspect vectors",
      "NEXT: multi-photo per celeb with real FaceNet encodes; always TTA on enroll; ban random noise fallback",
      "NEXT: gold-set human labels (public/celebs/gold-set.json) + evaluate-gold-set.ts",
    ],
  };

  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));

  console.log("================================================================================");
  console.log("          TWINFRAME GALLERY QUALITY AUDIT (Phase 0/1)                          ");
  console.log("================================================================================");
  console.log(`Model:        ${report.meta.model}  v${report.meta.version}`);
  console.log(`Raw buckets:  ${report.counts.rawBuckets}`);
  console.log(`Unique IDs:   ${report.counts.uniqueIds}`);
  console.log(`Unique fps:   ${report.counts.uniqueFingerprints}`);
  console.log(`Collapsed:    ${report.counts.collapsedBuckets}`);
  console.log(`Same-id clone rate (pre-collapse): ${(report.sameIdCloneRate * 100).toFixed(1)}%`);
  console.log(`Cross-id exact collision groups:   ${report.counts.crossIdExactCollisionGroups}`);
  console.log(`Near cross-id pairs (d < ${NEAR}): ${report.counts.nearCrossIdPairCount}`);
  console.log(`Suspect vectors:                   ${report.counts.suspectVectors}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("Top cross-id collisions:");
  for (const g of multiIdGroups.slice(0, 8)) {
    console.log(`  ${g.ids.join(" ↔ ")}  (n=${g.count})`);
  }
  console.log("--------------------------------------------------------------------------------");
  console.log("Recommendations:");
  for (const r of report.recommendations) console.log(`  • ${r}`);
  console.log(`\nWrote ${jsonOut}`);
}

main();
