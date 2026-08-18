#!/usr/bin/env tsx
/**
 * Held-out identity protocol — stratified, honest Rank-1 / Rank-5.
 *
 * Primary path scores the PRODUCT engine: EdgeFace-512 descriptors computed in
 * Node with the same SCRFD detect → 5-point align → embed pipeline the browser
 * runs (scripts/lib/probe-signals.mjs), ranked against the shipping AFv4
 * gallery (public/celebs/embeddings.v4.q8.bin) through the product's own
 * `rankByDescriptor`. Results are reported overall AND per hard-probe condition
 * from public/celebs/held-out/hard-probes.json, because one average over clean
 * frontal portraits is exactly the number that misleads.
 *
 * Protocol rules that keep the number honest:
 *   - Only slot 001 counts as held out. Slots 002+ are enrolled as extra gallery
 *     views (scripts/lib/enroll-jobs.mjs), so scoring them measures memorization.
 *     `--all-slots` includes them anyway, clearly marked, for diagnostics.
 *   - Age / gender priors are passed as unknown. Feeding the true celebrity's own
 *     age and gender into the query — as the previous version of this script did —
 *     leaks the label into the ranking.
 *   - Refusals (the product returning no match at all) count as misses and are
 *     reported separately, not quietly dropped.
 *   - Both numbers are reported: the product path (gates + priors) and the raw
 *     nearest-neighbour path (pure distance), so policy losses are visible.
 *
 * Usage:
 *   # small sanity run (~1s/probe on this CPU)
 *   node --experimental-strip-types scripts/evaluate-held-out.ts --limit 12 --concurrency 4
 *
 *   # full held-out set (203 probes, ~1 min at concurrency 4)
 *   node --experimental-strip-types scripts/evaluate-held-out.ts --concurrency 4
 *
 *   # legacy FaceNet-128 protocol (needs public/celebs/held-out/descriptors.json)
 *   node --experimental-strip-types scripts/evaluate-held-out.ts --legacy-facenet
 *
 * Flags: --limit N --concurrency N --all-slots --legacy-facenet --force
 *        --json <path> --md <path> --cache <path> --hard-probes <path>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARD_PROBE_CONDITIONS, hardProbeLabel } from "../src/lib/face/hard-probes.ts";
import type { HardProbeCondition } from "../src/lib/face/hard-probes.ts";
import {
  HILL_D0,
  HILL_N,
  cosineDistance,
  ensembleDistance,
  l2Normalize,
} from "../src/lib/face/embeddings.ts";
import type { CelebrityEmbedding } from "../src/lib/face/embeddings.ts";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { loadV4Gallery } from "./lib/v4-gallery.mjs";
import { mapProcessPool, parseConcurrencyArg } from "./lib/photo-pool.mjs";
import { SIGNALS_VERSION } from "./lib/probe-signals.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELD_OUT = path.join(ROOT, "public/celebs/held-out");
const MANIFEST = path.join(HELD_OUT, "manifest.json");
const HARD_PROBES = path.join(HELD_OUT, "hard-probes.json");
const WORKER = path.join(ROOT, "scripts/lib/probe-signals.worker.mjs");
const DEFAULT_CACHE = "/tmp/twinframe-heldout/edgeface-probes.json";
const DEFAULT_JSON = path.join(ROOT, "reports/held-out-accuracy.json");

export const REPORT_VERSION = "1.0.0";
/**
 * One catalog id is spelled two ways across the gallery files. Mirrors
 * CANONICAL_CELEB_MAP in scripts/evaluate-match-accuracy.ts, which cannot be
 * imported here because that module has a broken import of its own.
 */
export const CELEB_ID_ALIASES: Record<string, string> = {
  "gwenyth-paltrow": "gwyneth-paltrow",
};

export function canonicalCelebId(id: string): string {
  return CELEB_ID_ALIASES[id] ?? id;
}

/**
 * A "held-out" photo this close to its own gallery vector is the enrollment
 * photo again — usually the same Wikipedia file at another resolution, which the
 * fetcher's byte-level dedupe cannot see. Those probes score Rank-1 for free, so
 * the leak-free cohort is the number worth quoting.
 */
export const NEAR_DUPLICATE_MAX_DISTANCE = 0.05;

export function isNearDuplicate(genuineDistance: number | null): boolean {
  return genuineDistance !== null && genuineDistance <= NEAR_DUPLICATE_MAX_DISTANCE;
}

export function partitionLeakage<T extends { nearDuplicate: boolean }>(records: T[]) {
  return {
    clean: records.filter((r) => !r.nearDuplicate),
    leaked: records.filter((r) => r.nearDuplicate),
  };
}

/** Cohorts always reported, even at n=0, so a missing stratum stays visible. */
export const OVERALL_STRATUM = "overall";
export const EASY_STRATUM = "no-condition";

