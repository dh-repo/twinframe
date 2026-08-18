#!/usr/bin/env node
/**
 * Label held-out probe images with the hard-probe conditions from
 * src/lib/face/hard-probes.ts, so accuracy can be reported per condition
 * instead of as one flattering average.
 *
 * WHICH CONDITIONS ARE REAL AND WHICH ARE NOT
 * -------------------------------------------
 * Auto-derived from the product's own SCRFD-2.5G pass (same estimators the app
 * runs on a user photo):
 *   low-light      meanLuma — Rec.709 luma of the detection box, 0-1
 *                  (threshold LOW_LIGHT_MAX_LUMA)
 *   yaw-gt-25      yawDeg — estimateHeadPose() on the 5-point landmarks
 *                  (threshold YAW_HARD_MIN_DEG)
 *   phone-closeup  faceCoverage — box area / image area
 *                  (threshold PHONE_CLOSEUP_MIN_COVERAGE)
 *
 * Auto-derived but LOW FIDELITY — do not quote without spot-checking:
 *   big-smile      smileIntensity — estimateSmileMetrics() is a mouth-width /
 *                  inter-ocular-distance ratio that clamps to 1.0 on roughly a
 *                  third of red-carpet photos. It is the same number the matcher
 *                  itself consumes, so it is reported, but every labelled probe
 *                  carries `lowConfidence: ["big-smile"]` and `diagnostics.smileRatio`
 *                  so a human can see when the proxy saturated.
 *
 * NOT derivable here — manual labels only, never guessed:
 *   glasses        nothing in this pipeline sees eyewear. Absent unless a human
 *                  adds it to the override file.
 *
 * HAND LABELS
 * -----------
 * Create public/celebs/held-out/hard-probes.overrides.json:
 *   {
 *     "/celebs/held-out/adele/001.jpg": { "glasses": true },
 *     "/celebs/held-out/elton-john/002.jpg": { "glasses": true, "smileIntensity": 0.9 }
 *   }
 * Any HardProbeSignals field may be overridden; overrides win over derived
 * signals and are recorded per probe under `manualSignals`.
 *
 * Usage:
 *   node --experimental-strip-types scripts/label-hard-probes.mjs --limit 8 --concurrency 4
 *   node --experimental-strip-types scripts/label-hard-probes.mjs              # full set
 *   node --experimental-strip-types scripts/label-hard-probes.mjs --force      # ignore cache
 *
 * Results are cached in the output file and keyed by file size + mtime + signals
 * version, so re-runs only touch new or changed images.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HARD_PROBE_CONDITIONS,
  classifyHardProbe,
  isHardProbeCondition,
} from "../src/lib/face/hard-probes.ts";
import { SIGNALS_VERSION } from "./lib/probe-signals.mjs";
import { mapProcessPool, parseConcurrencyArg } from "./lib/photo-pool.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = path.join(ROOT, "public/celebs/held-out");
const DEFAULT_OUT = path.join(ROOT, "public/celebs/held-out/hard-probes.json");
const DEFAULT_OVERRIDES = path.join(ROOT, "public/celebs/held-out/hard-probes.overrides.json");
const WORKER = path.join(ROOT, "scripts/lib/probe-signals.worker.mjs");

export const OUTPUT_VERSION = "1.0.0";
export const AUTO_DERIVED_CONDITIONS = ["low-light", "yaw-gt-25", "phone-closeup", "big-smile"];
export const MANUAL_ONLY_CONDITIONS = ["glasses"];
/** Auto-derived but from a saturating proxy — flagged on every probe that gets it. */
export const LOW_CONFIDENCE_CONDITIONS = ["big-smile"];

const IMAGE_RE = /\.(jpe?g|png)$/i;

/** `/celebs/held-out/<id>/<slot>.jpg` → { id, slot }. */
export function parseProbeKey(key) {
  const m = /\/celebs\/held-out\/([^/]+)\/([^/]+)\.(?:jpe?g|png)$/i.exec(key);
  if (!m) return null;
  return { id: m[1], slot: m[2] };
}

