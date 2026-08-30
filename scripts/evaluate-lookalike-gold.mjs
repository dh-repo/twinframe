#!/usr/bin/env node
/**
 * Open-set look-alike gold evaluation on the shipped AdaFace-512 gallery.
 *
 * Identity seeds = closed-set self-retrieval regression (not the product metric).
 * Synthetic refuses = distance-floor smoke.
 * Civilian acceptable@1 is the product metric and stays N/A until real
 * fixtures/gold photos exist — do not invent descriptors.
 *
 * Usage:
 *   node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { loadGallery, mergeExtraTemplates } from "./evaluate-held-out-v2.ts";
import { classifyGoldCase, civilianGoldReady, formatGoldSummary } from "./lib/lookalike-gold.mjs";
import { decodeV4Header } from "./lib/gallery-binary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const FIXTURES_GOLD = path.join(ROOT, "fixtures/gold");

export function evaluateGoldSet(set, gallery, opts = {}) {
  const civilianReady = opts.civilianReady ?? civilianGoldReady(FIXTURES_GOLD);
  const expectedDim = opts.expectedDim ?? 512;
  let skipped = 0;
  let identityN = 0;
  let identityTop1 = 0;
  let refuseN = 0;
  let refuseOk = 0;
  let civilianN = 0;
  let civilianTop1 = 0;
  let civilianRefuseN = 0;
  let civilianRefuseOk = 0;
  const lines = [];

  for (const c of set.cases ?? []) {
    const kind = classifyGoldCase(c);
    const k = c.acceptableTopK ?? 5;
    if (!c.queryDescriptor || c.queryDescriptor.length !== expectedDim) {
      lines.push(`SKIP ${c.id} — needs queryDescriptor[${expectedDim}] matching gallery header`);
      skipped++;
      continue;
    }

    const matches = rankByDescriptor(
      {
        descriptor: Float32Array.from(c.queryDescriptor),
        age: c.queryAge ?? 35,
        gender: c.queryGender ?? "unknown",
        genderProbability: c.queryGenderProb ?? 0.9,
      },
      gallery,
      k,
    );

    if (kind === "refuse-smoke") {
      refuseN++;
      if (matches.length === 0) {
        refuseOk++;
        lines.push(`PASS refuse-smoke ${c.id}`);
      } else {
        lines.push(
          `FAIL refuse-smoke ${c.id} — got ${matches[0]?.celebrityId} @ ${matches[0]?.matchPercent}%`,
        );
      }
      continue;
    }

    const accept = new Set(c.acceptableTopIds ?? []);
    const ids = matches.map((m) => m.celebrityId);
    const hit1 = ids[0] != null && accept.has(ids[0]);
    if (kind === "identity-regression") {
      identityN++;
      if (hit1) identityTop1++;
      lines.push(
        `${hit1 ? "PASS" : "FAIL"} identity-regression ${c.id} top=${ids[0] ?? "—"}`,
      );
      continue;
    }

    if (!civilianReady) {
      lines.push(`SKIP civilian ${c.id} — no fixtures/gold photos`);
      skipped++;
      continue;
    }
    if (c.expectRefuse || accept.size === 0) {
      civilianRefuseN++;
      if (matches.length === 0) {
        civilianRefuseOk++;
        lines.push(`PASS civilian-refuse ${c.id}`);
      } else {
        lines.push(
          `FAIL civilian-refuse ${c.id} — got ${matches[0]?.celebrityId} @ ${matches[0]?.matchPercent}%`,
        );
      }
      continue;
    }
    civilianN++;
    if (hit1) civilianTop1++;
    lines.push(
      `${hit1 ? "PASS" : "FAIL"} civilian ${c.id} top=${ids[0] ?? "—"} pct=${matches[0]?.matchPercent ?? 0}`,
    );
  }

  const stats = {
    identityN,
    identityTop1,
    refuseN,
    refuseOk,
    civilianN,
    civilianTop1,
    civilianRefuseN,
    civilianRefuseOk,
    civilianReady,
    skipped,
  };
  return { stats, lines, summary: formatGoldSummary(stats) };
}

function main() {
  const setIdx = process.argv.indexOf("--set");
  const setPath =
    setIdx >= 0
      ? path.resolve(process.argv[setIdx + 1])
      : path.join(CELEBS, "lookalike-gold.json");

  if (!fs.existsSync(setPath)) {
    console.error(`Missing gold set at ${setPath}`);
    process.exit(1);
  }

  const set = JSON.parse(fs.readFileSync(setPath, "utf8"));
  const gallery = mergeExtraTemplates(loadGallery());
  const header = decodeV4Header(fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin")));
  const { stats, lines, summary } = evaluateGoldSet(set, gallery, { expectedDim: header.dimension });

  console.log("================================================================================");
  console.log("     TWINFRAME OPEN-SET LOOK-ALIKE GOLD (AdaFace-512)                           ");
  console.log("================================================================================");
  console.log(`Set: ${setPath}`);
  console.log(`cases=${(set.cases ?? []).length}  gallery=${gallery.length}`);
  for (const line of lines) console.log(line);
  console.log("--------------------------------------------------------------------------------");
  console.log(`skipped=${stats.skipped}`);
  for (const line of summary) console.log(line);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
