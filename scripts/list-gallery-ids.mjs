#!/usr/bin/env node
/**
 * Print enrolled celebrity ids for gold labeling (id, name, gender, age).
 *
 * Usage:
 *   node scripts/list-gallery-ids.mjs
 *   node scripts/list-gallery-ids.mjs --out fixtures/gold/gallery-ids.tsv
 *   node scripts/list-gallery-ids.mjs --gender female
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKETS_PATH = path.join(ROOT, "public/celebs/gallery.buckets.json");

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

function main() {
  const gender = arg("gender");
  const outArg = arg("out");
  const buckets = JSON.parse(fs.readFileSync(BUCKETS_PATH, "utf8"));
  const rows = buckets
    .filter((b) => !gender || b.gender === gender)
    .map((b) => [b.id, b.name ?? "", b.gender ?? "", b.age ?? ""].join("\t"))
    .sort((a, b) => a.localeCompare(b));
  const text = ["id\tname\tgender\tage", ...rows].join("\n") + "\n";
  if (typeof outArg === "string") {
    const outPath = path.resolve(outArg);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text);
    console.log(`wrote ${rows.length} ids → ${outPath}`);
    return;
  }
  process.stdout.write(text);
}

main();
