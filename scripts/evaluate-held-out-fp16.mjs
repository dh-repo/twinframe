#!/usr/bin/env node
/**
 * Leak-excluded held-out Rank-1 through the live FP16 AdaFace IR-101 session.
 *
 * Protocol (pinned by scripts/held-out-fp16-ranking.test.mjs):
 *  1. Start from tracked public/celebs/held-out/descriptors.json (priors + sources).
 *  2. Drop any probe whose source matches a gallery artifact (held-out v2.1).
 *  3. Prefer eval slot 001. Sort by id, then source. Take --limit (default 48).
 *  4. Fetch missing photos from the tracked manifest sourceUrl (gitignored on disk).
 *  5. SCRFD → 5-pt Umeyama 112 (same enroll path). Discard usedDetection=false.
 *  6. Embed the SAME aligned tensor with onnxruntime-node FP16 and fp32.
 *  7. Rank both packs vs the shipped gallery (v4 q8 + extras) via rankByDescriptor.
 *
 * The 79.7% headline in reports/held-out-v2-baseline.json is fp32 probes and does
 * not prove FP16 ranking. This script does.
 *
 *   node --experimental-strip-types scripts/evaluate-held-out-fp16.mjs [--limit 48] [--fetch]
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectAndAlignImageFile, swapRgbToBgr } from "./enroll-gallery-onnx.mjs";
import {
  assertDimensionsCompatible,
  collectGallerySources,
  evaluateHeldOutCases,
  loadGallery,
  mergeExtraTemplates,
  metricsFor,
  normalizeSource,
} from "./evaluate-held-out-v2.ts";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const PACK = path.join(CELEBS, "held-out/descriptors.json");
const MANIFEST = path.join(CELEBS, "held-out/manifest.json");
const FP32 = path.join(ROOT, "public/models/adaface_ir101_webface12m.onnx");
const FP16 = path.join(ROOT, "public/models/adaface_ir101_webface12m.fp16.onnx");
const REPORT = path.join(ROOT, "reports/held-out-fp16-ranking.json");
const DESC_OUT = path.join(ROOT, "reports/held-out-fp16-descriptors.json");
const PROTOCOL = "held-out-v2.1-leak-excluded-fp16-session";
const CI_FLOOR = 75;
const DEFAULT_LIMIT = 48;
const UA = "TwinframeHeldOut/1.0 (local accuracy eval; github.com/twinframe) Node.js";
const MIN_FP32 = 50 * 1024 * 1024;
const MIN_FP16 = 20 * 1024 * 1024;
const EVAL_SLOT_RE = /\/001\.(jpe?g|png|webp)$/i;

export function sized(p, min) {
  try {
    return fs.statSync(p).size >= min;
  } catch {
    return false;
  }
}

export function parseFp16EvalArgs(argv) {
  const out = {
    limit: DEFAULT_LIMIT,
    fetch: argv.includes("--fetch"),
    write: !argv.includes("--dry-run"),
    json: REPORT,
    descriptorsOut: DESC_OUT,
  };
  const lim = argv.indexOf("--limit");
  if (lim >= 0) out.limit = Number(argv[lim + 1]);
  if (!Number.isFinite(out.limit) || out.limit < 1) throw new Error("Invalid --limit");
  const jsonIdx = argv.indexOf("--json");
  if (jsonIdx >= 0) out.json = path.resolve(ROOT, argv[jsonIdx + 1]);
  const descIdx = argv.indexOf("--descriptors-out");
  if (descIdx >= 0) out.descriptorsOut = path.resolve(ROOT, argv[descIdx + 1]);
  return out;
}

export function isEvalSlotSource(source) {
  return EVAL_SLOT_RE.test(String(source || "").replace(/\\/g, "/"));
}

export function selectLeakExcludedSubset(cases, leakedSources, limit = DEFAULT_LIMIT) {
  const clean = (cases ?? []).filter((c) => {
    if (!c?.id || !c.source) return false;
    if (c.ok === false) return false;
    return !leakedSources.has(normalizeSource(c.source));
  });
  const evalSlot = clean.filter((c) => isEvalSlotSource(c.source));
  const pool = (evalSlot.length >= Math.min(limit, 8) ? evalSlot : clean).slice();
  pool.sort((a, b) => a.id.localeCompare(b.id) || String(a.source).localeCompare(String(b.source)));
  const seen = new Set();
  const out = [];
  for (const c of pool) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export function resolveProbePath(source, root = ROOT) {
  const rel = String(source || "").replace(/^\/+/, "");
  return path.join(root, "public", rel);
}

export function l2(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] ?? 0) * (v[i] ?? 0);
  const n = Math.sqrt(s);
  const o = new Float32Array(v.length);
  if (!Number.isFinite(n) || n < 1e-12) return o;
  for (let i = 0; i < v.length; i++) o[i] = (v[i] ?? 0) / n;
  return o;
}

export function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function sourceUrlByPath(manifest) {
  const map = new Map();
  for (const row of manifest.cases ?? []) {
    if (row?.imagePath && row.sourceUrl) map.set(normalizeSource(row.imagePath), row.sourceUrl);
  }
  return map;
}

export async function fetchProbeIfMissing(imagePath, sourceUrl) {
  if (fs.existsSync(imagePath)) return true;
  if (!sourceUrl) return false;
  const res = await fetch(sourceUrl, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4000) return false;
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, buf);
  return true;
}

async function embedTensor(session, ort, rgbPlanar) {
  const bgr = swapRgbToBgr(rgbPlanar, 112);
  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", bgr, [1, 3, 112, 112]),
  });
  const first = out[session.outputNames[0]] ?? Object.values(out)[0];
  if (!first?.data || first.data.length !== 512) {
    throw new Error(`embed dim ${first?.data?.length} from ${session.inputNames[0]}`);
  }
  return l2(first.data);
}

function toCase(base, descriptor) {
  return {
    id: base.id,
    name: base.name,
    source: base.source,
    age: base.age,
    gender: base.gender,
    genderProb: base.genderProb,
    ok: true,
    descriptor: Array.from(descriptor),
  };
}

export function rankPack(gallery, cases) {
  assertDimensionsCompatible(cases, 512);
  const { records, skipped, notEnrolled, leakedExcluded } = evaluateHeldOutCases(gallery, cases, {
    excludeLeaked: true,
  });
  return {
    records,
    skipped,
    notEnrolled,
    leakedExcluded,
    metrics: metricsFor(records, (r) => !r.leaked),
  };
}

async function main() {
  const args = parseFp16EvalArgs(process.argv.slice(2));
  if (!sized(FP32, MIN_FP32) || !sized(FP16, MIN_FP16)) {
    throw new Error("AdaFace fp32/fp16 missing. Run: npm run model:ensure");
  }
  const pack = JSON.parse(fs.readFileSync(PACK, "utf8"));
  const leaked = collectGallerySources(CELEBS);
  const pool = selectLeakExcludedSubset(pack.cases, leaked, Math.max(args.limit * 4, 96));
  if (pool.length < 8) {
    throw new Error(`subset too small (${pool.length}); need tracked descriptors + leak-excluded sources`);
  }

  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { cases: [] };
  const urls = sourceUrlByPath(manifest);

  const ready = [];
  for (const c of pool) {
    const imagePath = resolveProbePath(c.source);
    let ok = fs.existsSync(imagePath);
    if (!ok && args.fetch) {
      ok = await fetchProbeIfMissing(imagePath, urls.get(normalizeSource(c.source)));
      process.stdout.write(`${ok ? "+" : "-"} fetch ${c.id} ${c.source}\n`);
      await new Promise((r) => setTimeout(r, 120));
    }
    if (ok) ready.push(c);
    if (ready.length >= args.limit) break;
  }
  if (ready.length < 8) {
    throw new Error(
      `only ${ready.length} probe photos on disk. Re-run with --fetch or scripts/fetch-held-out-photos.ts --limit N`,
    );
  }

  const ort = require("onnxruntime-node");
  const tLoad = performance.now();
  const fp32Session = await ort.InferenceSession.create(FP32, { executionProviders: ["cpu"] });
  const fp16Session = await ort.InferenceSession.create(FP16, { executionProviders: ["cpu"] });
  const loadMs = performance.now() - tLoad;

  const fp16Cases = [];
  const fp32Cases = [];
  const pairs = [];
  let detectMiss = 0;
  const t0 = Date.now();
  for (let i = 0; i < ready.length; i++) {
    const c = ready[i];
    const imagePath = resolveProbePath(c.source);
    const aligned = await detectAndAlignImageFile(imagePath);
    if (!aligned.usedDetection) {
      detectMiss++;
      process.stdout.write(`${c.id} MISS no-detection\n`);
      continue;
    }
    const fp32 = await embedTensor(fp32Session, ort, aligned.tensor);
    const fp16 = await embedTensor(fp16Session, ort, aligned.tensor);
    const cos = cosine(fp16, fp32);
    fp16Cases.push(toCase(c, fp16));
    fp32Cases.push(toCase(c, fp32));
    pairs.push({ id: c.id, source: c.source, cosine: cos });
    process.stdout.write(`${i + 1}/${ready.length} ${c.id} cos=${cos.toFixed(6)}\n`);
  }
  await fp32Session.release();
  await fp16Session.release();

  if (fp16Cases.length < 8) {
    throw new Error(`FP16 encode produced ${fp16Cases.length} usable probes (detect-miss ${detectMiss})`);
  }

  const gallery = mergeExtraTemplates(loadGallery());
  const fp16Rank = rankPack(gallery, fp16Cases);
  const fp32Rank = rankPack(gallery, fp32Cases);
  const meanCos = pairs.reduce((a, p) => a + p.cosine, 0) / pairs.length;
  const minCos = Math.min(...pairs.map((p) => p.cosine));
  const rank1Drop = fp32Rank.metrics.rank1Pct - fp16Rank.metrics.rank1Pct;

  const report = {
    at: new Date().toISOString(),
    protocol: PROTOCOL,
    provider: "onnxruntime-node-cpu",
    note: "Same leak-excluded photos, same aligned 112 tensor, FP16 vs fp32 AdaFace IR-101. Gallery binaries were not rewritten. CPU node is a ranking proof, not a browser-WASM latency claim.",
    ciFloorPct: CI_FLOOR,
    limit: args.limit,
    subsetSelected: pool.length,
    photosOnDisk: ready.length,
    detectMiss,
    n: fp16Rank.metrics.n,
    gallerySize: gallery.length,
    loadMs,
    elapsedMs: Date.now() - t0,
    cosine: { n: pairs.length, mean: meanCos, min: minCos },
    fp16: fp16Rank.metrics,
    fp32Paired: fp32Rank.metrics,
    rank1DropPct: rank1Drop,
    probes: pairs.map((p) => {
      const a = fp16Rank.records.find((r) => r.id === p.id);
      const b = fp32Rank.records.find((r) => r.id === p.id);
      return {
        id: p.id,
        source: p.source,
        cosine: p.cosine,
        rankFp16: a?.rank ?? null,
        rankFp32: b?.rank ?? null,
        top1Fp16: a?.top1 ?? "",
        top1Fp32: b?.top1 ?? "",
      };
    }),
  };

  console.log("=".repeat(72));
  console.log("  TWINFRAME HELD-OUT RANK-1 — FP16 session (leak-excluded subset)");
  console.log("=".repeat(72));
  console.log(`  protocol: ${PROTOCOL}`);
  console.log(`  n=${report.n}  photos=${ready.length}  detect-miss=${detectMiss}  gallery=${gallery.length}`);
  console.log(
    `  FP16        Rank-1: ${fp16Rank.metrics.rank1Pct.toFixed(1)}%  Rank-5: ${fp16Rank.metrics.rank5Pct.toFixed(1)}%  MRR: ${fp16Rank.metrics.mrr.toFixed(3)}`,
  );
  console.log(
    `  fp32 paired Rank-1: ${fp32Rank.metrics.rank1Pct.toFixed(1)}%  Rank-5: ${fp32Rank.metrics.rank5Pct.toFixed(1)}%  MRR: ${fp32Rank.metrics.mrr.toFixed(3)}`,
  );
  console.log(`  cosine(fp16,fp32) mean=${meanCos.toFixed(6)} min=${minCos.toFixed(6)}`);
  console.log(`  Rank-1 drop (fp32-fp16): ${rank1Drop.toFixed(1)} pts`);
  const floorOk = report.n > 0 && fp16Rank.metrics.rank1Pct >= CI_FLOOR;
  const dropOk = rank1Drop <= 0.5 || fp16Rank.metrics.rank1Pct >= fp32Rank.metrics.rank1Pct;
  console.log(floorOk ? `  floor check: PASS (>= ${CI_FLOOR}%)` : `  floor check: FAIL (< ${CI_FLOOR}%)`);
  if (!floorOk) process.exitCode = 1;
  if (!dropOk && fp16Rank.metrics.rank1Pct < CI_FLOOR) process.exitCode = 1;

  if (args.write) {
    fs.mkdirSync(path.dirname(args.json), { recursive: true });
    fs.writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(
      args.descriptorsOut,
      `${JSON.stringify(
        {
          version: "2.1.0-adaface512-fp16",
          model: "adaface-ir101-fp16-512d",
          alignment: "scrfd-5pt-similarity-112",
          dim: 512,
          protocol: PROTOCOL,
          count: fp16Cases.length,
          cases: fp16Cases,
          fp32PairedCases: fp32Cases,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`  report: ${path.relative(ROOT, args.json)}`);
    console.log(`  descriptors: ${path.relative(ROOT, args.descriptorsOut)}`);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
