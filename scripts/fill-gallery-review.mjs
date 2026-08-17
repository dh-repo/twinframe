#!/usr/bin/env node
/**
 * Default remaining audit demotionIds to reenroll.
 * Never overwrites an existing keep / drop / reenroll.
 *
 * Usage:
 *   node --experimental-strip-types scripts/fill-gallery-review.mjs
 *   node --experimental-strip-types scripts/fill-gallery-review.mjs --write
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dropIds,
  fillUnsetAsReenroll,
  parseGalleryReview,
  unsetReviewIds,
} from "../src/lib/face/gallery-review.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const REVIEW_PATH = path.join(CELEBS, "gallery-review.json");
const AUDIT_PATH = path.join(CELEBS, "gallery-audit-v4.json");

function shouldWrite(argv = process.argv) {
  return argv.includes("--write");
}

export function fillReviewFile(review, suspectIds) {
  const parsed = parseGalleryReview(review);
  const decisions = fillUnsetAsReenroll(parsed.decisions, suspectIds);
  return {
    ...parsed,
    note:
      "Human-owned. gwenyth-paltrow is a typo clone (drop). Remaining audit demotions default to reenroll — keep them in the catalog and replace the photo on the Studio rebuild. apply-gallery-review --write never touches embeddings.v4.q8.bin.",
    sourceAudit: parsed.sourceAudit ?? "gallery-audit-v4.json",
    decisions,
    added: unsetReviewIds(suspectIds, parsed.decisions),
    drops: dropIds(decisions),
    unset: unsetReviewIds(suspectIds, decisions),
  };
}

function countByAction(decisions) {
  const counts = { drop: 0, keep: 0, reenroll: 0 };
  for (const action of Object.values(decisions)) {
    counts[action] += 1;
  }
  return counts;
}

function main() {
  const write = shouldWrite();
  const review = JSON.parse(fs.readFileSync(REVIEW_PATH, "utf8"));
  const audit = fs.existsSync(AUDIT_PATH)
    ? JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8"))
    : { demotionIds: [] };
  const suspectIds = Array.isArray(audit.demotionIds) ? audit.demotionIds : [];
  const result = fillReviewFile(review, suspectIds);
  const counts = countByAction(result.decisions);

  console.log("================================================================================");
  console.log("          TWINFRAME GALLERY REVIEW FILL (reenroll defaults)                     ");
  console.log("================================================================================");
  console.log(`audit demotions: ${suspectIds.length}`);
  console.log(`added reenroll:  ${result.added.length}`);
  console.log(`drop:            ${counts.drop}  [${result.drops.join(", ") || "—"}]`);
  console.log(`keep:            ${counts.keep}`);
  console.log(`reenroll:        ${counts.reenroll}`);
  console.log(`unset after:     ${result.unset.length}`);

  if (!write) {
    console.log("\nDry run. Pass --write to update public/celebs/gallery-review.json.");
    return;
  }

  const out = {
    version: result.version,
    note: result.note,
    sourceAudit: result.sourceAudit,
    decisions: Object.fromEntries(
      Object.entries(result.decisions).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  fs.writeFileSync(REVIEW_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWrote ${REVIEW_PATH}`);
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "fill-gallery-review.mjs";
if (isMain) main();
