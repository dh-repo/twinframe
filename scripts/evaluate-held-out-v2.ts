#!/usr/bin/env node --experimental-strip-types
/**
 * Honest held-out Rank-1 protocol (v2).
 *
 * Scores browser-encoded held-out descriptors (public/celebs/held-out/descriptors.json)
 * against the exact gallery the browser loads (v4 q8 binary + extra-templates merge)
 * using the real matcher (rankByDescriptor). No ground-truth attribute cheating:
 * query age/gender come from the recorded ageGenderNet predictions on the probe photo,
 * which is what the live pipeline would produce.
 *
 * Leakage rule (v2.1): any probe whose source file also contributed to ANY gallery
 * artifact (v4 bucket portrait, index.json entry, or extra-template source) is excluded
 * from the headline metrics and reported separately. Scoring a probe against its own
 * enrollment image is leakage, not accuracy. Run with --include-leaked to reproduce
 * the old contaminated number for comparison.
 *
 * Margin semantics: dTop1 is the raw cosine distance of the bucket rankByDescriptor
 * selected (best prior-adjusted); dMinSameId is the min RAW cosine across that celeb's
 * buckets. margin = dTop1 - dMinSameId >= 0 measures how much age/gender priors shifted
 * the within-id bucket choice; it is never negative by construction.
 *
 * Run: node --experimental-strip-types scripts/evaluate-held-out-v2.ts [--json reports/x.json] [--include-leaked]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyAppearanceFamilyManifest } from "../src/lib/celebrities/appearance-family.ts";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { l2Normalize, cosineDistance } from "../src/lib/face/embeddings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

export function normalizeSource(source: string): string {
  let s = String(source).trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* malformed escapes compare literally */
  }
  return s
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase()
    .replace(/^\/?(celebs\/)?/, "");
}

interface GalleryEntry {
  id: string;
  name: string;
  path: string;
  descriptor: Float32Array;
  age: number;
  gender: "male" | "female";
  genderProb: number;
}

export interface HeldOutCase {
  id: string;
  name?: string;
  descriptor: number[];
  age?: number;
  gender?: "male" | "female";
  genderProb?: number;
  ok?: boolean;
  source?: string;
}

let GALLERY_DIM = 512;

/**
 * Catalog ids that are the same person. Rank-1 is valid if the matcher returns
 * either spelling — `penelope-cruz-m` is a duplicate slot of Penélope Cruz.
 */
export const IDENTITY_ALIASES: Record<string, readonly string[]> = {
  "penelope-cruz-m": ["penelope-cruz"],
  "penelope-cruz": ["penelope-cruz-m"],
};

export function idsMatchHeldOut(probeId: string, galleryId: string): boolean {
  if (probeId === galleryId) return true;
  return (IDENTITY_ALIASES[probeId] ?? []).includes(galleryId);
}

export function loadGallery(): GalleryEntry[] {
  const buckets = JSON.parse(
    fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"),
  ) as Array<{
    id: string;
    name: string;
    path: string;
    age: number;
    gender: "male" | "female";
    genderProb: number;
  }>;
  const bin = fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin"));
  if (bin.subarray(0, 4).toString("latin1") !== "AFv4") {
    throw new Error("Bad v4 magic");
  }
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const vectorCount = view.getUint32(8, true);
  const dimension = view.getUint16(12, true);
  const scale = view.getFloat32(16, true);
  if (vectorCount !== buckets.length) {
    throw new Error(`v4 header mismatch: ${vectorCount} vs ${buckets.length} buckets`);
  }
  if (dimension !== 256 && dimension !== 512) {
    throw new Error(`v4 header has unsupported dim ${dimension}`);
  }
  GALLERY_DIM = dimension;
  const out: GalleryEntry[] = new Array(buckets.length);
  for (let i = 0; i < buckets.length; i++) {
    // Stride and width MUST come from the header — the browser loader reads full
    // records (embeddings.ts off = i * dim), and a hardcoded stride silently scores
    // half-vectors in the wrong geometry (P0 found by the cycle-6 reviewer).
    const off = 32 + i * dimension;
    const raw = new Float32Array(dimension);
    for (let j = 0; j < dimension; j++) raw[j] = (bin[off + j]! - 128) * scale;
    const b = buckets[i]!;
    out[i] = {
      id: b.id,
      name: b.name,
      path: b.path,
      descriptor: l2Normalize(raw),
      age: b.age,
      gender: b.gender,
      genderProb: b.genderProb,
    };
  }
  return out;
}

