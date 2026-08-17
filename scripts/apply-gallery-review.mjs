#!/usr/bin/env node
/**
 * Apply human gallery-review decisions to the catalog only.
 * Never rewrites embeddings.v4.q8.bin — re-enroll + write-gallery-v4 after drops.
 *
 * Usage:
 *   node --experimental-strip-types scripts/apply-gallery-review.mjs
 *   node --experimental-strip-types scripts/apply-gallery-review.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDrops,
  dropIds,
  parseGalleryReview,
  unsetReviewIds,
} from "../src/lib/face/gallery-review.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const REVIEW_PATH = path.join(CELEBS, "gallery-review.json");
const AUDIT_PATH = path.join(CELEBS, "gallery-audit-v4.json");
const BUCKETS_PATH = path.join(CELEBS, "gallery.buckets.json");
const INDEX_PATH = path.join(CELEBS, "index.json");
const BINARY_PATH = path.join(CELEBS, "embeddings.v4.q8.bin");

function shouldWrite(argv = process.argv) {
  return argv.includes("--write");
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function applyReviewToCatalog({ review, suspectIds, buckets, index }) {
  const parsed = parseGalleryReview(review);
  const drops = dropIds(parsed.decisions);
  return {
    decisions: parsed.decisions,
    drops,
    unset: unsetReviewIds(suspectIds, parsed.decisions),
    buckets: applyDrops(buckets, drops),
    index: applyDrops(index, drops),
  };
}

function main() {
  const write = shouldWrite();
  const review = loadJson(REVIEW_PATH);
  const audit = fs.existsSync(AUDIT_PATH) ? loadJson(AUDIT_PATH) : { demotionIds: [] };
  const suspectIds = Array.isArray(audit.demotionIds) ? audit.demotionIds : [];
  const buckets = loadJson(BUCKETS_PATH);
  const index = loadJson(INDEX_PATH);

  const result = applyReviewToCatalog({ review, suspectIds, buckets, index });

  console.log("================================================================================");
  console.log("          TWINFRAME GALLERY REVIEW APPLY (catalog only)                         ");
  console.log("================================================================================");
  console.log(`drop:     ${result.drops.length}  [${result.drops.join(", ") || "—"}]`);
  console.log(`unset:    ${result.unset.length} (still need keep / reenroll / drop)`);
  console.log(`buckets:  ${buckets.length} → ${result.buckets.length}`);
  console.log(`index:    ${index.length} → ${result.index.length}`);
  if (result.unset.length > 0) {
    console.log("unset ids (first 12):");
    for (const id of result.unset.slice(0, 12)) console.log(`  • ${id}`);
  }
  console.log("Will not write embeddings.v4.q8.bin. Re-enroll + write-gallery-v4 after --write.");

  if (!write) {
    console.log("\nDry run. Pass --write to update gallery.buckets.json and index.json.");
    return;
  }

  if (path.resolve(BINARY_PATH) === path.resolve(BUCKETS_PATH)) {
    throw new Error("refusing to treat the binary as a catalog file");
  }
  const beforeBin = fs.existsSync(BINARY_PATH) ? fs.statSync(BINARY_PATH).mtimeMs : null;
  fs.writeFileSync(BUCKETS_PATH, `${JSON.stringify(result.buckets, null, 2)}\n`);
  fs.writeFileSync(INDEX_PATH, `${JSON.stringify(result.index, null, 2)}\n`);
  const afterBin = fs.existsSync(BINARY_PATH) ? fs.statSync(BINARY_PATH).mtimeMs : null;
  if (beforeBin != null && afterBin !== beforeBin) {
    throw new Error("embeddings.v4.q8.bin changed — apply-gallery-review must not touch it");
  }
  console.log(`\nWrote ${BUCKETS_PATH} and ${INDEX_PATH}. Binary left untouched.`);
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "apply-gallery-review.mjs";
if (isMain) main();