export interface ProbeRecord {
  imagePath: string;
  id: string;
  slot: string;
  conditions: HardProbeCondition[];
  detected: boolean;
  refused: boolean;
  /** True when the probe is the enrolled photo again (see NEAR_DUPLICATE_MAX_DISTANCE). */
  nearDuplicate: boolean;
  rank: number;
  topId: string | null;
  genuineDistance: number | null;
  impostorDistance: number | null;
  rawRank: number;
  matchPercent: number | null;
}

export interface RankStats {
  stratum: string;
  n: number;
  rank1: number;
  rank5: number;
  rank1Pct: number;
  rank5Pct: number;
  rank1Ci95: [number, number];
  rawRank1: number;
  rawRank1Pct: number;
  refused: number;
  refusedPct: number;
  detected: number;
  mrr: number;
}

/**
 * Wilson score interval for a binomial proportion, in percent. With 20-200
 * probes per stratum the normal approximation is not good enough to quote.
 */
export function wilsonInterval(hits: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const lo = Math.max(0, (centre - spread) / denom);
  const hi = Math.min(1, (centre + spread) / denom);
  return [round(lo * 100, 1), round(hi * 100, 1)];
}

export function computeRankStats(stratum: string, records: ProbeRecord[]): RankStats {
  const n = records.length;
  const rank1 = records.filter((r) => r.rank === 1).length;
  const rank5 = records.filter((r) => r.rank >= 1 && r.rank <= 5).length;
  const rawRank1 = records.filter((r) => r.rawRank === 1).length;
  const refused = records.filter((r) => r.refused).length;
  const detected = records.filter((r) => r.detected).length;
  const mrr = records.reduce((acc, r) => acc + (r.rank > 0 ? 1 / r.rank : 0), 0) / Math.max(1, n);
  return {
    stratum,
    n,
    rank1,
    rank5,
    rank1Pct: pct(rank1, n),
    rank5Pct: pct(rank5, n),
    rank1Ci95: wilsonInterval(rank1, n),
    rawRank1,
    rawRank1Pct: pct(rawRank1, n),
    refused,
    refusedPct: pct(refused, n),
    detected,
    mrr: round(mrr, 4),
  };
}

/** Overall + one cohort per condition + the "nothing fired" cohort. */
export function stratify(records: ProbeRecord[]): RankStats[] {
  const out: RankStats[] = [computeRankStats(OVERALL_STRATUM, records)];
  for (const condition of HARD_PROBE_CONDITIONS) {
    out.push(computeRankStats(condition, records.filter((r) => r.conditions.includes(condition))));
  }
  out.push(computeRankStats(EASY_STRATUM, records.filter((r) => r.conditions.length === 0)));
  return out;
}

export function distanceStats(values: number[]) {
  const clean = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return { n: 0, mean: null, p10: null, p50: null, p90: null };
  const q = (p: number) => clean[Math.min(clean.length - 1, Math.floor(p * clean.length))]!;
  return {
    n: clean.length,
    mean: round(clean.reduce((a, b) => a + b, 0) / clean.length, 4),
    p10: round(q(0.1), 4),
    p50: round(q(0.5), 4),
    p90: round(q(0.9), 4),
  };
}

function hillProbability(distance: number, d0: number, n: number): number {
  if (!Number.isFinite(distance)) return 0;
  const d = Math.max(0, distance);
  return 1 / (1 + Math.pow(d / d0, n));
}

/** Mean negative log-likelihood of "is this the right identity?" under a hill curve. */
export function hillLogLoss(genuine: number[], impostor: number[], d0: number, n: number): number {
  const eps = 1e-9;
  let sum = 0;
  let count = 0;
  for (const d of genuine) {
    sum += -Math.log(Math.max(eps, hillProbability(d, d0, n)));
    count++;
  }
  for (const d of impostor) {
    sum += -Math.log(Math.max(eps, 1 - hillProbability(d, d0, n)));
    count++;
  }
  return count === 0 ? Number.NaN : sum / count;
}

/** Distance where genuine-miss rate and impostor-accept rate cross. */
export function equalErrorDistance(genuine: number[], impostor: number[]) {
  const candidates = [...genuine, ...impostor].filter(Number.isFinite).sort((a, b) => a - b);
  if (candidates.length === 0 || genuine.length === 0 || impostor.length === 0) {
    return { distance: null, errorRate: null };
  }
  let best = { distance: candidates[0]!, gap: Number.POSITIVE_INFINITY, errorRate: 1 };
  for (const t of candidates) {
    const fnr = genuine.filter((d) => d > t).length / genuine.length;
    const fpr = impostor.filter((d) => d <= t).length / impostor.length;
    const gap = Math.abs(fnr - fpr);
    if (gap < best.gap) best = { distance: t, gap, errorRate: (fnr + fpr) / 2 };
  }
  return { distance: round(best.distance, 4), errorRate: round(best.errorRate * 100, 2) };
}