function mergeExtraTemplates(base: GalleryEntry[]): GalleryEntry[] {
  const file = path.join(CELEBS, "extra-templates.json");
  if (!fs.existsSync(file)) return base;
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
    templates?: Array<{ id: string; descriptor: number[]; source?: string }>;
  };
  if (!data.templates?.length) return base;
  const byId = new Map(base.map((b) => [b.id, b]));
  const extras: GalleryEntry[] = [];
  for (const t of data.templates) {
    const proto = byId.get(t.id);
    if (!proto || !t.descriptor?.length) continue;
    extras.push({ ...proto, descriptor: l2Normalize(t.descriptor) });
  }
  return extras.length ? base.concat(extras) : base;
}

/** Every image file that contributed to any shipped gallery artifact. */
export function collectGallerySources(celebsDir = CELEBS): Set<string> {
  const sources = new Set<string>();
  const buckets = JSON.parse(
    fs.readFileSync(path.join(celebsDir, "gallery.buckets.json"), "utf8"),
  ) as Array<{ path?: string }>;
  for (const b of buckets) if (b.path) sources.add(normalizeSource(b.path));
  const index = JSON.parse(fs.readFileSync(path.join(celebsDir, "index.json"), "utf8")) as Array<{
    path?: string;
    path192?: string;
    fallbackPath?: string;
  }>;
  for (const e of index)
    for (const p of [e.path, e.path192, e.fallbackPath]) if (p) sources.add(normalizeSource(p));
  const templatesFile = path.join(celebsDir, "extra-templates.json");
  if (fs.existsSync(templatesFile)) {
    const data = JSON.parse(fs.readFileSync(templatesFile, "utf8")) as {
      templates?: Array<{ source?: string }>;
    };
    for (const t of data.templates ?? []) if (t.source) sources.add(normalizeSource(t.source));
  }
  return sources;
}

export interface EvaluatedRecord {
  id: string;
  rank: number;
  top1: string;
  dTrue: number;
  dTop1: number;
  dMinSameId: number;
  dBestWrong: number;
  margin: number;
  priorFlipped: boolean;
  leaked: boolean;
}

export interface HeldOutMetrics {
  n: number;
  rank1Pct: number;
  rank5Pct: number;
  mrr: number;
}

export function metricsFor(records: readonly EvaluatedRecord[], pred: (r: EvaluatedRecord) => boolean): HeldOutMetrics {
  const rs = records.filter(pred);
  const n = rs.length;
  if (n === 0) return { n: 0, rank1Pct: 0, rank5Pct: 0, mrr: 0 };
  const rank1 = rs.filter((r) => r.rank === 1).length;
  const rank5 = rs.filter((r) => r.rank >= 1 && r.rank <= 5).length;
  const mrr = rs.reduce((a, r) => a + (Number.isFinite(r.rank) ? 1 / r.rank : 0), 0) / n;
  return {
    n,
    rank1Pct: (rank1 / n) * 100,
    rank5Pct: (rank5 / n) * 100,
    mrr,
  };
}

