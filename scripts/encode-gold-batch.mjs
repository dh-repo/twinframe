#!/usr/bin/env node
/**
 * Encode every labeled civilian/refuse row in a gold labels file.
 * Does not invent faces or look-alike ids — labels must already name real gallery ids.
 *
 * Usage:
 *   node --experimental-strip-types scripts/encode-gold-batch.mjs --labels fixtures/gold/labels.json --check
 *   node --experimental-strip-types scripts/encode-gold-batch.mjs --labels fixtures/gold/labels.json --check-ids
 *   node --experimental-strip-types scripts/encode-gold-batch.mjs --labels fixtures/gold/labels.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKETS_PATH = path.join(ROOT, "public/celebs/gallery.buckets.json");
const ENCODE = path.join(ROOT, "scripts/encode-gold-probe.mjs");

function arg(name, argv = process.argv) {
  const idx = argv.indexOf(`--${name}`);
  if (idx < 0) return null;
  const next = argv[idx + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

function usage() {
  console.error(`Usage:
  node --experimental-strip-types scripts/encode-gold-batch.mjs --labels fixtures/gold/labels.json [--check | --check-ids]`);
}

function loadGalleryIds(bucketsPath = BUCKETS_PATH) {
  const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf8"));
  return new Set(buckets.map((b) => b.id));
}

export function parseGoldLabels(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("labels.json must be an object");
  }
  const rec = raw;
  if (!Array.isArray(rec.cases) || rec.cases.length === 0) {
    throw new Error("labels.json needs a non-empty cases array");
  }
  return rec.cases.map((row, i) => {
    if (!row || typeof row !== "object") throw new Error(`case ${i} must be an object`);
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const image = typeof row.image === "string" ? row.image.trim() : "";
    if (!id) throw new Error(`case ${i} needs an id`);
    if (!image) throw new Error(`${id} needs an image path`);
    const refuse = Boolean(row.refuse);
    const accept = Array.isArray(row.accept)
      ? row.accept.map((s) => String(s).trim()).filter(Boolean)
      : [];
    if (refuse === accept.length > 0) {
      throw new Error(`${id} must set either refuse:true or accept:[id,id] (not both, not neither)`);
    }
    return {
      id,
      image,
      refuse,
      accept,
      notes: typeof row.notes === "string" ? row.notes : undefined,
      age: typeof row.age === "number" ? row.age : undefined,
      gender: typeof row.gender === "string" ? row.gender : undefined,
    };
  });
}

export function checkGoldLabels(cases, { galleryIds, root = ROOT, requireImages = true } = {}) {
  const errors = [];
  const seen = new Set();
  for (const row of cases) {
    if (seen.has(row.id)) errors.push(`duplicate case id ${row.id}`);
    seen.add(row.id);
    if (requireImages) {
      const imagePath = path.resolve(root, row.image);
      if (!fs.existsSync(imagePath)) errors.push(`missing image for ${row.id}: ${row.image}`);
    }
    for (const celebId of row.accept) {
      if (galleryIds && !galleryIds.has(celebId)) {
        errors.push(`${row.id} accept id not in gallery: ${celebId}`);
      }
    }
  }
  return errors;
}

function main() {
  const labelsArg = arg("labels");
  const checkOnly = Boolean(arg("check"));
  const checkIds = Boolean(arg("check-ids"));
  if (typeof labelsArg !== "string") {
    usage();
    process.exit(1);
  }
  const labelsPath = path.resolve(labelsArg);
  if (!fs.existsSync(labelsPath)) {
    console.error(`Missing labels file: ${labelsPath}`);
    process.exit(1);
  }

  const cases = parseGoldLabels(JSON.parse(fs.readFileSync(labelsPath, "utf8")));
  const galleryIds = loadGalleryIds();
  const errors = checkGoldLabels(cases, {
    galleryIds,
    requireImages: !checkIds,
  });
  if (errors.length > 0) {
    for (const err of errors) console.error(`  • ${err}`);
    process.exit(1);
  }

  console.log(`labels ok: ${cases.length} cases  (${cases.filter((c) => c.refuse).length} refuse)`);
  if (checkOnly || checkIds) return;

  for (const row of cases) {
    const args = [
      "--experimental-strip-types",
      ENCODE,
      "--image",
      path.resolve(ROOT, row.image),
      "--id",
      row.id,
    ];
    if (row.refuse) args.push("--refuse");
    else args.push("--accept", row.accept.join(","));
    if (row.notes) args.push("--notes", row.notes);
    if (row.age != null) args.push("--age", String(row.age));
    if (row.gender) args.push("--gender", row.gender);
    const res = spawnSync(process.execPath, args, { encoding: "utf8", cwd: ROOT });
    if (res.status !== 0) {
      console.error(res.stderr || res.stdout);
      process.exit(res.status ?? 1);
    }
    process.stdout.write(res.stdout);
  }
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "encode-gold-batch.mjs";
if (isMain) main();
