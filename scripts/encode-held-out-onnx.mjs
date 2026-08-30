#!/usr/bin/env node
/**
 * Re-encode tracked held-out probes with the live AdaFace+BGR Node path
 * (same SCRFD → Umeyama → IR-101 used by enroll). Keeps each case's
 * age/gender priors from the previous pack so only the descriptor space changes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/encode-held-out-onnx.mjs
 *   node --experimental-strip-types scripts/encode-held-out-onnx.mjs --limit 8
 *   node --experimental-strip-types scripts/encode-held-out-onnx.mjs --ids kim-kardashian,meryl-streep --out reports/held-out-adaface-probes.json --merge --skip-missing --concurrency 4
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { adafaceModelReady, embedImageFile } from "./enroll-gallery-onnx.mjs";
import { mapProcessPool, parseConcurrencyArg } from "./lib/photo-pool.mjs";
import { EVAL_SLOT, listHeldOutSlots } from "./fetch-held-out-photos.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACK = path.join(ROOT, "public/celebs/held-out/descriptors.json");

export function resolveProbePath(source, root = ROOT) {
  const rel = String(source || "").replace(/^\/+/, "");
  return path.join(root, "public", rel);
}

export function parseEncodeArgs(argv) {
  const out = {
    limit: Infinity,
    write: !argv.includes("--dry-run"),
    out: null,
    skipMissing: argv.includes("--skip-missing"),
    merge: argv.includes("--merge"),
    scanDisk: argv.includes("--scan-disk"),
    concurrency: parseConcurrencyArg(argv),
    ids: /** @type {string[] | null} */ (null),
  };
  const idx = argv.indexOf("--limit");
  if (idx >= 0) out.limit = Number(argv[idx + 1]);
  const outIdx = argv.indexOf("--out");
  if (outIdx >= 0) out.out = argv[outIdx + 1];
  const idsIdx = argv.indexOf("--ids");
  if (idsIdx >= 0) {
    const raw = String(argv[idsIdx + 1] ?? "");
    if (!raw || raw.startsWith("--")) throw new Error("Missing --ids value (comma-separated probe ids)");
    out.ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (out.ids.length === 0) throw new Error("Empty --ids list");
  }
  return out;
}

export function filterEncodeCases(cases, args) {
  let out = cases;
  if (args.ids?.length) {
    const want = new Set(args.ids);
    out = out.filter((c) => want.has(c.id));
  }
  if (Number.isFinite(args.limit)) out = out.slice(0, args.limit);
  return out;
}

export function mergeEncodedCases(previous, encoded) {
  const bySource = new Map();
  for (const row of previous) bySource.set(row.source, row);
  for (const row of encoded) bySource.set(row.source, row);
  return [...bySource.values()].sort(
    (a, b) => a.id.localeCompare(b.id) || String(a.source).localeCompare(String(b.source)),
  );
}

export function scanDiskEvalCases(heldOutDir, buckets, existingCases = []) {
  const have = new Set(existingCases.map((c) => c.source));
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const extra = [];
  for (const slot of listHeldOutSlots(heldOutDir)) {
    if (slot.slot !== EVAL_SLOT) continue;
    const source = `/celebs/held-out/${slot.id}/${path.basename(slot.filePath)}`;
    if (have.has(source)) continue;
    const b = byId.get(slot.id);
    if (!b) continue;
    extra.push({
      id: slot.id,
      name: b.name,
      source,
      age: b.age,
      gender: b.gender,
      genderProb: b.genderProb,
      ok: true,
      descriptor: [],
    });
  }
  return extra;
}

/** Unique decode path per source. Slicing the last 12 hex chars of the path
 *  collided for every `…/001.jpg` and every worker embedded the same PNG. */
export function decodePathForEmbed(srcPath, tmpDir = "/tmp/twinframe-heldout-decode") {
  const digest = crypto.createHash("sha256").update(srcPath).digest("hex").slice(0, 24);
  const idHint = path.basename(path.dirname(srcPath)).replace(/[^a-z0-9_-]/gi, "").slice(0, 32);
  return path.join(tmpDir, `${idHint}-${digest}.png`);
}

export function distinctDescriptorCount(cases, decimals = 4) {
  const keys = new Set();
  for (const c of cases) {
    if (!c?.ok || !Array.isArray(c.descriptor) || c.descriptor.length < 8) continue;
    keys.add(c.descriptor.slice(0, 8).map((x) => Number(x).toFixed(decimals)).join(","));
  }
  return keys.size;
}