export function evaluateHeldOutCases(
  gallery: readonly GalleryEntry[],
  cases: readonly HeldOutCase[],
  opts: { excludeLeaked: boolean },
): { records: EvaluatedRecord[]; skipped: number; notEnrolled: number; leakedExcluded: number } {
  const galleryIds = new Set(gallery.map((g) => g.id));
  const leakedSources = collectGallerySources();
  const records: EvaluatedRecord[] = [];
  let skipped = 0;
  let notEnrolled = 0;
  let leakedExcluded = 0;

  for (const c of cases) {
    if (c.ok === false || !c.descriptor?.length) {
      skipped++;
      continue;
    }
    if (!galleryIds.has(c.id)) {
      notEnrolled++;
      continue;
    }
    const leaked = c.source ? leakedSources.has(normalizeSource(c.source)) : false;
    if (opts.excludeLeaked && leaked) {
      leakedExcluded++;
      continue;
    }
    const matches = rankByDescriptor(
      {
        descriptor: Float32Array.from(c.descriptor),
        age: Number.isFinite(c.age) ? (c.age as number) : 0 / 0,
        gender: c.gender ?? "unknown",
        genderProbability: c.genderProb ?? 0.9,
      },
      gallery as GalleryEntry[],
      5,
    );
    const rank = matches.findIndex((m) => idsMatchHeldOut(c.id, m.celebrityId)) + 1;
    // raw cosine distances (no priors) for calibration stats
    const q = l2Normalize(c.descriptor);
    let dMinSameId = Infinity;
    let dBestWrong = Infinity;
    for (const g of gallery) {
      const d = cosineDistance(q, g.descriptor);
      if (idsMatchHeldOut(c.id, g.id)) dMinSameId = Math.min(dMinSameId, d);
      else dBestWrong = Math.min(dBestWrong, d);
    }
    if (!Number.isFinite(matches[0]?.distance)) {
      // Matcher refused every candidate (distance gate). Counted as a miss.
      records.push({
        id: c.id,
        rank: Infinity,
        top1: "",
        dTrue: dMinSameId,
        dTop1: NaN,
        dMinSameId,
        dBestWrong,
        margin: NaN,
        priorFlipped: false,
        leaked,
      });
      continue;
    }
    const dTop1 = matches[0]!.distance;
    records.push({
      id: c.id,
      rank: rank === 0 ? Infinity : rank,
      top1: matches[0]!.celebrityId,
      dTrue: dMinSameId,
      dTop1,
      dMinSameId,
      dBestWrong,
      margin: Math.max(0, dTop1 - dMinSameId),
      priorFlipped: dTop1 > dMinSameId + 1e-9,
      leaked,
    });
  }
  return { records, skipped, notEnrolled, leakedExcluded };
}

export function assertDimensionsCompatible(
  cases: readonly HeldOutCase[],
  galleryDim: number,
): void {
  const badDim = cases.filter((c) => c.descriptor?.length && c.descriptor.length !== galleryDim);
  if (badDim.length > 0) {
    throw new Error(
      `Probe/gallery dimension mismatch: probes are ${badDim[0]!.descriptor.length}-d but the shipped ` +
        `gallery is ${galleryDim}-d (${badDim.length}/${cases.length} probes). Cross-space cosine ` +
        `is meaningless — re-encode probes with scripts/encode-held-out-browser.mjs (engine=edgeface).`,
    );
  }
}

