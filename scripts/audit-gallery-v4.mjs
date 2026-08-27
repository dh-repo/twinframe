#!/usr/bin/env node
/**
 * Live AdaFace-512 gallery audit. Does not rewrite embeddings.v4.q8.bin.
 *
 * Reports exact clones, identity-range donor-clone candidates, look-alike
 * crowding, LOO strong-band hits, suspect vectors, and a demotion review list.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-gallery-v4.mjs
 *   node --experimental-strip-types scripts/audit-gallery-v4.mjs --json public/celebs/gallery-audit-v4.json
 *   node --experimental-strip-types scripts/audit-gallery-v4.mjs --proposed reports/gallery-demotions-proposed.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUDIT_CLONE_MAX,
  AUDIT_IDENTITY_MAX,
  AUDIT_LOOKALIKE_MAX,
  collectCrossIdPairs,
  demotionIds,
  findSuspectVectors,
  pairBandLabel,
} from "../src/lib/face/gallery-audit.ts";
import { proposeDemotionEntries } from "../src/lib/face/gallery-demotions.ts";
import { loadV4Gallery, runLeaveOneOut } from "./lib/v4-gallery.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function jsonOutPath() {
  const idx = process.argv.indexOf("--json");
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("-")) {
    return path.resolve(process.argv[idx + 1]);
  }
  return path.join(CELEBS, "gallery-audit-v4.json");
}

function proposedOutPath() {
  const idx = process.argv.indexOf("--proposed");
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("-")) {
    return path.resolve(process.argv[idx + 1]);
  }
  return null;
}

function main() {
  const { header, gallery } = loadV4Gallery(ROOT, { applyDemotions: false });
  const pairs = collectCrossIdPairs(gallery);
  const clones = pairs.filter((p) => p.band === "clone");
  const identity = pairs.filter((p) => p.band === "identity-range");
  const lookalike = pairs.filter((p) => p.band === "lookalike-range");
  const suspects = findSuspectVectors(gallery);
  const loo = runLeaveOneOut(gallery);
  const strongHits = loo.hits.filter((h) => h.band === "strong");
  const demote = demotionIds(pairs, suspects);
  const proposed = proposeDemotionEntries(pairs);

  const report = {
    version: "1.0.0-adaface512",
    generatedAt: new Date().toISOString(),
    note: "Generated audit — not a ranking source of truth. proposedDemotions are review-only; promote into gallery-demotions.json approved after human review. This script does not rewrite embeddings.v4.q8.bin.",
    gallery: {
      magic: header.magic,
      dimension: header.dimension,
      vectorCount: header.vectorCount,
      prototypeRows: gallery.length,
      uniqueIds: new Set(gallery.map((g) => g.id)).size,
    },
    thresholds: {
      cloneMax: AUDIT_CLONE_MAX,
      identityMax: AUDIT_IDENTITY_MAX,
      lookalikeMax: AUDIT_LOOKALIKE_MAX,
    },
    counts: {
      clonePairs: clones.length,
      identityRangePairs: identity.length,
      lookalikeRangePairs: lookalike.length,
      suspects: suspects.length,
      looStrong: strongHits.length,
      demotionIds: demote.length,
      proposedDemotions: proposed.length,
    },
    clonePairs: clones,
    identityRangePairs: identity,
    lookalikeRangePairs: lookalike.slice(0, 100),
    lookalikeRangePairCount: lookalike.length,
    suspects,
    loo: {
      identities: loo.identities,
      scored: loo.scored,
      refused: loo.refused,
      bands: loo.bands,
      quantiles: loo.quantiles,
      strongHits,
    },
    demotionIds: demote,
    proposedDemotions: proposed,
    recommendations: [
      clones.length > 0
        ? `CRITICAL: ${clones.length} exact/near-exact cross-id clones — review ${pairBandLabel("clone")}`
        : "No exact cross-id clones",
      identity.length > 0
        ? `HIGH: ${identity.length} identity-range pairs (d ≤ ${AUDIT_IDENTITY_MAX}) — likely donor clones / same-person collisions`
        : "No identity-range cross-id pairs",
      lookalike.length > 20
        ? `MED: ${lookalike.length} look-alike-range pairs (d ≤ ${AUDIT_LOOKALIKE_MAX}) — gallery is crowded, not necessarily a bug`
        : "Look-alike-range pair count modest",
      strongHits.length > 0
        ? `LOO strong-band ${strongHits.length}/${loo.scored} — inspect strongHits before calling them doppelgängers`
        : "No LOO strong-band hits",
      suspects.length > 0
        ? `MED: ${suspects.length} suspect vectors (padded FaceNet / low energy)`
        : "No suspect vectors",
      "Do not rewrite embeddings.v4.q8.bin from this report.",
      "Promote reviewed exact clones into public/celebs/gallery-demotions.json approved. Leave proposed unapplied. Do not dump identity-range ids into approved.",
    ],
  };

  const out = jsonOutPath();
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const proposedPath = proposedOutPath();
  if (proposedPath) {
    fs.mkdirSync(path.dirname(proposedPath), { recursive: true });
    fs.writeFileSync(
      proposedPath,
      JSON.stringify({ version: 1, approved: [], proposed }, null, 2),
    );
  }

  console.log("================================================================================");
  console.log("          TWINFRAME GALLERY QUALITY AUDIT (AdaFace-512 / AFv4)                  ");
  console.log("================================================================================");
  console.log(`dim=${header.dimension}  headerN=${header.vectorCount}  prototypes=${gallery.length}`);
  console.log(`clone pairs (d < ${AUDIT_CLONE_MAX}):     ${clones.length}`);
  console.log(`identity-range (d ≤ ${AUDIT_IDENTITY_MAX}):   ${identity.length}`);
  console.log(`look-alike-range (d ≤ ${AUDIT_LOOKALIKE_MAX}): ${lookalike.length}`);
  console.log(`suspects:                          ${suspects.length}`);
  console.log(
    `LOO strong:                        ${strongHits.length}/${loo.scored}  (weak=${loo.bands.weak} soft=${loo.bands.soft})`,
  );
  console.log(`demotion review ids:               ${demote.length}`);
  console.log(`proposed (clone / near-clone):     ${proposed.length}`);
  console.log("--------------------------------------------------------------------------------");
  console.log("Closest identity-range / clone pairs:");
  for (const p of [...clones, ...identity].slice(0, 12)) {
    console.log(
      `  ${p.a} ↔ ${p.b}  d=${p.distance.toFixed(4)}  ${p.band}`,
    );
  }
  console.log("--------------------------------------------------------------------------------");
  console.log("Recommendations:");
  for (const r of report.recommendations) console.log(`  • ${r}`);
  console.log(`\nWrote ${out}`);
  if (proposedPath) console.log(`Wrote proposed ${proposedPath}`);
}

main();
