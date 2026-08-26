#!/usr/bin/env node
/**
 * Generate the 96px/192px webp thumbnails add-gallery-slot.mjs requires
 * before it will enroll a new id. Reads public/celebs/<id>.jpg and writes
 * public/celebs/thumbs/{96,192}/<id>.webp — same resize/quality settings
 * scripts/rebuild-gallery-v5.mjs used for the existing gallery, so new
 * thumbnails match the current ones visually.
 *
 * Usage:
 *   node scripts/generate-thumbs.mjs --ids kanye-west,zoe-saldana
 *   node scripts/generate-thumbs.mjs --input scripts/new-celebrities.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function resolveIds() {
  const idsArg = arg("ids");
  if (idsArg) return idsArg.split(",").map((s) => s.trim()).filter(Boolean);
  const inputArg = arg("input");
  if (inputArg) {
    const entries = JSON.parse(fs.readFileSync(path.resolve(inputArg), "utf8"));
    return entries.map((e) => e.id);
  }
  console.error("usage: --ids id1,id2 | --input scripts/new-celebrities.json");
  process.exit(1);
}

async function main() {
  const ids = resolveIds();
  const d96 = path.join(CELEBS, "thumbs/96");
  const d192 = path.join(CELEBS, "thumbs/192");
  fs.mkdirSync(d96, { recursive: true });
  fs.mkdirSync(d192, { recursive: true });

  let done = 0;
  let missing = 0;
  for (const id of ids) {
    const src = path.join(CELEBS, `${id}.jpg`);
    if (!fs.existsSync(src)) {
      console.log(`- no portrait  ${id} (expected ${path.relative(ROOT, src)})`);
      missing++;
      continue;
    }
    await sharp(src).resize(96, 96, { fit: "cover" }).webp({ quality: 82 }).toFile(path.join(d96, `${id}.webp`));
    await sharp(src).resize(192, 192, { fit: "cover" }).webp({ quality: 85 }).toFile(path.join(d192, `${id}.webp`));
    console.log(`+ ${id}`);
    done++;
  }
  console.log(`done: ${done} thumb set(s) written, ${missing} missing a source portrait`);
  if (missing > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