function main() {
  const includeLeaked = process.argv.includes("--include-leaked");
  const floorArg = process.argv.indexOf("--floor");
  const rankFloor = floorArg >= 0 ? Number(process.argv[floorArg + 1]) : null;

  const familiesPath = path.join(CELEBS, "appearance-families.json");
  if (fs.existsSync(familiesPath)) {
    applyAppearanceFamilyManifest(JSON.parse(fs.readFileSync(familiesPath, "utf8")));
  }
  const gallery = mergeExtraTemplates(loadGallery());

  const descIdx = process.argv.indexOf("--descriptors");
  const packPath =
    descIdx >= 0 && process.argv[descIdx + 1]
      ? path.resolve(ROOT, process.argv[descIdx + 1])
      : path.join(CELEBS, "held-out/descriptors.json");
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8")) as { cases: HeldOutCase[] };

  assertDimensionsCompatible(pack.cases, GALLERY_DIM);

  const { records, skipped, notEnrolled, leakedExcluded } = evaluateHeldOutCases(gallery, pack.cases, {
    excludeLeaked: !includeLeaked,
  });

  const clean = metricsFor(records, (r) => !r.leaked);
  const all = metricsFor(records, () => true);

  console.log("=".repeat(72));
  console.log("  TWINFRAME HELD-OUT RANK-1 (v2.1) — leak-excluded protocol");
  console.log("=".repeat(72));
  console.log(
    `  gallery buckets+templates: ${gallery.length} | evaluated: ${records.length}` +
      ` (skipped ${skipped}, not enrolled ${notEnrolled}, LEAKED EXCLUDED ${leakedExcluded})`,
  );
  if (includeLeaked) {
    console.log("  !! --include-leaked set: headline numbers below CONTAMINATED (probes scored against their own gallery images)");
  }
  console.log("");
  console.log(`  CLEAN       Rank-1: ${clean.rank1Pct.toFixed(1)}%  Rank-5: ${clean.rank5Pct.toFixed(1)}%  MRR: ${clean.mrr.toFixed(3)}  (n=${clean.n})`);
  if (rankFloor !== null && Number.isFinite(rankFloor)) {
    const ok = clean.n > 0 && clean.rank1Pct >= rankFloor;
    console.log(
      ok
        ? `  floor check: PASS (${clean.rank1Pct.toFixed(1)}% >= ${rankFloor}%)`
        : `  floor check: FAIL (${clean.rank1Pct.toFixed(1)}% < ${rankFloor}% or n=0)`,
    );
    if (!ok) process.exitCode = 1;
  }
  console.log(`  ALL(eval'd) Rank-1: ${all.rank1Pct.toFixed(1)}%  Rank-5: ${all.rank5Pct.toFixed(1)}%  MRR: ${all.mrr.toFixed(3)}  (n=${all.n})`);
  const refused = records.filter((r) => !Number.isFinite(r.dTop1)).length;
  const flips = records.filter((r) => r.priorFlipped).length;
  console.log(`  gate refusals (no candidate passed the floor): ${refused}/${records.length}`);
  console.log(`  prior-bucket flips (margin>0): ${flips}/${records.length}`);
  const margins = records.map((r) => r.margin).filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  if (margins.length) {
    const mq = (p: number) => margins[Math.min(margins.length - 1, Math.floor(p * margins.length))]!.toFixed(4);
    console.log(`  margin (dTop1-dMinSameId): p50=${mq(0.5)} p90=${mq(0.9)} max=${margins[margins.length - 1]!.toFixed(4)}`);
  }

  const misses = records
    .filter((r) => r.rank !== 1)
    .sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || b.dTrue - a.dTrue)
    .slice(0, 25);
  if (misses.length) {
    console.log("");
    console.log("  Worst misses:");
    for (const m of misses) {
      console.log(
        `    ${m.id.padEnd(28)} rank=${m.rank === Infinity ? "—" : String(m.rank).padStart(3)} got=${m.top1.padEnd(24)} dTrue=${m.dTrue.toFixed(3)}`,
      );
    }
  }

  const payload = JSON.stringify(
    {
      at: new Date().toISOString(),
      protocol: "held-out-v2.1-leak-excluded",
      includeLeaked,
      gallerySize: gallery.length,
      probesTotal: pack.cases.length,
      skipped,
      notEnrolled,
      leakedExcluded,
      clean,
      allEvaluated: all,
      records,
    },
    null,
    1,
  );
  const jsonArg = process.argv.indexOf("--json");
  if (jsonArg >= 0) {
    const outPath = process.argv[jsonArg + 1]!;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, payload);
    console.log("");
    console.log(`  report: ${path.relative(ROOT, outPath)}`);
  } else if (process.env.TWINFRAME_SAVE_BASELINE === "1") {
    const outPath = path.join(ROOT, "reports/held-out-v2-baseline.json");
    fs.writeFileSync(outPath, payload);
    console.log("");
    console.log(`  report: ${path.relative(ROOT, outPath)} (baseline overwritten)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
