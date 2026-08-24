#!/usr/bin/env node --experimental-strip-types
/**
 * Failure forensics over the tracked held-out report.
 *
 * Categorizes every non-rank-1 probe so improvement work targets measured
 * failure modes instead of vibes:
 *
 *   refusal   — matcher returned no candidate (distance gate)
 *   crowd-out — true identity lost by < CROWD_OUT_COSINE (ranking noise)
 *   mid-miss  — true identity within presentable range but beaten clearly
 *   far-miss  — true identity sits beyond the floor entirely (coverage/pose)
 *
 * Enriches crowd-outs with appearance-family overlap between the probe's
 * celebrity and the winner, quantifying exactly what a family tie-breaker
 * would and would not fix.
 *
 * Run: node --experimental-strip-types scripts/analyze-failures.ts [--json reports/failure-analysis.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const CROWD_OUT_COSINE = 0.02;
const FLOOR = 0.72;

const reportPath = path.join(ROOT, "reports/held-out-v2-baseline.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
  records: Array<{
    id: string;
    rank: number;
    top1: string;
    dTrue: number | null;
    dBestWrong: number | null;
    rank?: never;
  }>;
};

let families: Record<string, string> = {};
const famPath = path.join(CELEBS, "appearance-families.json");
if (fs.existsSync(famPath)) {
  families = JSON.parse(fs.readFileSync(famPath, "utf8")) as Record<string, string>;
}

type Cat = "refusal" | "crowd-out" | "mid-miss" | "far-miss";

interface MissRow {
  id: string;
  category: Cat;
  winner: string;
  dTrue: number | null;
  margin: number | null;
  familyFixable: boolean | null;
  probeFamily: string | null;
  winnerFamily: string | null;
}

const misses: MissRow[] = [];
let hits = 0;

for (const r of report.records) {
  if (r.rank === 1) {
    hits++;
    continue;
  }
  const dTrue = r.dTrue ?? null;
  const bw = r.dBestWrong ?? null;
  let cat: Cat;
  if (r.dTop1 === null || bw === null || !Number.isFinite(bw)) {
    cat = "refusal";
  } else if (dTrue !== null && dTrue > FLOOR) {
    cat = "far-miss";
  } else if (bw - dTrue! < CROWD_OUT_COSINE) {
    cat = "crowd-out";
  } else {
    cat = "mid-miss";
  }
  const probeFamily = families[r.id] ?? null;
  const winnerFamily = families[r.top1] ?? null;
  const familyFixable =
    cat === "crowd-out" && probeFamily !== null && probeFamily !== winnerFamily;
  misses.push({
    id: r.id,
    category: cat,
    winner: r.top1,
    dTrue,
    margin: bw === null || dTrue === null ? null : bw - dTrue!,
    familyFixable,
    probeFamily,
    winnerFamily,
  });
}

const byCat = (c: Cat) => misses.filter((m) => m.category === c);
const n = hits + misses.length;
const familyFixableCount = byCat("crowd-out").filter((m) => m.familyFixable).length;
const familySameCount = byCat("crowd-out").filter(
  (m) => m.probeFamily !== null && m.probeFamily === m.winnerFamily,
).length;

console.log("=".repeat(72));
console.log("  HELD-OUT FAILURE ANALYSIS");
console.log("=".repeat(72));
console.log(`  probes ${n} | hits ${hits} (${((hits / n) * 100).toFixed(1)}%) | misses ${misses.length}`);
for (const c of ["refusal", "crowd-out", "mid-miss", "far-miss"] as Cat[]) {
  console.log(`  ${c.padEnd(10)} ${String(byCat(c).length).padStart(3)}`);
}
console.log("");
console.log(
  `  crowd-outs where appearance-family tie-break applies (families known & differ): ` +
    `${familyFixableCount}/${byCat("crowd-out").length}`,
);
console.log(`  crowd-outs where families match (tie-break would NOT help): ${familySameCount}`);
console.log(`  crowd-outs with unknown family for either side: ${
  byCat("crowd-out").filter((m) => m.probeFamily === null || m.winnerFamily === null).length
}`);

const jsonArg = process.argv.indexOf("--json");
if (jsonArg >= 0) {
  const out = process.argv[jsonArg + 1]!;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        probes: n,
        hits,
        summary: Object.fromEntries(
          ["refusal", "crowd-out", "mid-miss", "far-miss"].map((c) => [
            c,
            byCat(c as Cat).length,
          ]),
        ),
        crowdOutFamilyTieBreakApplicable: familyFixableCount,
        crowdOutFamiliesMatch: familySameCount,
        misses,
      },
      null,
      1,
    ),
  );
  console.log(`\n  report: ${path.relative(ROOT, out)}`);
}
