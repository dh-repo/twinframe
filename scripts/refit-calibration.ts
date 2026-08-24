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
  // Honest generalization estimate: in-sample ECE is optimistic. Stratified
  // CV (n=301) measured logistic ~0.074 vs isotonic-stacked ~0.13 — isotonic
  // overfits and the <=0.02 aspiration needs a much larger probe population.
  const cvData = report.records
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
  const cv = crossValidate(cvData);
  console.log(
    `CV-ECE (honest): logistic ${cv.logisticCvEce.toFixed(4)} | isotonic ${cv.isotonicCvEce.toFixed(4)} — in-sample numbers above are optimistic`,
  );

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

/** Stratified 5-fold CV of the shipped method vs isotonic-stacked variant. */
export function crossValidate(data: Array<{ f1: number; f2: number; y: number }>): {
  logisticCvEce: number;
  isotonicCvEce: number;
} {
  const pos = data.filter((d) => d.y === 1);
  const neg = data.filter((d) => d.y === 0);
  const folds: Array<typeof data> = Array.from({ length: 5 }, () => []);
  for (const arr of [pos, neg]) arr.forEach((r, i) => folds[i % 5].push(r));

  function fitLogistic(rows: typeof data) {
    const n = rows.length;
    const mean = (i: number) => rows.reduce((a, r) => a + r[`f${i + 1}`], 0) / n;
    const mu = [mean(0), mean(1)];
    const sd = [0, 1].map((i) =>
      Math.sqrt(rows.reduce((a, r) => a + (r[`f${i + 1}`] - mu[i]) ** 2, 0) / n),
    );
    const w = [0, 0, 0];
    for (let it = 0; it < 6000; it++) {
      const g = [0, 0, 0];
      for (const r of rows) {
        const z1 = (r.f1 - mu[0]) / sd[0];
        const z2 = (r.f2 - mu[1]) / sd[1];
        const p = 1 / (1 + Math.exp(-(w[0] + w[1] * z1 + w[2] * z2)));
        const e = p - r.y;
        g[0] += e;
        g[1] += e * z1;
        g[2] += e * z2;
      }
      for (let k = 0; k < 3; k++) w[k] -= (0.1 * g[k]) / n;
    }
    return { w, mu, sd };
  }

  function logisticProb(m: { w: number[]; mu: number[]; sd: number[] }, f1: number, f2: number) {
    const z1 = (f1 - m.mu[0]) / m.sd[0];
    const z2 = (f2 - m.mu[1]) / m.sd[1];
    return Math.min(
      0.999,
      Math.max(0.001, 1 / (1 + Math.exp(-(m.w[0] + m.w[1] * z1 + m.w[2] * z2)))),
    );
  }

  function isotonicFit(pairs: Array<{ s: number; y: number }>) {
    const sorted = [...pairs].sort((a, b) => a.s - b.s);
    const blocks = sorted.map((p) => ({ s: p.s, sum: p.y, n: 1 }));
    for (let i = 0; i < blocks.length - 1;) {
      if (blocks[i].sum / blocks[i].n > blocks[i + 1].sum / blocks[i + 1].n) {
        blocks[i] = { s: blocks[i].s, sum: blocks[i].sum + blocks[i + 1].sum, n: blocks[i].n + blocks[i + 1].n };
        blocks.splice(i + 1, 1);
        if (i > 0) i--;
      } else i++;
    }
    return blocks;
  }

  function isoProb(blocks: Array<{ s: number; sum: number; n: number }>, s: number) {
    for (const b of blocks) if (s <= b.s) return Math.min(0.999, Math.max(0.001, b.sum / b.n));
    const last = blocks[blocks.length - 1]!;
    return Math.min(0.999, Math.max(0.001, last.sum / last.n));
  }

  function ece(pairs: Array<[number, number]>) {
    const bins = new Map<number, Array<[number, number]>>();
    for (const pair of pairs) {
      const b = Math.min(9, Math.floor(pair[0] * 10));
      if (!bins.has(b)) bins.set(b, []);
      bins.get(b)!.push(pair);
    }
    let total = 0;
    for (const bucket of bins.values()) {
      const conf = bucket.reduce((a, v) => a + v[0], 0) / bucket.length;
      const acc = bucket.reduce((a, v) => a + v[1], 0) / bucket.length;
      total += (bucket.length / pairs.length) * Math.abs(conf - acc);
    }
    return total;
  }

  let logPairs: Array<[number, number]> = [];
  let isoPairs: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const train = folds.filter((_, j) => j !== i).flat();
    const test = folds[i]!;
    const model = fitLogistic(train);
    const isoBlocks = isotonicFit(
      train.map((r) => ({ s: logisticProb(model, r.f1, r.f2), y: r.y })),
    );
    for (const r of test) {
      const p = logisticProb(model, r.f1, r.f2);
      logPairs.push([p, r.y]);
      isoPairs.push([isoProb(isoBlocks, p), r.y]);
    }
  }
  return { logisticCvEce: ece(logPairs), isotonicCvEce: ece(isoPairs) };
}
