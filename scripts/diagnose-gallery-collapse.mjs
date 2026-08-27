#!/usr/bin/env node
/**
 * Diagnose why 14 shipped gallery ids collapse at d≤0.005 in AdaFace space.
 *
 * Loads the shipped AFv4 q8 binary as-is (never rewrites it). For each id,
 * re-encodes the 96-px shipped thumb, the 192-px thumb when present, and the
 * primary enroll photo (jpg or 256-px png) through the live AdaFace+BGR path.
 *
 * Writes JSON only with --json <path> under reports/.
 *
 * Usage:
 *   node --experimental-strip-types scripts/diagnose-gallery-collapse.mjs
 *   node --experimental-strip-types scripts/diagnose-gallery-collapse.mjs --ids alec-burden,ralph-fiennes
 *   node --experimental-strip-types scripts/diagnose-gallery-collapse.mjs --json reports/gallery-collapse-diagnosis.json
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { adafaceModelReady, embedImageFile, ensureSessions } from "./enroll-gallery-onnx.mjs";
import { primaryPhotoPath } from "./lib/enroll-jobs.mjs";
import {
  assertReportsJsonPath,
  classifyPair,
  COLLAPSE_CONTROLS,
  COLLAPSE_IDS,
  HOUSEHOLD_COLLAPSE_IDS,
  loadShippedGalleryRows,
  NEAR_CLONE_MAX,
  parseDiagnoseArgs,
  SMOKING_GUN_PAIRS,
  shippedCollapsePairs,
  sourceKind,
} from "./lib/gallery-collapse.mjs";
import { cosineDistance } from "./lib/gallery-binary.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = join(ROOT, "public/celebs");
const DECODE_DIR = "/tmp/twinframe-collapse-decode";
const DEFAULT_IDS = [...COLLAPSE_IDS, ...COLLAPSE_CONTROLS];

function thumbPath(id, size) {
  return join(CELEBS, "thumbs", String(size), `${id}.webp`);
}

function sourcePaths(id) {
  const paths = [thumbPath(id, 96), thumbPath(id, 192)];
  const primary = primaryPhotoPath(id, CELEBS);
  if (primary) paths.push(primary);
  return paths.filter((p, i, arr) => arr.indexOf(p) === i);
}

async function materializeForEmbed(srcPath) {
  if (!srcPath.endsWith(".webp")) return srcPath;
  const dest = join(DECODE_DIR, `${basename(srcPath, ".webp")}-${sourceKind(srcPath)}.png`);
  await mkdir(dirname(dest), { recursive: true });
  await sharp(srcPath).png().toFile(dest);
  return dest;
}

async function encodeSource(path) {
  const kind = sourceKind(path);
  if (!existsSync(path)) {
    return { ok: false, path, kind, reason: "missing" };
  }
  try {
    const embedPath = await materializeForEmbed(path);
    const emb = await embedImageFile(embedPath);
    const descriptor = emb.d512 ?? emb.d256;
    if (!descriptor || descriptor.length !== 512 || emb.embedKind !== "adaface") {
      return {
        ok: false,
        path,
        kind,
        reason: `embedKind=${emb.embedKind ?? "none"} dim=${descriptor?.length ?? 0}`,
      };
    }
    return {
      ok: true,
      path,
      kind,
      embedKind: emb.embedKind,
      usedDetection: emb.usedDetection,
      padded: emb.padded,
      faceCount: emb.faceCount,
      score: emb.score,
      dim: descriptor.length,
      descriptor,
    };
  } catch (error) {
    return {
      ok: false,
      path,
      kind,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function bestLiveDistance(a, b) {
  const kinds = ["fullres", "png256", "thumb192", "thumb96"];
  let best = null;
  let farthest = null;
  for (const kind of kinds) {
    const da = a.live[kind];
    const db = b.live[kind];
    if (!da?.ok || !db?.ok) continue;
    const d = cosineDistance(da.descriptor, db.descriptor);
    const rec = { kind, d };
    if (best == null || d < best.d) best = rec;
    if (farthest == null || d > farthest.d) farthest = rec;
  }
  return { best, farthest };
}

async function main() {
  const args = parseDiagnoseArgs(process.argv.slice(2), DEFAULT_IDS);
  if (!adafaceModelReady()) {
    throw new Error("AdaFace ONNX missing or too small. Run: node scripts/ensure-face-model.mjs");
  }

  const { header, rows } = loadShippedGalleryRows(ROOT);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = args.ids.filter((id, i, arr) => arr.indexOf(id) === i);

  await ensureSessions();
  const people = [];
  for (const id of ids) {
    const shipped = byId.get(id);
    const live = {};
    for (const path of sourcePaths(id)) {
      const encoded = await encodeSource(path);
      const { descriptor, ...rest } = encoded;
      live[rest.kind] = encoded.ok
        ? {
            ...rest,
            shippedDistance: shipped ? cosineDistance(shipped.descriptor, descriptor) : null,
            descriptor,
          }
        : rest;
    }
    people.push({
      id,
      household: HOUSEHOLD_COLLAPSE_IDS.has(id),
      inShippedGallery: Boolean(shipped),
      shippedGender: shipped?.gender ?? null,
      fallbackPath: shipped?.fallbackPath ?? null,
      q8Fingerprint: shipped?.q8Fingerprint ?? null,
      live,
    });
  }

  const byPerson = new Map(people.map((p) => [p.id, p]));
  const pairs = [];
  for (const [aId, bId] of SMOKING_GUN_PAIRS) {
    if (!ids.includes(aId) || !ids.includes(bId)) continue;
    const a = byPerson.get(aId);
    const b = byPerson.get(bId);
    const aRow = byId.get(aId);
    const bRow = byId.get(bId);
    const shippedD = aRow && bRow ? cosineDistance(aRow.descriptor, bRow.descriptor) : null;
    const { best, farthest } = a && b ? bestLiveDistance(a, b) : { best: null, farthest: null };
    pairs.push({
      a: aId,
      b: bId,
      shippedDistance: shippedD,
      sameQ8Fingerprint: Boolean(aRow && bRow && aRow.q8Fingerprint === bRow.q8Fingerprint),
      bestLive: best,
      farthestLive: farthest,
      cause: shippedD == null ? "missing-from-gallery" : classifyPair(shippedD, farthest?.d ?? null),
    });
  }

  const clusterPairs = shippedCollapsePairs(rows).map((p) => ({
    a: p.a,
    b: p.b,
    distance: p.distance,
    sameFingerprint: p.sameFingerprint,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    nearCloneMax: NEAR_CLONE_MAX,
    galleryDimension: header.dimension,
    householdPolicy: "proposed-only — do not approve-drop household names from this cluster",
    ids,
    shippedClusterPairs: clusterPairs,
    pairs,
    people: people.map((p) => ({
      ...p,
      live: Object.fromEntries(
        Object.entries(p.live).map(([kind, rec]) => {
          const { descriptor, ...rest } = rec;
          return [kind, rest];
        }),
      ),
    })),
  };

  const lines = [
    `near-clone max ${NEAR_CLONE_MAX}  dim=${header.dimension}  shipped-cluster-pairs=${clusterPairs.length}`,
    ...pairs.map(
      (p) =>
        `${p.a} ↔ ${p.b} shipped=${p.shippedDistance?.toFixed(4) ?? "n/a"} ` +
        `liveBest=${p.bestLive?.d.toFixed(4) ?? "n/a"} (${p.bestLive?.kind ?? "none"}) ` +
        `liveFar=${p.farthestLive?.d.toFixed(4) ?? "n/a"} (${p.farthestLive?.kind ?? "none"}) ` +
        `sameQ8=${p.sameQ8Fingerprint} cause=${p.cause}`,
    ),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);

  if (args.json) {
    const dest = assertReportsJsonPath(args.json, ROOT);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`wrote ${dest}\n`);
  }
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

export { assertReportsJsonPath, classifyPair, parseDiagnoseArgs, sourceKind };
