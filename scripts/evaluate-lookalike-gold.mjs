#!/usr/bin/env node
/**
 * Open-set look-alike gold evaluation on the AccuFace v4 256-d gallery.
 *
 * Metrics:
 *  - acceptable@1 / acceptable@5 when acceptableTopIds is non-empty
 *  - refuse_ok when expectRefuse / empty acceptableTopIds (expect [])
 *  - calibration: fraction of >=70% tops that are human-acceptable
 *
 * Usage:
 *   node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseV4BinaryHeader, l2Normalize } from "../src/lib/face/embeddings.ts";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { buildMultiShotCentroidGallery } from "../src/lib/face/gallery-dedupe.ts";

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
  const gallery = loadV4Gallery();

  let scored = 0;
  let top1 = 0;
  let top5 = 0;
  let refuseOk = 0;
  let refuseN = 0;
  let calNum = 0;
  let calDen = 0;
  let skipped = 0;
  let acceptN = 0;

  console.log("================================================================================");
  console.log("     TWINFRAME OPEN-SET LOOK-ALIKE GOLD (256-d AccuFace v4)                     ");
  console.log("================================================================================");
  console.log(`Set: ${setPath}`);
  console.log(`cases=${set.cases.length}  gallery=${gallery.length}`);

  for (const c of set.cases) {
    const k = c.acceptableTopK ?? 5;
    const expectRefuse = Boolean(c.expectRefuse) || c.acceptableTopIds.length === 0;
    if (
      !c.queryDescriptor ||
      (c.queryDescriptor.length !== 256 && c.queryDescriptor.length !== 512)
    ) {
      console.log(`SKIP ${c.id} — needs queryDescriptor[256|512]`);
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
    scored++;

    if (expectRefuse) {
      refuseN++;
      if (matches.length === 0) {
        refuseOk++;
        console.log(`PASS refuse ${c.id}`);
      } else {
        console.log(
          `FAIL refuse ${c.id} — got ${matches[0]?.celebrityId} @ ${matches[0]?.matchPercent}%`,
        );
      }
      continue;
    }

    acceptN++;
    const accept = new Set(c.acceptableTopIds);
    const ids = matches.map((m) => m.celebrityId);
    const hit1 = ids[0] != null && accept.has(ids[0]);
    const hit5 = ids.some((id) => accept.has(id));
    if (hit1) top1++;
    if (hit5) top5++;
    if (matches[0] && matches[0].matchPercent >= 70) {
      calDen++;
      if (hit1) calNum++;
    }
    console.log(
      `${hit1 ? "PASS" : hit5 ? "SOFT" : "FAIL"} ${c.id} top=${ids[0] ?? "—"} pct=${matches[0]?.matchPercent ?? 0}`,
    );
  }

  console.log("--------------------------------------------------------------------------------");
  console.log(`scored=${scored} skipped=${skipped}`);
  if (acceptN > 0) {
    console.log(
      `acceptable@1=${((top1 / acceptN) * 100).toFixed(1)}%  acceptable@5=${((top5 / acceptN) * 100).toFixed(1)}%`,
    );
  }
  if (refuseN > 0) {
    console.log(`refuse_ok=${((refuseOk / refuseN) * 100).toFixed(1)}% (${refuseOk}/${refuseN})`);
  }
  if (calDen > 0) {
    console.log(
      `calibration(>=70% endorsed)=${((calNum / calDen) * 100).toFixed(1)}% (${calNum}/${calDen})`,
    );
  }
}

main();
