#!/usr/bin/env tsx
/**
 * Phase 0 — Human gold-set evaluation harness.
 *
 * Loads public/celebs/gold-set.json (see gold-set.example.json), runs each case
 * through the live analyze pipeline when images exist, otherwise reports SKIP.
 *
 * Metrics:
 *  - top1_hit: top celebrity id ∈ acceptableTopIds
 *  - topK_hit: any of top-K ∈ acceptableTopIds
 *  - gender_ok / age_in_range when expected fields present
 *
 * Usage:
 *   npx tsx scripts/evaluate-gold-set.ts
 *   npx tsx scripts/evaluate-gold-set.ts --set public/celebs/gold-set.json
 *
 * Note: Full face-api analyze needs browser models. This harness scores
 * descriptor-only cases if `queryDescriptor` is provided in the gold case;
 * image-only cases are listed as pending until wired to Playwright.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadGalleryDataNode,
  getCanonicalCelebId,
} from "./evaluate-match-accuracy.ts";
import { rankByDescriptor, type UserFaceQuery } from "../src/lib/face/match.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface GoldCase {
  id: string;
  imagePath?: string;
  queryDescriptor?: number[];
  notes?: string;
  acceptableTopIds: string[];
  acceptableTopK?: number;
  expectedGender?: "male" | "female";
  expectedAgeRange?: [number, number];
  /** Optional forced query demography when descriptor-only */
  queryAge?: number;
  queryGender?: "male" | "female" | "unknown";
  queryGenderProb?: number;
}

interface GoldSet {
  version: string;
  cases: GoldCase[];
}

function main() {
  const setIdx = process.argv.indexOf("--set");
  const setPath =
    setIdx >= 0
      ? path.resolve(process.argv[setIdx + 1]!)
      : path.join(ROOT, "public/celebs/gold-set.json");

  if (!fs.existsSync(setPath)) {
    console.log(`No gold set at ${setPath}`);
    console.log(`Copy public/celebs/gold-set.example.json → gold-set.json and add cases.`);
    console.log(`Descriptor-only cases can use queryDescriptor: number[128] for offline scoring.`);
    process.exit(0);
  }

  const set = JSON.parse(fs.readFileSync(setPath, "utf8")) as GoldSet;
  const gallery = loadGalleryDataNode(ROOT);

  let scored = 0;
  let top1 = 0;
  let topK = 0;
  let genderOk = 0;
  let genderN = 0;
  let skipped = 0;

  console.log("================================================================================");
  console.log("          TWINFRAME GOLD-SET EVALUATION (Phase 0)                                ");
  console.log("================================================================================");
  console.log(`Set: ${setPath}  cases=${set.cases.length}  gallery=${gallery.length}`);

  for (const c of set.cases) {
    const k = c.acceptableTopK ?? 5;
    const accept = new Set(c.acceptableTopIds.map(getCanonicalCelebId));

    if (!c.queryDescriptor || c.queryDescriptor.length !== 128) {
      console.log(`SKIP ${c.id} — needs queryDescriptor[128] or browser image pipeline`);
      skipped++;
      continue;
    }

    const user: UserFaceQuery = {
      descriptor: Float32Array.from(c.queryDescriptor),
      age: c.queryAge ?? 35,
      gender: c.queryGender ?? c.expectedGender ?? "unknown",
      genderProbability: c.queryGenderProb ?? 0.9,
    };

    const matches = rankByDescriptor(user, gallery, k);
    scored++;
    const ids = matches.map((m) => getCanonicalCelebId(m.celebrityId));
    const hit1 = ids[0] ? accept.has(ids[0]) : false;
    const hitK = ids.some((id) => accept.has(id));
    if (hit1) top1++;
    if (hitK) topK++;

    if (c.expectedGender && matches[0]) {
      genderN++;
      const g = gallery.find((x) => getCanonicalCelebId(x.id) === ids[0]);
      if (g?.gender === c.expectedGender) genderOk++;
    }

    console.log(
      `${hit1 ? "TOP1" : hitK ? "TOPK" : "MISS"} ${c.id} → [${ids.slice(0, 3).join(", ")}] ` +
        `pct=${matches[0]?.matchPercent ?? "—"}`,
    );
  }

  console.log("--------------------------------------------------------------------------------");
  if (scored === 0) {
    console.log("No scorable cases (add queryDescriptor or wire image pipeline).");
  } else {
    console.log(`top1_hit:    ${top1}/${scored} (${((100 * top1) / scored).toFixed(1)}%)`);
    console.log(`topK_hit:    ${topK}/${scored} (${((100 * topK) / scored).toFixed(1)}%)`);
    if (genderN) {
      console.log(`gender_ok:   ${genderOk}/${genderN} (${((100 * genderOk) / genderN).toFixed(1)}%)`);
    }
  }
  console.log(`skipped:     ${skipped}`);
}

main();