async function materializeForEmbed(srcPath) {
  const dest = decodePathForEmbed(srcPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(srcPath).rotate().png().toFile(dest);
  return dest;
}

export function caseFromEmbed(c, emb, error) {
  if (error) return { ...c, ok: false, descriptor: [], error };
  const descriptor = emb?.d512 ?? emb?.d256;
  if (!descriptor || descriptor.length !== 512 || emb.embedKind !== "adaface") {
    return { ...c, ok: false, descriptor: [], error: `embedKind=${emb?.embedKind} dim=${descriptor?.length}` };
  }
  if (!emb.usedDetection) {
    return { ...c, ok: false, descriptor: [], error: "no-detection" };
  }
  return {
    ...c,
    ok: true,
    descriptor: Array.from(descriptor),
    error: undefined,
  };
}

async function encodeCase(c) {
  const imagePath = resolveProbePath(c.source);
  if (!fs.existsSync(imagePath)) {
    return { ...c, ok: false, descriptor: [], error: `missing ${c.source}` };
  }
  const embedPath = await materializeForEmbed(imagePath);
  const emb = await embedImageFile(embedPath);
  return caseFromEmbed(c, emb);
}

const EMBED_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib/embed-worker.mjs");

async function encodeCasesPooled(cases, concurrency) {
  const jobs = [];
  /** @type {Array<{ index: number, encoded: object }>} */
  const immediate = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const imagePath = resolveProbePath(c.source);
    if (!fs.existsSync(imagePath)) {
      immediate.push({ index: i, encoded: { ...c, ok: false, descriptor: [], error: `missing ${c.source}` } });
      continue;
    }
    const embedPath = await materializeForEmbed(imagePath);
    jobs.push({ index: i, case: c, filePath: embedPath });
  }
  const t0 = Date.now();
  const poolResults = await mapProcessPool(
    jobs.map((j) => ({ filePath: j.filePath })),
    {
      workerPath: EMBED_WORKER,
      concurrency,
      onProgress(done, total) {
        if (done % 10 !== 0 && done !== total) return;
        const rate = done / Math.max(0.001, (Date.now() - t0) / 1000);
        process.stdout.write(
          `\r${done}/${total} encode (${rate.toFixed(2)}/s, eta ${(Math.max(0, total - done) / rate).toFixed(0)}s)`,
        );
      },
    },
  );
  if (jobs.length) process.stdout.write("\n");
  const out = new Array(cases.length);
  for (const row of immediate) out[row.index] = row.encoded;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const result = poolResults[i];
    out[job.index] = result?.ok
      ? caseFromEmbed(job.case, result.value)
      : caseFromEmbed(job.case, null, String(result?.error ?? "embed failed"));
    const flag = out[job.index].ok ? "OK" : `MISS ${out[job.index].error}`;
    process.stdout.write(`${job.case.id} ${flag}\n`);
  }
  return out;
}

async function main() {
  const args = parseEncodeArgs(process.argv.slice(2));
  if (!adafaceModelReady()) {
    throw new Error("AdaFace ONNX missing or too small. Run: node scripts/ensure-face-model.mjs");
  }
  const pack = JSON.parse(fs.readFileSync(PACK, "utf8"));
  let cases = pack.cases ?? [];
  if (args.scanDisk) {
    const buckets = JSON.parse(fs.readFileSync(path.join(ROOT, "public/celebs/gallery.buckets.json"), "utf8"));
    const scanned = scanDiskEvalCases(path.join(ROOT, "public/celebs/held-out"), buckets, cases);
    cases = cases.concat(scanned);
    process.stdout.write(`scan-disk: +${scanned.length} eval 001s not already in the pack\n`);
  }
  cases = filterEncodeCases(cases, args);
  const out = await encodeCasesPooled(cases, args.concurrency);
  const dest = args.out ? path.resolve(ROOT, args.out) : PACK;
  let kept = args.skipMissing ? out.filter((c) => c.ok) : out;
  if (args.merge && fs.existsSync(dest)) {
    const previous = JSON.parse(fs.readFileSync(dest, "utf8"));
    kept = mergeEncodedCases(previous.cases ?? [], kept);
    if (args.skipMissing) kept = kept.filter((c) => c.ok);
  }
  const ok = kept.filter((c) => c.ok);
  const distinct = distinctDescriptorCount(ok);
  if (ok.length >= 8 && distinct < Math.max(3, Math.floor(ok.length * 0.5))) {
    throw new Error(
      `AdaFace probe collapse: ${distinct} distinct heads among ${ok.length} encodings (decode-path collision?)`,
    );
  }
  const next = {
    version: "2.1.0-adaface512",
    model: "adaface-ir101-512d",
    alignment: "scrfd-5pt-similarity-112",
    dim: 512,
    count: ok.length,
    cases: kept,
  };
  const canWrite = args.write && (args.limit === Infinity || args.out || args.ids || args.merge);
  if (canWrite) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`wrote ${dest} ${ok.length}/${out.length} ok\n`);
  } else if (args.write && Number.isFinite(args.limit)) {
    process.stdout.write(`--limit ${args.limit}: not overwriting ${PACK} (pass --out or drop --limit)\n`);
  } else {
    process.stdout.write(`dry-run ${ok.length}/${out.length} ok\n`);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

export { encodeCase };