/** Public URL path for an image inside the held-out tree. */
export function probeKeyFor(absPath, celebsDir) {
  return `/celebs/${path.relative(celebsDir, absPath).split(path.sep).join("/")}`;
}

/** Cache key: recompute when the bytes or the signal definitions change. */
export function fingerprintFor(stat, signalsVersion = SIGNALS_VERSION) {
  return `${signalsVersion}:${stat.size}:${Math.round(stat.mtimeMs)}`;
}

/** Every image slot on disk, sorted by id then slot. */
export function listProbeImages(heldOutDir) {
  if (!fs.existsSync(heldOutDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(heldOutDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(heldOutDir, entry.name);
    for (const file of fs.readdirSync(dir).sort()) {
      if (!IMAGE_RE.test(file)) continue;
      out.push({ id: entry.name, slot: file.replace(IMAGE_RE, ""), filePath: path.join(dir, file) });
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id) || a.slot.localeCompare(b.slot));
  return out;
}

/** Overrides win over derived signals; returns the merged signals + which keys were manual. */
export function mergeSignals(derived, override) {
  const manualSignals = [];
  const merged = { ...derived };
  if (override && typeof override === "object") {
    for (const [key, value] of Object.entries(override)) {
      if (value === null || value === undefined) continue;
      merged[key] = value;
      manualSignals.push(key);
    }
  }
  manualSignals.sort();
  return { signals: merged, manualSignals };
}

export function lowConfidenceFor(conditions) {
  return conditions.filter((c) => LOW_CONFIDENCE_CONDITIONS.includes(c));
}

/** Per-condition image counts plus the "no condition fired" bucket. */
export function summarizeConditionCounts(probes) {
  const byCondition = {};
  for (const condition of HARD_PROBE_CONDITIONS) byCondition[condition] = 0;
  let images = 0;
  let detected = 0;
  let easy = 0;
  for (const probe of Object.values(probes)) {
    images++;
    if (probe.detected) detected++;
    if (probe.conditions.length === 0) easy++;
    for (const condition of probe.conditions) {
      if (!isHardProbeCondition(condition)) continue;
      byCondition[condition] += 1;
    }
  }
  return { images, detected, easyImages: easy, byCondition };
}

function parseArgs(argv) {
  const options = {
    limit: Infinity,
    dir: DEFAULT_DIR,
    out: DEFAULT_OUT,
    overrides: DEFAULT_OVERRIDES,
    force: false,
  };
  const limitIdx = argv.indexOf("--limit");
  if (limitIdx >= 0) {
    const n = Number(argv[limitIdx + 1]);
    if (!Number.isFinite(n) || n < 1) throw new Error(`Invalid --limit "${argv[limitIdx + 1]}"`);
    options.limit = Math.floor(n);
  }
  const dirIdx = argv.indexOf("--dir");
  if (dirIdx >= 0 && argv[dirIdx + 1]) options.dir = path.resolve(argv[dirIdx + 1]);
  const outIdx = argv.indexOf("--out");
  if (outIdx >= 0 && argv[outIdx + 1]) options.out = path.resolve(argv[outIdx + 1]);
  const ovIdx = argv.indexOf("--overrides");
  if (ovIdx >= 0 && argv[ovIdx + 1]) options.overrides = path.resolve(argv[ovIdx + 1]);
  if (argv.includes("--force")) options.force = true;
  return options;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`ignoring unreadable ${path.relative(ROOT, file)}: ${err.message}`);
    return fallback;
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const concurrency = parseConcurrencyArg();
  const celebsDir = path.dirname(options.dir);
  const overrides = readJson(options.overrides, {});
  const cached = readJson(options.out, { probes: {} }).probes ?? {};

  const all = listProbeImages(options.dir);
  const images = all.slice(0, options.limit === Infinity ? all.length : options.limit);
  if (images.length === 0) {
    console.log(`no images under ${path.relative(ROOT, options.dir)} — nothing to label`);
    return;
  }

  const stale = [];
  const probes = {};
  for (const image of images) {
    const key = probeKeyFor(image.filePath, celebsDir);
    const fingerprint = fingerprintFor(fs.statSync(image.filePath));
    const hit = cached[key];
    if (!options.force && hit && hit.fingerprint === fingerprint) {
      probes[key] = relabel(hit, overrides[key]);
      continue;
    }
    stale.push({ ...image, key, fingerprint });
  }

  console.log(
    `hard-probe labeling: ${images.length} images (${images.length - stale.length} cached, ${stale.length} to analyze) concurrency=${concurrency}`,
  );

  if (stale.length > 0) {
    const t0 = Date.now();
    const results = await mapProcessPool(
      stale.map((s) => ({ filePath: s.filePath, embed: false })),
      {
        workerPath: WORKER,
        concurrency,
        onProgress(done, total) {
          if (done % 25 !== 0 && done !== total) return;
          const rate = done / Math.max(0.001, (Date.now() - t0) / 1000);
          process.stdout.write(`\r  ${done}/${total} (${rate.toFixed(1)}/s)`);
        },
      },
    );
    if (stale.length >= 25) process.stdout.write("\n");

    for (let i = 0; i < stale.length; i++) {
      const job = stale[i];
      const result = results[i];
      if (!result?.ok) {
        console.error(`  analyze failed ${job.key}: ${String(result?.error ?? "unknown").slice(0, 120)}`);
        probes[job.key] = relabel(
          {
            id: job.id,
            slot: job.slot,
            detected: false,
            derivedSignals: {},
            diagnostics: null,
            detScore: 0,
            fingerprint: job.fingerprint,
            error: String(result?.error ?? "analyze failed").slice(0, 200),
          },
          overrides[job.key],
        );
        continue;
      }
      const value = result.value;
      probes[job.key] = relabel(
        {
          id: job.id,
          slot: job.slot,
          detected: value.usedDetection,
          derivedSignals: value.signals,
          diagnostics: value.diagnostics,
          detScore: value.score,
          imageWidth: value.imageWidth,
          imageHeight: value.imageHeight,
          fingerprint: job.fingerprint,
        },
        overrides[job.key],
      );
    }
  }

  const ordered = {};
  for (const key of Object.keys(probes).sort()) ordered[key] = probes[key];
  const counts = summarizeConditionCounts(ordered);

  const payload = {
    version: OUTPUT_VERSION,
    signalsVersion: SIGNALS_VERSION,
    generatedAt: new Date().toISOString(),
    detector: "SCRFD-2.5G-bnkps (scripts/lib/probe-signals.mjs)",
    autoDerivedConditions: AUTO_DERIVED_CONDITIONS,
    lowConfidenceConditions: LOW_CONFIDENCE_CONDITIONS,
    manualOnlyConditions: MANUAL_ONLY_CONDITIONS,
    overridesFile: `/celebs/${path.relative(celebsDir, options.overrides).split(path.sep).join("/")}`,
    overrideCount: Object.keys(overrides).length,
    counts,
    probes: ordered,
  };

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`wrote ${path.relative(ROOT, options.out)}`);
  console.log(
    `  images=${counts.images} detected=${counts.detected} noConditionFired=${counts.easyImages}`,
  );
  for (const condition of HARD_PROBE_CONDITIONS) {
    const n = counts.byCondition[condition];
    const flag = LOW_CONFIDENCE_CONDITIONS.includes(condition)
      ? " (low-confidence proxy)"
      : MANUAL_ONLY_CONDITIONS.includes(condition)
        ? " (manual labels only)"
        : "";
    console.log(`  ${condition.padEnd(14)} ${String(n).padStart(4)}${flag}`);
  }
}

/** Re-apply overrides + classification to a stored record (cache hits included). */
function relabel(record, override) {
  const { signals, manualSignals } = mergeSignals(record.derivedSignals ?? {}, override);
  const conditions = classifyHardProbe(signals);
  return {
    ...record,
    signals,
    manualSignals,
    conditions,
    lowConfidence: lowConfidenceFor(conditions),
  };
}

if (process.argv[1] && process.argv[1].endsWith("label-hard-probes.mjs")) {
  await main();
}