/**
 * Fit the hill percentage curve to the measured genuine / best-impostor
 * distances. The 1:1 sample ratio makes this the calibration of the question the
 * UI actually asks: "is the top match the right person?"
 */
export function fitHillConstants(genuine: number[], impostor: number[]) {
  const current = {
    d0: HILL_D0,
    n: HILL_N,
    logLoss: round(hillLogLoss(genuine, impostor, HILL_D0, HILL_N), 4),
  };
  if (genuine.length === 0 || impostor.length === 0) {
    return { current, fitted: null, eer: equalErrorDistance(genuine, impostor), verdict: "insufficient-data" };
  }

  let bestD0 = HILL_D0;
  let bestN = HILL_N;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let d0 = 0.3; d0 <= 1.2001; d0 += 0.01) {
    for (let n = 1; n <= 12.001; n += 0.1) {
      const loss = hillLogLoss(genuine, impostor, d0, n);
      if (loss < bestLoss) {
        bestLoss = loss;
        bestD0 = d0;
        bestN = n;
      }
    }
  }

  const fitted = { d0: round(bestD0, 3), n: round(bestN, 2), logLoss: round(bestLoss, 4) };
  // Held-d0 sweep: how much of the gain survives if only the exponent moves?
  const grid: Array<{ d0: number; n: number; logLoss: number }> = [];
  for (const d0 of [0.55, HILL_D0, 0.65]) {
    for (const n of [1.2, 1.4, 1.6, 2, 3, HILL_N]) {
      grid.push({ d0, n, logLoss: round(hillLogLoss(genuine, impostor, d0, n), 4) });
    }
  }

  // Below this the refit is noise on a two-hundred-probe sample, not a finding.
  const materialD0 = Math.abs(fitted.d0 - current.d0) > 0.05;
  const materialN = Math.abs(fitted.n - current.n) > 1.0;
  const materialLoss = current.logLoss - fitted.logLoss > 0.02;
  return {
    current,
    fitted,
    grid,
    eer: equalErrorDistance(genuine, impostor),
    verdict: (materialD0 || materialN) && materialLoss ? "recalibrate" : "keep-current",
  };
}

function pct(hits: number, n: number): number {
  return n === 0 ? 0 : round((hits / n) * 100, 1);
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

interface Options {
  limit: number;
  allSlots: boolean;
  legacyFacenet: boolean;
  force: boolean;
  json: string;
  markdown: string;
  cache: string;
  hardProbes: string;
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx < 0) return undefined;
    const value = argv[idx + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
    return value;
  };
  const limitRaw = flag("--limit");
  const limit = limitRaw === undefined ? Number.POSITIVE_INFINITY : Number(limitRaw);
  if (!Number.isFinite(limit) && limitRaw !== undefined) throw new Error(`Invalid --limit "${limitRaw}"`);
  const json = flag("--json") ? path.resolve(flag("--json")!) : DEFAULT_JSON;
  return {
    limit: limitRaw === undefined ? Number.POSITIVE_INFINITY : Math.floor(limit),
    allSlots: argv.includes("--all-slots"),
    legacyFacenet: argv.includes("--legacy-facenet"),
    force: argv.includes("--force"),
    json,
    markdown: flag("--md") ? path.resolve(flag("--md")!) : json.replace(/\.json$/, ".md"),
    cache: flag("--cache") ? path.resolve(flag("--cache")!) : DEFAULT_CACHE,
    hardProbes: flag("--hard-probes") ? path.resolve(flag("--hard-probes")!) : HARD_PROBES,
  };
}

interface ManifestCase {
  id: string;
  name: string;
  slot?: string;
  imagePath: string;
  evalSlot?: boolean;
}

/** Held-out probes to score: slot 001 only unless --all-slots. */
export function selectProbes(
  cases: ManifestCase[],
  options: { allSlots: boolean; limit: number },
): ManifestCase[] {
  const eligible = cases.filter((c) => options.allSlots || c.evalSlot === true || c.slot === "001");
  const sorted = [...eligible].sort(
    (a, b) => a.id.localeCompare(b.id) || (a.slot ?? "").localeCompare(b.slot ?? ""),
  );
  return Number.isFinite(options.limit) ? sorted.slice(0, options.limit) : sorted;
}

interface CacheEntry {
  fingerprint: string;
  descriptor512: number[];
  detected: boolean;
  signals: Record<string, number | boolean>;
}

