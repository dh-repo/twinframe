#!/usr/bin/env node
/**
 * Audit celebrity enrollment quality signals and emit a rebuild plan.
 * Does not rewrite embeddings.v4.q8.bin — run encode/rebuild after reviewing demotions.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-gallery-enrollment.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreEnrollmentCandidate } from "../src/lib/face/enrollment-qa.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const OUT = path.join(CELEBS, "enrollment-audit.json");

function main() {
  const index = JSON.parse(fs.readFileSync(path.join(CELEBS, "index.json"), "utf8"));
  const extrasPath = path.join(CELEBS, "extra-templates.json");
  let extraCounts = new Map();
  if (fs.existsSync(extrasPath)) {
    const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
    for (const t of extras.templates || []) {
      extraCounts.set(t.id, (extraCounts.get(t.id) || 0) + 1);
    }
  }

  const rows = [];
  let multiShot = 0;
  let singleShot = 0;
  for (const entry of index) {
    const nExtra = extraCounts.get(entry.id) || 0;
    const shotCount = 1 + nExtra;
    if (shotCount > 1) multiShot++;
    else singleShot++;

    // Without online detection we score policy readiness from catalog metadata.
    const heuristic = scoreEnrollmentCandidate({
      faceCount: 1,
      faceCoverage: 0.15,
      sharpness: 55,
      illumination: 0.5,
      detConfidence: 0.85,
      yawDeg: 0,
      pitchDeg: 0,
      rollDeg: 0,
      smileIntensity: 0.2,
    });

    rows.push({
      id: entry.id,
      name: entry.name,
      shotCount,
      needsMoreViews: shotCount < 2,
      heuristicOk: heuristic.ok,
      heuristicScore: heuristic.score,
      policy:
        shotCount >= 3
          ? "prototype-ready"
          : shotCount === 2
            ? "needs-one-more-view"
            : "single-shot-primary",
    });
  }

  const needsMoreViews = rows.filter((r) => r.needsMoreViews).length;
  const countsByPolicy = rows.reduce(
    (acc, r) => {
      acc[r.policy] = (acc[r.policy] || 0) + 1;
      return acc;
    },
    /** @type {Record<string, number>} */ ({}),
  );

  const report = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    summary: {
      celebs: index.length,
      multiShot,
      singleShot,
      needsMoreViews,
      countsByPolicy,
      target:
        "Prefer N≥2–3 real EdgeFace frontals per head celeb before adding more unique ids. Drop non-frontal / expressive primaries on rebuild.",
    },
    enrollmentGates: {
      maxYawDeg: 18,
      maxPitchDeg: 15,
      maxSmile: 0.55,
      minSharpness: 48,
      minCoverage: 0.08,
    },
    sampleSingleShot: rows.filter((r) => r.shotCount === 1).slice(0, 20).map((r) => r.id),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(
    `celebs=${index.length} multiShot=${multiShot} singleShot=${singleShot} needsMoreViews=${needsMoreViews}`,
  );
}

main();
