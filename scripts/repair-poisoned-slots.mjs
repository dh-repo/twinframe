#!/usr/bin/env node
/**
 * Surgically re-enroll poisoned AFv4 slots with live AdaFace+BGR.
 *
 * Uses the shipped globalScale so every other q8 row stays byte-identical.
 * Household names stay in the gallery. Refuses whole-crop primaries.
 *
 * Usage:
 *   node --experimental-strip-types scripts/repair-poisoned-slots.mjs
 *   node --experimental-strip-types scripts/repair-poisoned-slots.mjs --write
 *   node --experimental-strip-types scripts/repair-poisoned-slots.mjs --ids alec-burden,ralph-fiennes --write
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { acceptPrimaryEmbed, adafaceModelReady, embedImageFile, ensureSessions } from "./enroll-gallery-onnx.mjs";
import { preferRepairSource } from "./lib/enroll-jobs.mjs";
import {
  assertReportsJsonPath,
  COLLAPSE_IDS,
  HOUSEHOLD_COLLAPSE_IDS,
  loadShippedGalleryRows,
  parseDiagnoseArgs,
  q8Fingerprint,
  sourceKind,
} from "./lib/gallery-collapse.mjs";
import { cosineDistance, decodeV4Header, patchQ8Slots } from "./lib/gallery-binary.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = join(ROOT, "public/celebs");
const BIN_PATH = join(CELEBS, "embeddings.v4.q8.bin");
const DECODE_DIR = "/tmp/twinframe-collapse-decode";
const MANIFEST_PATH = join(CELEBS, "gallery-repairs.json");

export function parseRepairArgs(argv) {
  const parsed = parseDiagnoseArgs(argv, [...COLLAPSE_IDS]);
  return {
    ...parsed,
    write: argv.includes("--write"),
  };
}

async function materializeForEmbed(srcPath) {
  if (!srcPath.endsWith(".webp")) return srcPath;
  const dest = join(DECODE_DIR, `${basename(srcPath, ".webp")}-${sourceKind(srcPath)}.png`);
  await mkdir(dirname(dest), { recursive: true });
  await sharp(srcPath).png().toFile(dest);
  return dest;
}

async function encodeRepairSource(id, srcPath) {
  const embedPath = await materializeForEmbed(srcPath);
  const emb = await embedImageFile(embedPath);
  if (!acceptPrimaryEmbed(emb)) {
    throw new Error(`${id}: detection failed — refusing whole-crop`);
  }
  const descriptor = emb.d512 ?? emb.d256;
  if (!descriptor || descriptor.length !== 512 || emb.embedKind !== "adaface") {
    throw new Error(`${id}: embedKind=${emb.embedKind ?? "none"} dim=${descriptor?.length ?? 0}`);
  }
  return {
    descriptor,
    usedDetection: emb.usedDetection,
    padded: emb.padded,
    score: emb.score,
    sourceKind: sourceKind(srcPath),
  };
}

function unchangedBytesExcept(before, after, indices, dim) {
  const skip = new Set(indices);
  if (before.subarray(0, 32).compare(after.subarray(0, 32)) !== 0) return false;
  const count = (before.length - 32) / dim;
  for (let i = 0; i < count; i++) {
    if (skip.has(i)) continue;
    const off = 32 + i * dim;
    if (before.subarray(off, off + dim).compare(after.subarray(off, off + dim)) !== 0) return false;
  }
  return true;
}

async function main() {
  const args = parseRepairArgs(process.argv.slice(2));
  if (!adafaceModelReady()) {
    throw new Error("AdaFace ONNX missing or too small. Run: node scripts/ensure-face-model.mjs");
  }

  const { header, rows } = loadShippedGalleryRows(ROOT);
  const byId = new Map(rows.map((r, index) => [r.id, { ...r, index }]));
  const ids = args.ids.filter((id, i, arr) => arr.indexOf(id) === i);

  await ensureSessions();
  const repairs = [];
  const patches = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new Error(`id not in shipped gallery: ${id}`);
    const srcPath = preferRepairSource(id, CELEBS);
    if (!srcPath) throw new Error(`no repair source for ${id}`);
    const encoded = await encodeRepairSource(id, srcPath);
    const liveDistance = cosineDistance(row.descriptor, encoded.descriptor);
    repairs.push({
      id,
      index: row.index,
      household: HOUSEHOLD_COLLAPSE_IDS.has(id),
      source: srcPath.replace(`${ROOT}/`, ""),
      sourceKind: encoded.sourceKind,
      usedDetection: encoded.usedDetection,
      padded: encoded.padded,
      score: encoded.score,
      shippedToLive: liveDistance,
      beforeFingerprint: row.q8Fingerprint,
    });
    patches.push({ index: row.index, descriptor: encoded.descriptor, id });
  }

  const before = await readFile(BIN_PATH);
  const after = patchQ8Slots(before, patches);
  const dim = header.dimension;
  if (!unchangedBytesExcept(before, after, patches.map((p) => p.index), dim)) {
    throw new Error("patch touched header or an unlisted slot");
  }

  const afterHeader = decodeV4Header(after);
  if (afterHeader.globalScale !== decodeV4Header(before).globalScale) {
    throw new Error("globalScale changed");
  }

  for (const repair of repairs) {
    const off = 32 + repair.index * dim;
    repair.afterFingerprint = q8Fingerprint(after.subarray(off, off + dim));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    wrote: false,
    householdPolicy: "keep — repair vectors in place, do not approve-drop",
    scale: header.globalScale,
    dimension: dim,
    repairs,
  };

  const lines = repairs.map(
    (r) =>
      `${r.id} idx=${r.index} ${r.sourceKind} shipped→live=${r.shippedToLive.toFixed(4)} ` +
      `detect=${r.score.toFixed(3)} household=${r.household}`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);

  if (args.write) {
    await writeFile(BIN_PATH, after);
    await writeFile(
      MANIFEST_PATH,
      `${JSON.stringify(
        {
          version: 1,
          note: "Surgical AdaFace re-enroll of poisoned slots. Existing globalScale. Other q8 rows unchanged. Household names kept.",
          generatedAt: report.generatedAt,
          repairs,
        },
        null,
        2,
      )}\n`,
    );
    report.wrote = true;
    process.stdout.write(`wrote ${BIN_PATH} and ${MANIFEST_PATH}\n`);
  } else {
    process.stdout.write("dry-run — pass --write to patch embeddings.v4.q8.bin\n");
  }

  if (args.json) {
    const dest = assertReportsJsonPath(args.json, ROOT);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`wrote ${dest}\n`);
  }
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

export { unchangedBytesExcept };
