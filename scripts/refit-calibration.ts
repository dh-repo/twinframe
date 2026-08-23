#!/usr/bin/env node --experimental-strip-types
/**
 * Refit the rank-1 calibration coefficients from the tracked held-out report
 * (reports/held-out-v2-baseline.json) and verify they match the constants
 * shipped in src/lib/face/calibration.ts.
 *
 * The fit is deterministic (fixed iterations/learning rate, standardized
 * two-feature logistic regression over raw cosine distances): features are
 * dTrue and the discriminative gap dBestWrong - dTrue, target is rank === 1.
 *
 * Run: node --experimental-strip-types scripts/refit-calibration.ts [--json]
 * Exits 1 if shipped coefficients drift beyond tolerance from the refit —
 * i.e. someone changed data or constants without re-fitting.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ITERATIONS = 6000;
const LR = 0.1;

function fit(data: Array<{ f1: number; f2: number; y: number }>) {
  const n = data.length;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / n;
  const pstdev = (xs: number[], mu: number) =>
    Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / n);
  const f1s = data.map((d) => d.f1);
  const f2s = data.map((d) => d.f2);
  const mu = [mean(f1s), mean(f2s)];
  const sd = [pstdev(f1s, mu[0]), pstdev(f2s, mu[1])];
  const Z = data.map((d) => [(d.f1 - mu[0]) / sd[0], (d.f2 - mu[1]) / sd[1], d.y]);
  const w = [0, 0, 0];
  for (let it = 0; it < ITERATIONS; it++) {
    const g = [0, 0, 0];
    for (const [z1, z2, y] of Z) {
      const p = 1 / (1 + Math.exp(-(w[0] + w[1] * z1 + w[2] * z2)));
      const e = p - y;
      g[0] += e;
      g[1] += e * z1;
      g[2] += e * z2;
    }
    for (let k = 0; k < 3; k++) w[k] -= (LR * g[k]) / n;
  }
  return { intercept: w[0], wDtrue: w[1], wGap: w[2], muDtrue: mu[0], muGap: mu[1], sdDtrue: sd[0], sdGap: sd[1] };
}

export function refitFromRecords(records: Array<{ dTrue: number | null; dBestWrong: number | null; rank: number }>) {
  const data = records
    .filter(
      (r) =>
        r.dTrue !== null && Number.isFinite(r.dTrue) &&
        r.dBestWrong !== null && Number.isFinite(r.dBestWrong),
    )
    .map((r) => ({
      f1: r.dTrue as number,
      f2: (r.dBestWrong as number) - (r.dTrue as number),
      y: r.rank === 1 ? 1 : 0,
    }));
  return fit(data);
}

function main() {
  const reportPath = path.join(ROOT, "reports/held-out-v2-baseline.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    records: Array<{ dTrue: number | null; dBestWrong: number | null; rank: number }>;
  };
  const refit = refitFromReport(report);
  const shippedModule = readShippedCoefficients();

  console.log("refit :", fmt(refit));
  console.log("shipped:", fmt(shippedModule));

  const tol = 0.05;
  let drift = false;
  for (const k of Object.keys(refit) as Array<keyof typeof refit>) {
    if (Math.abs(refit[k] - shippedModule[k]) > tol) {
      console.error(`DRIFT ${k}: refit ${refit[k].toFixed(4)} vs shipped ${shippedModule[k].toFixed(4)} (> ${tol})`);
      drift = true;
    }
  }
  if (drift) {
    console.error("\nShipped CALIBRATION_COEFFS no longer match the tracked eval data.");
    console.error("Re-fit and update src/lib/face/calibration.ts (and its version string).");
    process.exitCode = 1;
  } else {
    console.log("\ncalibration coefficients consistent with tracked data (tolerance 0.05)");
  }
}

function refitFromReport(report: { records: Array<{ dTrue: number | null; dBestWrong: number | null; rank: number }> }) {
  return refitFromRecords(report.records);
}

function readShippedCoefficients(): Record<string, number> {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/face/calibration.ts"), "utf8");
  const block = src.slice(src.indexOf("CALIBRATION_COEFFS = {"), src.indexOf("} as const"));
  const out: Record<string, number> = {};
  for (const m of block.matchAll(/(\w+):\s*(-?\d+\.\d+)/g)) {
    out[m[1]!] = Number(m[2]);
  }
  return out;
}

function fmt(c: Record<string, number>): string {
  return Object.entries(c)
    .map(([k, v]) => `${k}=${v.toFixed(4)}`)
    .join(" ");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
