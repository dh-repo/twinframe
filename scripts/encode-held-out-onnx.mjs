#!/usr/bin/env node
/**
 * Re-encode tracked held-out probes with the live AdaFace+BGR Node path
 * (same SCRFD → Umeyama → IR-101 used by enroll). Keeps each case's
 * age/gender priors from the previous pack so only the descriptor space changes.
 *
 * Usage:
 *   node --experimental-strip-types scripts/encode-held-out-onnx.mjs
 *   node --experimental-strip-types scripts/encode-held-out-onnx.mjs --limit 8
 *   node --experimental-strip-types scripts/encode-held-out-onnx.mjs --ids kim-kardashian,meryl-streep --out reports/held-out-adaface-probes.json --merge --skip-missing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { adafaceModelReady, embedImageFile, ensureSessions } from "./enroll-gallery-onnx.mjs";

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

async function materializeForEmbed(srcPath) {
  const dest = path.join("/tmp/twinframe-heldout-decode", `${path.basename(srcPath, path.extname(srcPath))}-${Buffer.from(srcPath).toString("hex").slice(-12)}.png`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(srcPath).rotate().png().toFile(dest);
  return dest;
}

async function encodeCase(c) {
  const imagePath = resolveProbePath(c.source);
  if (!fs.existsSync(imagePath)) {
    return { ...c, ok: false, descriptor: [], error: `missing ${c.source}` };
  }
  const embedPath = await materializeForEmbed(imagePath);
  const emb = await embedImageFile(embedPath);
  const descriptor = emb.d512 ?? emb.d256;
  if (!descriptor || descriptor.length !== 512 || emb.embedKind !== "adaface") {
    return { ...c, ok: false, descriptor: [], error: `embedKind=${emb.embedKind} dim=${descriptor?.length}` };
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

async function main() {
  const args = parseEncodeArgs(process.argv.slice(2));
  if (!adafaceModelReady()) {
    throw new Error("AdaFace ONNX missing or too small. Run: node scripts/ensure-face-model.mjs");
  }
  const pack = JSON.parse(fs.readFileSync(PACK, "utf8"));
  const cases = filterEncodeCases(pack.cases ?? [], args);
  await ensureSessions();
  const out = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const encoded = await encodeCase(c);
    out.push(encoded);
    const flag = encoded.ok ? "OK" : `MISS ${encoded.error}`;
    process.stdout.write(`${i + 1}/${cases.length} ${c.id} ${flag}\n`);
  }
  const dest = args.out ? path.resolve(ROOT, args.out) : PACK;
  let kept = args.skipMissing ? out.filter((c) => c.ok) : out;
  if (args.merge && fs.existsSync(dest)) {
    const previous = JSON.parse(fs.readFileSync(dest, "utf8"));
    kept = mergeEncodedCases(previous.cases ?? [], kept);
    if (args.skipMissing) kept = kept.filter((c) => c.ok);
  }
  const ok = kept.filter((c) => c.ok);
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
