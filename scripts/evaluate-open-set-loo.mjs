#!/usr/bin/env node
/**
 * Leave-one-out open-set probe: each gallery identity is ranked against every
 * other identity. This is the product task (probe not enrolled), not closed-set
 * Top-1. Reports distance / margin / honesty-band distributions so calibration
 * changes can be judged without a human-ranked civilian set.
 *
 * Usage:
 *   node --experimental-strip-types scripts/evaluate-open-set-loo.mjs
 *   node --experimental-strip-types scripts/evaluate-open-set-loo.mjs --json
 *   node --experimental-strip-types scripts/evaluate-open-set-loo.mjs --json public/celebs/open-set-loo.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadV4Gallery, runLeaveOneOut } from "./lib/v4-gallery.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function jsonOutPath() {
  const idx = process.argv.indexOf("--json");
  if (idx < 0) return null;
  const next = process.argv[idx + 1];
  if (next && !next.startsWith("-")) return path.resolve(next);
  return path.join(CELEBS, "open-set-loo.json");
}

function main() {
  const { gallery } = loadV4Gallery(ROOT);
  const report = runLeaveOneOut(gallery);
  const n = report.identities;
  const scored = report.scored;
  const { bands, quantiles } = report;

  console.log("================================================================================");
  console.log("     TWINFRAME OPEN-SET LEAVE-ONE-OUT (gallery identity as civilian proxy)     ");
  console.log("================================================================================");
  console.log(
    `identities=${n}  scored=${scored}  refused=${report.refused} (${((report.refused / n) * 100).toFixed(1)}%)`,
  );
  console.log(
    `bands  weak=${bands.weak} (${((bands.weak / Math.max(1, scored)) * 100).toFixed(1)}%)  ` +
      `soft=${bands.soft} (${((bands.soft / Math.max(1, scored)) * 100).toFixed(1)}%)  ` +
      `strong=${bands.strong} (${((bands.strong / Math.max(1, scored)) * 100).toFixed(1)}%)`,
  );
  console.log(
    `display%  p10=${quantiles.displayPercent.p10.toFixed(1)}  p50=${quantiles.displayPercent.p50.toFixed(1)}  p90=${quantiles.displayPercent.p90.toFixed(1)}`,
  );
  console.log(
    `hill%     p10=${quantiles.hillPercent.p10.toFixed(1)}  p50=${quantiles.hillPercent.p50.toFixed(1)}  p90=${quantiles.hillPercent.p90.toFixed(1)}`,
  );
  console.log(
    `margin    p10=${quantiles.margin.p10.toFixed(3)}  p50=${quantiles.margin.p50.toFixed(3)}  p90=${quantiles.margin.p90.toFixed(3)}`,
  );
  if (Number.isFinite(quantiles.distance.p50)) {
    console.log(
      `distance  p10=${quantiles.distance.p10.toFixed(3)}  p50=${quantiles.distance.p50.toFixed(3)}  p90=${quantiles.distance.p90.toFixed(3)}`,
    );
  }
  console.log(
    `strong-band rate should stay low: this set is enrolled celebs held out, not true civilians, so some soft/strong is expected.`,
  );

  const out = jsonOutPath();
  if (out) {
    const payload = {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      identities: report.identities,
      scored: report.scored,
      refused: report.refused,
      bands: report.bands,
      quantiles: report.quantiles,
      strongHits: report.hits.filter((h) => h.band === "strong"),
    };
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
    console.log(`wrote ${out}`);
  }
}

main();
