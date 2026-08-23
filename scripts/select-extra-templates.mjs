#!/usr/bin/env node
/**
 * Select identity-verified multi-shot templates and append them to
 * public/celebs/extra-templates.json.
 *
 * Policy: a candidate photo earns a template slot only if its live-pipeline
 * descriptor sits within IDENTITY_MAX_COSINE of the celeb's shipped slot
 * vector — junk (paintings, unrelated people, crowd bystanders) cannot pass.
 * Candidates that are byte-duplicates of already-selected files, of each other,
 * or of the slot's own source image are excluded.
 *
 * Inputs:
 *   --candidates <descriptors.json>   encoded via scripts/encode-held-out-browser.mjs
 *   [--apply]                         default report-only
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const IDENTITY_MAX_COSINE = 0.45;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const candPath = arg("candidates");
if (!candPath) {
  console.error("usage: --candidates <descriptors.json> [--apply]");
  process.exit(1);
}

// Width from the header — never assume (cycle-6 half-stride lesson).
const bin = fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin"));
if (bin.subarray(0, 4).toString("latin1") !== "AFv4") throw new Error("Bad v4 magic");
const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const count = view.getUint32(8, true);
const dim = view.getUint16(12, true);
const scale = view.getFloat32(16, true);
const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
if (count !== buckets.length) throw new Error(`header ${count} != buckets ${buckets.length}`);

function slotVector(i) {
  const raw = new Float64Array(dim);
  for (let j = 0; j < dim; j++) raw[j] = (bin[32 + i * dim + j] - 128) * scale;
  let n = 0;
  for (let j = 0; j < dim; j++) n += raw[j] * raw[j];
  n = Math.sqrt(n) || 1;
  return Array.from(raw, (v) => v / n);
}

const slots = new Map(buckets.map((b, i) => [b.id, slotVector(i)]));
const cosine = (a, b) => 1 - a.reduce((acc, x, i) => acc + x * b[i], 0);

const pack = JSON.parse(fs.readFileSync(candPath, "utf8"));
// Sources are stored relative to public/celebs (the catalog root).
const fileSha = (rel) =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(CELEBS, rel))).digest("hex");

// Slot source hashes: a candidate byte-equal to an enrolled portrait adds nothing.
const slotSourceHashes = new Set();
for (const b of buckets) {
  for (const p of [b.fallbackPath]) {
    if (!p) continue;
    const rel = p.replace(/^\/?(?:celebs\/)?/, "");
    const fp = path.join(CELEBS, rel);
    if (fs.existsSync(fp)) slotSourceHashes.add(fileSha(rel));
  }
}
// Hashes already used by existing templates (refetch protection).
const templatesFile = path.join(CELEBS, "extra-templates.json");
const data = JSON.parse(fs.readFileSync(templatesFile, "utf8"));
const existingSources = new Set(data.templates.map((t) => t.source ?? ""));
for (const t of data.templates) {
  if (t.source && fs.existsSync(path.join(CELEBS, t.source))) {
    slotSourceHashes.add(fileSha(t.source));
  }
}

const selected = [];
const seenContent = new Set();
let rejectedWrongIdentity = 0;
let rejectedDuplicate = 0;

for (const c of pack.cases ?? []) {
  if (c.ok === false || !c.descriptor?.length || c.descriptor.length !== dim) continue;
  const rel = String(c.source ?? "").replace(/^\/?celebs\//, "");
  if (!rel || !fs.existsSync(path.join(CELEBS, rel))) continue;
  const h = fileSha(rel);
  if (slotSourceHashes.has(h) || seenContent.has(h)) {
    rejectedDuplicate++;
    continue;
  }
  const slot = slots.get(c.id);
  if (!slot) continue;
  const qv = c.descriptor;
  const n = Math.sqrt(qv.reduce((a, x) => a + x * x, 0)) || 1;
  const q = qv.map((x) => x / n);
  const d = cosine(q, slot);
  if (d >= IDENTITY_MAX_COSINE) {
    rejectedWrongIdentity++;
    continue;
  }
  seenContent.add(h);
  selected.push({ id: c.id, source: rel, descriptor: c.descriptor });
}

console.log(
  `candidates ${pack.cases.length}: selected ${selected.length}, ` +
    `rejected identity ${rejectedWrongIdentity}, duplicate/content ${rejectedDuplicate}`,
);
for (const s of selected) console.log(`  + ${s.id} <- ${s.source}`);

if (process.argv.includes("--apply")) {
  let added = 0;
  for (const s of selected) {
    if (existingSources.has(s.source)) continue;
    data.templates.push({ id: s.id, source: s.source, descriptor: s.descriptor });
    added++;
  }
  fs.writeFileSync(templatesFile, JSON.stringify(data, null, 1));
  console.log(`applied: ${added} templates appended (${data.templates.length} total)`);
} else {
  console.log("(report-only; pass --apply to append)");
}