async function embedProbes(
  probes: ManifestCase[],
  options: Options,
  concurrency: number,
): Promise<Map<string, CacheEntry>> {
  const cache = new Map<string, CacheEntry>(
    Object.entries(readJson<Record<string, CacheEntry>>(options.cache, {})),
  );
  const jobs: Array<{ imagePath: string; filePath: string; fingerprint: string }> = [];
  for (const probe of probes) {
    const filePath = path.join(ROOT, "public", probe.imagePath.replace(/^\//, ""));
    if (!fs.existsSync(filePath)) continue;
    const stat = fs.statSync(filePath);
    const fingerprint = `${SIGNALS_VERSION}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    const hit = cache.get(probe.imagePath);
    if (!options.force && hit?.fingerprint === fingerprint && hit.descriptor512?.length) continue;
    jobs.push({ imagePath: probe.imagePath, filePath, fingerprint });
  }

  console.log(
    `embedding: ${probes.length} probes (${probes.length - jobs.length} cached, ${jobs.length} to encode) concurrency=${concurrency}`,
  );

  if (jobs.length > 0) {
    const t0 = Date.now();
    const results = await mapProcessPool(
      jobs.map((j) => ({ filePath: j.filePath, embed: true })),
      {
        workerPath: WORKER,
        concurrency,
        onProgress(done: number, total: number) {
          if (done % 25 !== 0 && done !== total) return;
          const rate = done / Math.max(0.001, (Date.now() - t0) / 1000);
          process.stdout.write(`\r  ${done}/${total} (${rate.toFixed(1)}/s)`);
        },
      },
    );
    if (jobs.length >= 25) process.stdout.write("\n");
    for (let i = 0; i < jobs.length; i++) {
      const result = results[i] as { ok: boolean; value?: any; error?: string };
      const job = jobs[i]!;
      if (!result?.ok || !result.value?.descriptor512) {
        console.error(`  encode failed ${job.imagePath}: ${String(result?.error ?? "no descriptor").slice(0, 120)}`);
        continue;
      }
      cache.set(job.imagePath, {
        fingerprint: job.fingerprint,
        descriptor512: result.value.descriptor512,
        detected: result.value.usedDetection,
        signals: result.value.signals ?? {},
      });
    }
    fs.mkdirSync(path.dirname(options.cache), { recursive: true });
    fs.writeFileSync(options.cache, JSON.stringify(Object.fromEntries(cache)));
  }

  return cache;
}

function scoreEdgeFace(
  probes: ManifestCase[],
  cache: Map<string, CacheEntry>,
  gallery: any[],
  conditionsFor: (imagePath: string) => HardProbeCondition[],
): { records: ProbeRecord[]; skipped: string[] } {
  const galleryIds = new Set(gallery.map((g) => canonicalCelebId(g.id)));
  const records: ProbeRecord[] = [];
  const skipped: string[] = [];

  for (const probe of probes) {
    const entry = cache.get(probe.imagePath);
    const want = canonicalCelebId(probe.id);
    if (!entry) {
      skipped.push(`${probe.imagePath} (no descriptor)`);
      continue;
    }
    if (!galleryIds.has(want)) {
      skipped.push(`${probe.imagePath} (not enrolled)`);
      continue;
    }

    const descriptor = Float32Array.from(entry.descriptor512);
    const smileIntensity =
      typeof entry.signals?.smileIntensity === "number" ? (entry.signals.smileIntensity as number) : 0;
    // Age / gender deliberately unknown: the truth would leak the label.
    const matches = rankByDescriptor(
      {
        descriptor,
        age: Number.NaN,
        gender: "unknown",
        genderProbability: 0.5,
        smileIntensity,
      },
      gallery,
      5,
    );
    const rankedIds = matches.map((m) => canonicalCelebId(m.celebrityId));
    const rankIdx = rankedIds.indexOf(want);

    let genuine: number | null = null;
    let impostor: number | null = null;
    let betterThanTruth = 0;
    for (const row of gallery) {
      const d = cosineDistance(descriptor, row.descriptor);
      if (canonicalCelebId(row.id) === want) {
        genuine = genuine === null ? d : Math.min(genuine, d);
      } else if (impostor === null || d < impostor) {
        impostor = d;
      }
    }
    if (genuine !== null) {
      const seen = new Set<string>();
      for (const row of gallery) {
        const id = canonicalCelebId(row.id);
        if (id === want || seen.has(id)) continue;
        if (cosineDistance(descriptor, row.descriptor) < genuine) seen.add(id);
      }
      betterThanTruth = seen.size;
    }

    records.push({
      imagePath: probe.imagePath,
      id: want,
      slot: probe.slot ?? "001",
      conditions: conditionsFor(probe.imagePath),
      detected: entry.detected,
      refused: matches.length === 0,
      nearDuplicate: isNearDuplicate(genuine),
      rank: rankIdx >= 0 ? rankIdx + 1 : -1,
      topId: rankedIds[0] ?? null,
      genuineDistance: genuine === null ? null : round(genuine, 4),
      impostorDistance: impostor === null ? null : round(impostor, 4),
      rawRank: genuine === null ? -1 : betterThanTruth + 1,
      matchPercent: matches[0]?.matchPercent ?? null,
    });
  }

  return { records, skipped };
}

/** FaceNet-128 gallery (public/celebs/embeddings.json), legacy protocol only. */
function loadFacenetGallery(): CelebrityEmbedding[] {
  const file = path.join(ROOT, "public/celebs/embeddings.json");
  const pack = readJson<{ celebrities?: any[] }>(file, {});
  if (!pack.celebrities?.length) throw new Error(`no FaceNet gallery at ${path.relative(ROOT, file)}`);
  return pack.celebrities.map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path,
    path192: c.path192,
    fallbackPath: c.fallbackPath,
    descriptor: Array.from(l2Normalize(c.descriptor)),
    age: c.age ?? 40,
    gender: c.gender ?? "unknown",
    genderProb: c.genderProb ?? 0.9,
  })) as CelebrityEmbedding[];
}

/** Legacy FaceNet-128 protocol kept for continuity with the old numbers. */
function scoreLegacyFacenet(
  conditionsFor: (imagePath: string) => HardProbeCondition[],
  limit: number,
): { records: ProbeRecord[]; skipped: string[] } {
  const descPath = path.join(HELD_OUT, "descriptors.json");
  if (!fs.existsSync(descPath)) {
    throw new Error(
      `missing ${path.relative(ROOT, descPath)} — run node scripts/encode-held-out-browser.mjs first`,
    );
  }
  const pack = readJson<{ cases: Array<{ id: string; descriptor: number[] }> }>(descPath, { cases: [] });
  const gallery = loadFacenetGallery();
  const byId = new Map(gallery.map((g) => [canonicalCelebId(g.id), g]));
  const records: ProbeRecord[] = [];
  const skipped: string[] = [];

  for (const c of pack.cases.slice(0, Number.isFinite(limit) ? limit : pack.cases.length)) {
    const want = canonicalCelebId(c.id);
    const enrolled = byId.get(want);
    if (!c.descriptor || c.descriptor.length !== 128 || !enrolled) {
      skipped.push(`${c.id} (no 128-d descriptor or not enrolled)`);
      continue;
    }
    const matches = rankByDescriptor(
      {
        descriptor: Float32Array.from(c.descriptor),
        age: Number.NaN,
        gender: "unknown",
        genderProbability: 0.5,
      },
      gallery,
      5,
    );
    const rankedIds = matches.map((m) => canonicalCelebId(m.celebrityId));
    const rankIdx = rankedIds.indexOf(want);
    const imagePath = `/celebs/held-out/${c.id}/001.jpg`;
    records.push({
      imagePath,
      id: want,
      slot: "001",
      conditions: conditionsFor(imagePath),
      detected: true,
      refused: matches.length === 0,
      nearDuplicate: false,
      rank: rankIdx >= 0 ? rankIdx + 1 : -1,
      topId: rankedIds[0] ?? null,
      genuineDistance: round(ensembleDistance(c.descriptor, enrolled.descriptor), 4),
      impostorDistance: null,
      rawRank: -1,
      matchPercent: matches[0]?.matchPercent ?? null,
    });
  }
  return { records, skipped };
}

function strataTable(strata: RankStats[], labels: Record<string, string>): string[] {
  const lines = [
    "| Condition | n | Rank-1 | 95% CI | Rank-5 | Raw Rank-1 | Refused | Label source |",
    "| :--- | ---: | ---: | :---: | ---: | ---: | ---: | :--- |",
  ];
  for (const stratum of strata) {
    if (stratum.stratum === OVERALL_STRATUM) continue;
    const name =
      stratum.stratum === EASY_STRATUM
        ? "No condition fired"
        : hardProbeLabel(stratum.stratum as HardProbeCondition);
    const ci = stratum.n > 0 ? `${stratum.rank1Ci95[0]}\u2013${stratum.rank1Ci95[1]}%` : "\u2014";
    lines.push(
      `| ${name} | ${stratum.n} | ${stratum.n ? `${stratum.rank1Pct}%` : "\u2014"} | ${ci} | ${stratum.n ? `${stratum.rank5Pct}%` : "\u2014"} | ${stratum.n ? `${stratum.rawRank1Pct}%` : "\u2014"} | ${stratum.n ? `${stratum.refusedPct}%` : "\u2014"} | ${labels[stratum.stratum] ?? "\u2014"} |`,
    );
  }
  return lines;
}

function distanceTable(distances: Record<string, any>): string[] {
  const lines = [
    "| Distribution | n | mean | p10 | p50 | p90 |",
    "| :--- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [name, stats] of Object.entries(distances)) {
    lines.push(
      `| ${name} | ${stats.n} | ${stats.mean ?? "\u2014"} | ${stats.p10 ?? "\u2014"} | ${stats.p50 ?? "\u2014"} | ${stats.p90 ?? "\u2014"} |`,
    );
  }
  return lines;
}

function hillLines(title: string, hill: any): string[] {
  const lines = [`**${title}**`, ""];
  lines.push(
    `- current: \`HILL_D0 = ${hill.current.d0}\`, \`HILL_N = ${hill.current.n}\` \u2014 log-loss ${hill.current.logLoss}`,
  );
  if (hill.fitted) {
    lines.push(
      `- best fit: \`HILL_D0 = ${hill.fitted.d0}\`, \`HILL_N = ${hill.fitted.n}\` \u2014 log-loss ${hill.fitted.logLoss}`,
    );
    lines.push(
      `- equal-error distance ${hill.eer.distance ?? "\u2014"} at ${hill.eer.errorRate ?? "\u2014"}% error`,
    );
    if (hill.grid?.length) {
      lines.push("");
      lines.push("| HILL_D0 | HILL_N | log-loss |");
      lines.push("| ---: | ---: | ---: |");
      for (const cell of hill.grid as Array<{ d0: number; n: number; logLoss: number }>) {
        lines.push(`| ${cell.d0} | ${cell.n} | ${cell.logLoss} |`);
      }
      lines.push("");
    }
  }
  lines.push(`- verdict: **${hill.verdict}**`);
  return lines;
}

export function formatMarkdownReport(report: any): string {
  const strata: RankStats[] = report.strata;
  const overall = strata.find((s) => s.stratum === OVERALL_STRATUM)!;
  const cleanStrata: RankStats[] | undefined = report.strataExcludingNearDuplicates;
  const cleanOverall = cleanStrata?.find((s) => s.stratum === OVERALL_STRATUM);
  const labels = report.conditionProvenance as Record<string, string>;
  const leakage = report.leakage;
  const lines: string[] = [];

  lines.push("# Twinframe held-out accuracy (stratified)");
  lines.push("");
  lines.push(`**Generated** ${report.generatedAt}  `);
  lines.push(`**Engine** ${report.engine}  `);
  lines.push(`**Gallery** ${report.gallerySize} vectors / ${report.galleryIdentities} identities  `);
  lines.push(`**Probes** ${overall.n} held-out photos (slot ${report.slots})  `);
  lines.push("");
  lines.push(
    "Held-out means the photo was never enrolled: a different Wikipedia/Commons image of the same person. Age and gender priors are passed as unknown, because feeding the query the true celebrity's own age and gender leaks the label. Refusals \u2014 the product declining to show any match \u2014 count as misses.",
  );
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push("| Cohort | Probes | Rank-1 | 95% CI | Rank-5 | Refused |");
  lines.push("| :--- | ---: | ---: | :---: | ---: | ---: |");
  if (cleanOverall) {
    lines.push(
      `| **Held out for real** (near-duplicates removed) | ${cleanOverall.n} | **${cleanOverall.rank1Pct}%** | ${cleanOverall.rank1Ci95[0]}\u2013${cleanOverall.rank1Ci95[1]}% | ${cleanOverall.rank5Pct}% | ${cleanOverall.refusedPct}% |`,
    );
  }
  lines.push(
    `| Every probe on disk (leakage included) | ${overall.n} | ${overall.rank1Pct}% | ${overall.rank1Ci95[0]}\u2013${overall.rank1Ci95[1]}% | ${overall.rank5Pct}% | ${overall.refusedPct}% |`,
  );
  lines.push("");
  if (leakage && leakage.count > 0) {
    lines.push(
      `${leakage.count} of ${overall.n} probes (${leakage.pct}%) sit within cosine distance ${leakage.maxDistance} of their own gallery vector: the same source photo at another resolution, which the fetcher's byte-level dedupe cannot detect. Every one of them scores Rank-1 for free, so the first row is the number to quote.`,
    );
    lines.push("");
  }
  lines.push(
    `Raw nearest-neighbour Rank-1 (no gates, no priors): ${overall.rawRank1Pct}% over all probes${
      cleanOverall ? `, ${cleanOverall.rawRank1Pct}% with near-duplicates removed` : ""
    }.`,
  );
  lines.push("");
  lines.push("## Per hard-probe condition");
  lines.push("");
  if (cleanStrata) {
    lines.push("Near-duplicates removed (the honest view):");
    lines.push("");
    lines.push(...strataTable(cleanStrata, labels));
    lines.push("");
  }
  lines.push("All probes on disk, leakage included:");
  lines.push("");
  lines.push(...strataTable(strata, labels));
  lines.push("");
  lines.push(
    "Cohorts overlap \u2014 a probe can be dark and turned away at once \u2014 and every cohort is a subset of the same held-out set, so the strata are not independent samples. `glasses` has no automated signal and stays at n=0 until someone hand-labels it.",
  );
  lines.push("");
  lines.push("## Distance distributions");
  lines.push("");
  lines.push(...distanceTable(report.distances));
  if (report.distancesExcludingNearDuplicates) {
    lines.push("");
    lines.push("Near-duplicates removed:");
    lines.push("");
    lines.push(...distanceTable(report.distancesExcludingNearDuplicates));
  }
  lines.push("");
  lines.push("## Hill calibration (HILL_D0 / HILL_N)");
  lines.push("");
  lines.push(
    "Fitted by minimising the log-loss of \"is the top match the right person?\" over genuine vs best-impostor distances (a 1:1 sample, matching the question the UI asks).",
  );
  lines.push("");
  if (report.hillExcludingNearDuplicates) {
    lines.push(...hillLines("Near-duplicates removed (use this one)", report.hillExcludingNearDuplicates));
    lines.push("");
  }
  lines.push(...hillLines("All probes, leakage included", report.hill));
  lines.push("");
  lines.push("## Misses");
  lines.push("");
  if (report.misses.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Probe | Conditions | Shown top match | Raw rank of truth |");
    lines.push("| :--- | :--- | :--- | ---: |");
    for (const miss of report.misses.slice(0, 30)) {
      lines.push(
        `| ${miss.id} (${miss.slot}) | ${miss.conditions.join(", ") || "\u2014"} | ${miss.topId ?? "refused"} | ${miss.rawRank > 0 ? miss.rawRank : "\u2014"} |`,
      );
    }
    if (report.misses.length > 30) {
      lines.push("");
      lines.push(`\u2026and ${report.misses.length - 30} more (see the JSON).`);
    }
  }
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  for (const command of report.commands as string[]) lines.push(command);
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv);
  const concurrency = parseConcurrencyArg();

  const hardProbeFile = readJson<{
    signalsVersion?: string;
    autoDerivedConditions?: string[];
    lowConfidenceConditions?: string[];
    manualOnlyConditions?: string[];
    probes?: Record<string, { conditions?: HardProbeCondition[] }>;
  }>(options.hardProbes, {});
  const labelled = hardProbeFile.probes ?? {};
  if (Object.keys(labelled).length === 0) {
    console.warn(
      `no hard-probe labels at ${path.relative(ROOT, options.hardProbes)} — run scripts/label-hard-probes.mjs for stratified numbers`,
    );
  }
  const conditionsFor = (imagePath: string): HardProbeCondition[] =>
    labelled[imagePath]?.conditions ?? [];

  const conditionProvenance: Record<string, string> = {
    [EASY_STRATUM]: "derived",
  };
  for (const condition of HARD_PROBE_CONDITIONS) {
    conditionProvenance[condition] = (hardProbeFile.manualOnlyConditions ?? []).includes(condition)
      ? "manual labels only"
      : (hardProbeFile.lowConfidenceConditions ?? []).includes(condition)
        ? "auto (low-confidence proxy)"
        : "auto (SCRFD geometry)";
  }

  let records: ProbeRecord[];
  let skipped: string[];
  let engine: string;
  let gallerySize = 0;
  let galleryIdentities = 0;
  let slots = options.allSlots ? "001+002…(includes enrolled views)" : "001 only";

  if (options.legacyFacenet) {
    engine = "FaceNet-128 (legacy protocol, browser-encoded descriptors.json)";
    const scored = scoreLegacyFacenet(conditionsFor, options.limit);
    records = scored.records;
    skipped = scored.skipped;
    const gallery = loadFacenetGallery();
    gallerySize = gallery.length;
    galleryIdentities = new Set(gallery.map((g) => canonicalCelebId(g.id))).size;
    slots = "001 only";
  } else {
    engine = "EdgeFace-512 + SCRFD-2.5G (shipping AFv4 gallery)";
    const manifest = readJson<{ cases?: ManifestCase[] }>(MANIFEST, { cases: [] });
    const cases = manifest.cases ?? [];
    if (cases.length === 0) {
      console.log(
        `no held-out manifest at ${path.relative(ROOT, MANIFEST)} — run scripts/fetch-held-out-photos.ts --manifest-only`,
      );
      process.exit(0);
    }
    const probes = selectProbes(cases, { allSlots: options.allSlots, limit: options.limit });
    const { gallery } = loadV4Gallery(ROOT);
    gallerySize = gallery.length;
    galleryIdentities = new Set(gallery.map((g: any) => canonicalCelebId(g.id))).size;
    const cache = await embedProbes(probes, options, concurrency);
    const scored = scoreEdgeFace(probes, cache, gallery, conditionsFor);
    records = scored.records;
    skipped = scored.skipped;
  }

  const strata = stratify(records);
  const genuine = records.map((r) => r.genuineDistance).filter((d): d is number => d !== null);
  const impostor = records.map((r) => r.impostorDistance).filter((d): d is number => d !== null);
  const { clean, leaked } = partitionLeakage(records);
  const cleanGenuine = clean.map((r) => r.genuineDistance).filter((d): d is number => d !== null);
  const cleanImpostor = clean.map((r) => r.impostorDistance).filter((d): d is number => d !== null);
  const report = {
    version: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    engine,
    signalsVersion: SIGNALS_VERSION,
    hardProbeSignalsVersion: hardProbeFile.signalsVersion ?? null,
    gallerySize,
    galleryIdentities,
    slots,
    labelledImages: Object.keys(labelled).length,
    conditionProvenance,
    strata,
    distances: {
      "genuine (probe → own identity)": distanceStats(genuine),
      "impostor (probe → best other identity)": distanceStats(impostor),
    },
    hill: fitHillConstants(genuine, impostor),
    leakage: {
      maxDistance: NEAR_DUPLICATE_MAX_DISTANCE,
      count: leaked.length,
      pct: pct(leaked.length, records.length),
      note: "Probes whose distance to their own gallery vector is <= maxDistance are the enrolled photo again (same source file at another resolution). They score Rank-1 for free.",
      ids: leaked.map((r) => r.id),
    },
    strataExcludingNearDuplicates: stratify(clean),
    distancesExcludingNearDuplicates: {
      "genuine (probe → own identity)": distanceStats(cleanGenuine),
      "impostor (probe → best other identity)": distanceStats(cleanImpostor),
    },
    hillExcludingNearDuplicates: fitHillConstants(cleanGenuine, cleanImpostor),
    misses: records
      .filter((r) => r.rank !== 1)
      .map((r) => ({
        id: r.id,
        slot: r.slot,
        conditions: r.conditions,
        topId: r.topId,
        refused: r.refused,
        rawRank: r.rawRank,
        genuineDistance: r.genuineDistance,
        impostorDistance: r.impostorDistance,
      })),
    skipped,
    commands: [
      "node --experimental-strip-types scripts/label-hard-probes.mjs --concurrency 4",
      `node --experimental-strip-types scripts/evaluate-held-out.ts --concurrency ${concurrency}${options.allSlots ? " --all-slots" : ""}`,
    ],
    records,
  };

  fs.mkdirSync(path.dirname(options.json), { recursive: true });
  fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  fs.mkdirSync(path.dirname(options.markdown), { recursive: true });
  fs.writeFileSync(options.markdown, formatMarkdownReport(report));

  const overall = strata[0]!;
  const cleanStrata = report.strataExcludingNearDuplicates;
  const cleanOverall = cleanStrata?.[0];
  console.log("");
  console.log(`engine: ${engine}`);
  console.log(`probes: ${overall.n} (slots: ${slots})  gallery: ${gallerySize} vectors`);
  if (cleanOverall && report.leakage.count > 0) {
    console.log(
      `near-duplicate leakage: ${report.leakage.count}/${overall.n} probes (${report.leakage.pct}%) are the enrolled photo again`,
    );
    console.log(
      `HONEST Rank-1 (leak-free): ${cleanOverall.rank1Pct}% (${cleanOverall.rank1}/${cleanOverall.n})  95% CI ${cleanOverall.rank1Ci95[0]}–${cleanOverall.rank1Ci95[1]}%`,
    );
    console.log(`HONEST Rank-5 (leak-free): ${cleanOverall.rank5Pct}% (${cleanOverall.rank5}/${cleanOverall.n})`);
  }
  console.log(
    `all probes Rank-1: ${overall.rank1Pct}% (${overall.rank1}/${overall.n})  95% CI ${overall.rank1Ci95[0]}–${overall.rank1Ci95[1]}%`,
  );
  console.log(`all probes Rank-5: ${overall.rank5Pct}% (${overall.rank5}/${overall.n})`);
  console.log(`raw NN Rank-1: ${overall.rawRank1Pct}%   refused: ${overall.refusedPct}%`);
  for (const stratum of (cleanStrata ?? strata).slice(1)) {
    if (stratum.n === 0) {
      console.log(`  ${stratum.stratum.padEnd(14)} n=0  (no labelled probes)`);
      continue;
    }
    console.log(
      `  ${stratum.stratum.padEnd(14)} n=${String(stratum.n).padStart(3)}  Rank-1 ${String(stratum.rank1Pct).padStart(5)}%  Rank-5 ${String(stratum.rank5Pct).padStart(5)}%`,
    );
  }
  if (skipped.length) console.log(`skipped: ${skipped.length} probes (see report)`);
  console.log(`wrote ${path.relative(ROOT, options.json)} + ${path.relative(ROOT, options.markdown)}`);
}

if (process.argv[1] && process.argv[1].endsWith("evaluate-held-out.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
