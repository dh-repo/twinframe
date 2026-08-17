#!/usr/bin/env node
/**
 * Leave-one-out open-set probe: each gallery identity is ranked against every
 * other identity. This is the product task (probe not enrolled), not closed-set
 * Top-1. Reports distance / margin / honesty-band distributions so calibration
 * changes can be judged without a human-ranked civilian set.
 *
 * Usage:
 *   node --experimental-strip-types scripts/evaluate-open-set-loo.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseV4BinaryHeader, l2Normalize } from "../src/lib/face/embeddings.ts";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { buildMultiShotCentroidGallery } from "../src/lib/face/gallery-dedupe.ts";
import { honestyBand } from "../src/lib/ux/honesty.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function loadV4Gallery() {
  const buckets = JSON.parse(
    fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"),
  );
  const buf = fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin"));
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const header = parseV4BinaryHeader(arrayBuf);
  if (!header || header.magic !== "AFv4" || (header.dimension !== 256 && header.dimension !== 512)) {
    throw new Error("Invalid embeddings.v4.q8.bin header");
  }
  const dim = header.dimension;
  const payload = new Uint8Array(arrayBuf, 32);
  const scale = header.globalScale;
  const out = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const raw = new Float32Array(dim);
    const off = i * dim;
    for (let j = 0; j < dim; j++) {
      raw[j] = (payload[off + j] - 128) * scale;
    }
    out.push({
      id: b.id,
      name: b.name,
      path: b.path,
      path192: b.path192,
      fallbackPath: b.fallbackPath,
      descriptor: Array.from(l2Normalize(raw)),
      age: b.age,
      gender: b.gender,
      genderProb: b.genderProb,
    });
  }
  return buildMultiShotCentroidGallery(out);
}

function quantile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i];
}

function main() {
  const gallery = loadV4Gallery();
  const byId = new Map();
  for (const row of gallery) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const identities = Array.from(byId.values());

  const percents = [];
  const hills = [];
  const margins = [];
  const distances = [];
  let refused = 0;
  const bands = { weak: 0, soft: 0, strong: 0 };

  for (const probe of identities) {
    const others = gallery.filter((g) => g.id !== probe.id);
    const matches = rankByDescriptor(
      {
        descriptor: Float32Array.from(probe.descriptor),
        age: probe.age ?? 35,
        gender: probe.gender ?? "unknown",
        genderProbability: probe.genderProb ?? 0.9,
      },
      others,
      5,
    );
    if (matches.length === 0) {
      refused++;
      continue;
    }
    const top = matches[0];
    percents.push(top.matchPercent);
    hills.push(top.hillPercent ?? top.matchPercent);
    margins.push(top.rankMargin ?? 0);
    distances.push(top.distance ?? NaN);
    bands[honestyBand(top.matchPercent, top.rankMargin)] += 1;
  }

  const scored = percents.length;
  const n = identities.length;
  percents.sort((a, b) => a - b);
  hills.sort((a, b) => a - b);
  margins.sort((a, b) => a - b);
  const finiteD = distances.filter((d) => Number.isFinite(d)).sort((a, b) => a - b);

  console.log("================================================================================");
  console.log("     TWINFRAME OPEN-SET LEAVE-ONE-OUT (gallery identity as civilian proxy)     ");
  console.log("================================================================================");
  console.log(`identities=${n}  scored=${scored}  refused=${refused} (${((refused / n) * 100).toFixed(1)}%)`);
  console.log(
    `bands  weak=${bands.weak} (${((bands.weak / Math.max(1, scored)) * 100).toFixed(1)}%)  ` +
      `soft=${bands.soft} (${((bands.soft / Math.max(1, scored)) * 100).toFixed(1)}%)  ` +
      `strong=${bands.strong} (${((bands.strong / Math.max(1, scored)) * 100).toFixed(1)}%)`,
  );
  console.log(
    `display%  p10=${quantile(percents, 0.1).toFixed(1)}  p50=${quantile(percents, 0.5).toFixed(1)}  p90=${quantile(percents, 0.9).toFixed(1)}`,
  );
  console.log(
    `hill%     p10=${quantile(hills, 0.1).toFixed(1)}  p50=${quantile(hills, 0.5).toFixed(1)}  p90=${quantile(hills, 0.9).toFixed(1)}`,
  );
  console.log(
    `margin    p10=${quantile(margins, 0.1).toFixed(3)}  p50=${quantile(margins, 0.5).toFixed(3)}  p90=${quantile(margins, 0.9).toFixed(3)}`,
  );
  if (finiteD.length > 0) {
    console.log(
      `distance  p10=${quantile(finiteD, 0.1).toFixed(3)}  p50=${quantile(finiteD, 0.5).toFixed(3)}  p90=${quantile(finiteD, 0.9).toFixed(3)}`,
    );
  }
  console.log(
    `strong-band rate should stay low: this set is enrolled celebs held out, not true civilians, so some soft/strong is expected.`,
  );
}

main();
