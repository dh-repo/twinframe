#!/usr/bin/env node
/**
 * Measure EdgeFace distance distributions on the re-enrolled gallery:
 *  - genuine: control/held-out probe → own gallery vector
 *  - impostor: probe → best non-self gallery vector
 *  - rank-1 identification accuracy
 * Compares truncated-256 vs full-512 to pick the shipping dimension and
 * derive HILL_D0 / distance-floor anchors.
 *
 * Usage: node --experimental-strip-types scripts/calibrate-edgeface.mjs [--probes N]
 */
import fs from "node:fs";
import path from "node:path";
import { embedImageFile } from "./enroll-gallery-onnx.mjs";

const ROOT = process.cwd();
const CELEBS = path.join(ROOT, "public/celebs");
const probesIdx = process.argv.indexOf("--probes");
const MAX_PROBES = probesIdx >= 0 ? Number(process.argv[probesIdx + 1]) : Infinity;

const rows = JSON.parse(fs.readFileSync("/tmp/twinframe-enroll/embeddings.json", "utf8"));
const extrasPath = "/tmp/twinframe-enroll/extras.json";
if (fs.existsSync(extrasPath)) {
  const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
  rows.push(...extras);
  console.log(`merged ${extras.length} extra templates`);
}
const galleryById = new Map(rows.map((r) => [r.id, r]));

function cos(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return 1 - dot;
}

// Collect probes: control + held-out first images (unseen photos of enrolled ids)
const probes = [];
for (const dir of ["control", "held-out"]) {
  const base = path.join(CELEBS, dir);
  if (!fs.existsSync(base)) continue;
  for (const id of fs.readdirSync(base)) {
    const img = path.join(base, id, "001.jpg");
    if (fs.existsSync(img) && galleryById.has(id)) {
      probes.push({ id, img, set: dir });
    }
  }
}
probes.sort((a, b) => a.id.localeCompare(b.id));
const useProbes = probes.slice(0, MAX_PROBES === Infinity ? probes.length : MAX_PROBES);
console.log(`probes=${useProbes.length} gallery=${rows.length}`);

function stats(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    n: values.length,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
  };
}

const report = { d256: { genuine: [], impostorBest: [], rank1: 0 }, d512: { genuine: [], impostorBest: [], rank1: 0 } };
let processed = 0;
const t0 = Date.now();

for (const probe of useProbes) {
  let emb;
  try {
    emb = await embedImageFile(probe.img);
  } catch {
    continue;
  }
  for (const dim of ["d256", "d512"]) {
    const pv = emb[dim];
    let selfD = null;
    let bestOther = Infinity;
    for (const g of rows) {
      const d = cos(pv, g[dim]);
      if (g.id === probe.id) selfD = selfD == null ? d : Math.min(selfD, d);
      else if (d < bestOther) {
        bestOther = d;
      }
    }
    if (selfD == null) continue;
    report[dim].genuine.push(selfD);
    report[dim].impostorBest.push(bestOther);
    if (selfD < bestOther) report[dim].rank1++;
  }
  processed++;
  if (processed % 25 === 0) {
    process.stdout.write(`\r${processed}/${useProbes.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}

console.log(`\nprocessed=${processed}`);
for (const dim of ["d256", "d512"]) {
  const g = stats(report[dim].genuine);
  const imp = stats(report[dim].impostorBest);
  const rank1 = ((report[dim].rank1 / Math.max(1, processed)) * 100).toFixed(1);
  console.log(`--- ${dim}`);
  console.log(`  rank1=${rank1}%`);
  console.log(`  genuine  mean=${g.mean.toFixed(3)} p10=${g.p10.toFixed(3)} p50=${g.p50.toFixed(3)} p90=${g.p90.toFixed(3)}`);
  console.log(`  impostor mean=${imp.mean.toFixed(3)} p10=${imp.p10.toFixed(3)} p50=${imp.p50.toFixed(3)} p90=${imp.p90.toFixed(3)}`);
  console.log(`  margin(p50 imp - p50 gen)=${(imp.p50 - g.p50).toFixed(3)}`);
}
fs.writeFileSync("/tmp/twinframe-enroll/calibration.json", JSON.stringify(report, (k, v) => (Array.isArray(v) && typeof v[0] === "number" ? v.map((x) => Math.round(x * 10000) / 10000) : v)));
console.log("wrote /tmp/twinframe-enroll/calibration.json");
