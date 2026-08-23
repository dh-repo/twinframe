#!/usr/bin/env node --experimental-strip-types
/**
 * Tier-probe pipeline-parity check.
 *
 * The legacy scripts/evaluate-accuracy.mjs embeds probes with face-api inside
 * node — a THIRD geometry distinct from both the browser query path and the
 * enrollment binary. This script instead scores browser-encoded portraits
 * (encoded through the exact live SCRFD -> align -> EdgeFace path by
 * scripts/encode-held-out-browser.mjs against /celebs/tier-manifest.json)
 * against the shipped gallery using the real rankByDescriptor.
 *
 * Because each probe IS its celeb's enrolled portrait, this measures
 * enroll/query consistency (alignment + embedding parity), not real-world
 * accuracy — a high ceiling is expected and a low value indicates the live
 * pipeline has drifted from how the gallery was enrolled.
 *
 * Run: node --experimental-strip-types scripts/evaluate-tier-parity.ts \
 *        [--descriptors public/celebs/tier-descriptors.json] [--floor 90] [--json out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { loadGallery } from "./evaluate-held-out-v2.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function main() {
  const arg = (name: string, fallback?: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const descriptorsPath = path.resolve(ROOT, arg("--descriptors", "public/celebs/tier-descriptors.json")!);
  const floor = Number(arg("--floor", "90"));
  const jsonOut = arg("--json");

  const gallery = loadGallery();
  const pack = JSON.parse(fs.readFileSync(descriptorsPath, "utf8")) as {
    model?: string;
    cases: Array<{ id: string; descriptor: number[]; ok?: boolean }>;
  };

  const usable = pack.cases.filter((c) => c.ok !== false && c.descriptor?.length);
  const badDim = usable.filter((c) => c.descriptor.length !== gallery[0]!.descriptor.length);
  if (badDim.length) {
    throw new Error(
      `${badDim.length}/${usable.length} tier probes are ${badDim[0]!.descriptor.length}-d but gallery is ` +
        `${gallery[0]!.descriptor.length}-d — re-encode via scripts/encode-held-out-browser.mjs`,
    );
  }

  let rank1 = 0;
  let rank5 = 0;
  let mrr = 0;
  const misses: Array<{ id: string; top1: string }> = [];
  for (const c of usable) {
    const matches = rankByDescriptor(
      { descriptor: Float32Array.from(c.descriptor), age: NaN, gender: "unknown", genderProbability: 0 },
      gallery,
      5,
    );
    const rank = matches.findIndex((m) => m.celebrityId === c.id) + 1;
    if (rank === 1) rank1++;
    if (rank >= 1 && rank <= 5) rank5++;
    if (rank > 0) mrr += 1 / rank;
    else misses.push({ id: c.id, top1: matches[0]?.celebrityId ?? "(refused)" });
  }
  const n = usable.length;
  const top1Pct = n ? (rank1 / n) * 100 : 0;
  const top5Pct = n ? (rank5 / n) * 100 : 0;
  const mrrNorm = n ? mrr / n : 0;

  console.log("=".repeat(72));
  console.log("  TWINFRAME TIER-PARITY — browser-encoded portraits vs shipped gallery");
  console.log("=".repeat(72));
  console.log(`  encoder: ${pack.model ?? "unknown"} | probes: ${n} | gallery: ${gallery.length}`);
  console.log(`  Top-1: ${top1Pct.toFixed(1)}%  Top-5: ${top5Pct.toFixed(1)}%  MRR: ${mrrNorm.toFixed(3)}`);
  if (misses.length) {
    console.log("  misses:", misses.slice(0, 10).map((m) => `${m.id}->${m.top1}`).join(", "));
  }
  const ok = n > 0 && top1Pct >= floor;
  console.log(`  floor check: ${ok ? "PASS" : "FAIL"} (${top1Pct.toFixed(1)}% vs >= ${floor}%)`);
  if (!ok) process.exitCode = 1;

  if (jsonOut) {
    fs.writeFileSync(
      jsonOut,
      JSON.stringify({ at: new Date().toISOString(), encoder: pack.model ?? "unknown", n, top1Pct, top5Pct, mrr: mrrNorm, misses }, null, 1),
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
