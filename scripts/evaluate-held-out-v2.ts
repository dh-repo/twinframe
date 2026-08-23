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
 * Run: node --experimental-strip-types scripts/evaluate-held-out-v2.ts [--json reports/x.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { l2Normalize, cosineDistance } from "../src/lib/face/embeddings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

interface GalleryEntry {
  id: string;
  name: string;
  path: string;
  descriptor: Float32Array;
  age: number;
  gender: "male" | "female";
  genderProb: number;
}

function parseV4AndLoad(): GalleryEntry[] {
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
  if (vectorCount !== buckets.length || dimension !== 256) {
    throw new Error(`v4 header mismatch: ${vectorCount} vs ${buckets.length} buckets, dim=${dimension}`);
  }
  const out: GalleryEntry[] = new Array(buckets.length);
  for (let i = 0; i < buckets.length; i++) {
    const off = 32 + i * 256;
    const raw = new Float32Array(256);
    for (let j = 0; j < 256; j++) raw[j] = (bin[off + j]! - 128) * scale;
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

function main() {
  const gallery = mergeExtraTemplates(parseV4AndLoad());
  const galleryIds = new Set(gallery.map((g) => g.id));
  const portraitIds = new Set(
    fs.readdirSync(CELEBS).filter((f) => f.endsWith(".jpg")).map((f) => f.replace(/\.jpg$/, "")),
  );

  const packPath = path.join(CELEBS, "held-out/descriptors.json");
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8")) as {
    cases: Array<{
      id: string;
      name: string;
      descriptor: number[];
      age?: number;
      gender?: "male" | "female";
      genderProb?: number;
      ok?: boolean;
    }>;
  };

  const records: Array<{
    id: string;
    rank: number;
    top1: string;
    dTrue: number;
    dTop1: number;
    margin: number;
    hasPortrait: boolean;
  }> = [];
  let skipped = 0;
  let notEnrolled = 0;

  for (const c of pack.cases) {
    if (c.ok === false || !c.descriptor?.length) {
      skipped++;
      continue;
    }
    if (!galleryIds.has(c.id)) {
      notEnrolled++;
      continue;
    }
    const matches = rankByDescriptor(
      {
        descriptor: Float32Array.from(c.descriptor),
        age: Number.isFinite(c.age) ? (c.age as number) : 0 / 0,
        gender: c.gender ?? "unknown",
        genderProbability: c.genderProb ?? 0.9,
      },
      gallery,
      5,
    );
    const rank = matches.findIndex((m) => m.celebrityId === c.id) + 1;
    // raw cosine distances (no priors) for calibration stats
    const q = l2Normalize(c.descriptor);
    let dTrue = Infinity;
    for (const g of gallery) {
      if (g.id !== c.id) continue;
      dTrue = Math.min(dTrue, cosineDistance(q, g.descriptor));
    }
    const dTop1 = matches[0]?.distance ?? Infinity;
    records.push({
      id: c.id,
      rank: rank === 0 ? Infinity : rank,
      top1: matches[0]?.celebrityId ?? "",
      dTrue,
      dTop1,
      margin: dTop1 === dTrue ? NaN : dTrue - dTop1, // negative = true is closer than adjusted-top1
      hasPortrait: portraitIds.has(c.id),
    });
  }

  const n = records.length;
  const rank1 = records.filter((r) => r.rank === 1).length;
  const rank5 = records.filter((r) => r.rank >= 1 && r.rank <= 5).length;
  const mrr = records.reduce((a, r) => a + (r.rank > 0 ? 1 / r.rank : 0), 0) / Math.max(1, n);

  const subset = (pred: (r: (typeof records)[number]) => boolean) => {
    const rs = records.filter(pred);
    const nn = rs.length;
    return {
      n: nn,
      rank1Pct: (rs.filter((r) => r.rank === 1).length / Math.max(1, nn)) * 100,
      rank5Pct: (rs.filter((r) => r.rank >= 1 && r.rank <= 5).length / Math.max(1, nn)) * 100,
    };
  };

  const withPortrait = subset((r) => r.hasPortrait);
  const withoutPortrait = subset((r) => !r.hasPortrait);

  const dTrueVals = records.map((r) => r.dTrue).filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p: number) => dTrueVals[Math.min(dTrueVals.length - 1, Math.floor(p * dTrueVals.length))] ?? NaN;

  console.log("=".repeat(72));
  console.log("  TWINFRAME HELD-OUT RANK-1 (v2) — honest protocol");
  console.log("=".repeat(72));
  console.log(`  gallery buckets+templates: ${gallery.length} | probes: ${n} (skipped ${skipped}, not enrolled ${notEnrolled})`);
  console.log("");
  console.log(`  OVERALL      Rank-1: ${((rank1 / Math.max(1, n)) * 100).toFixed(1)}%  Rank-5: ${((rank5 / Math.max(1, n)) * 100).toFixed(1)}%  MRR: ${mrr.toFixed(3)}`);
  console.log(`  w/ portrait  Rank-1: ${withPortrait.rank1Pct.toFixed(1)}%  Rank-5: ${withPortrait.rank5Pct.toFixed(1)}%  (n=${withPortrait.n})`);
  console.log(`  no portrait  Rank-1: ${withoutPortrait.rank1Pct.toFixed(1)}%  Rank-5: ${withoutPortrait.rank5Pct.toFixed(1)}%  (n=${withoutPortrait.n})`);
  console.log("");
  console.log(`  d_true distribution: p10=${q(0.1).toFixed(3)} p50=${q(0.5).toFixed(3)} p90=${q(0.9).toFixed(3)}`);

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

  const jsonArg = process.argv.indexOf("--json");
  const outPath = jsonArg >= 0 ? process.argv[jsonArg + 1] : path.join(ROOT, "reports/held-out-v2-baseline.json");
  fs.mkdirSync(path.dirname(outPath!), { recursive: true });
  fs.writeFileSync(
    outPath!,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        gallerySize: gallery.length,
        probes: n,
        rank1Pct: (rank1 / Math.max(1, n)) * 100,
        rank5Pct: (rank5 / Math.max(1, n)) * 100,
        mrr,
        withPortrait,
        withoutPortrait,
        records,
      },
      null,
      1,
    ),
  );
  console.log("");
  console.log(`  report: ${path.relative(ROOT, outPath!)}`);
}

main();
