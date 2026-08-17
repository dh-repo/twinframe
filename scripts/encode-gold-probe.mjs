#!/usr/bin/env node
/**
 * Encode a labeled civilian (or refuse) photo into lookalike-gold.json.
 * Does not invent labels — you must pass --accept ids or --refuse.
 *
 * Usage:
 *   node --experimental-strip-types scripts/encode-gold-probe.mjs \
 *     --image fixtures/gold/civilian-01.jpg \
 *     --id civilian-01 \
 *     --accept ana-de-armas,margot-robbie
 *
 *   node --experimental-strip-types scripts/encode-gold-probe.mjs \
 *     --image fixtures/gold/no-match-01.jpg \
 *     --id civilian-refuse-01 \
 *     --refuse
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = path.join(ROOT, "public/celebs/lookalike-gold.json");

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

function usage() {
  console.error(`Usage:
  node --experimental-strip-types scripts/encode-gold-probe.mjs --image <jpg> --id <case-id> (--accept id,id | --refuse)
  Optional: --notes "..." --age 32 --gender female --out public/celebs/lookalike-gold.json`);
}

async function main() {
  const image = arg("image");
  const id = arg("id");
  const acceptRaw = arg("accept");
  const refuse = Boolean(arg("refuse"));
  if (typeof image !== "string" || typeof id !== "string" || (!acceptRaw && !refuse)) {
    usage();
    process.exit(1);
  }
  const imagePath = path.resolve(image);
  if (!fs.existsSync(imagePath)) {
    console.error(`Missing image: ${imagePath}`);
    process.exit(1);
  }

  const acceptableTopIds = refuse
    ? []
    : String(acceptRaw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  if (!refuse && acceptableTopIds.length === 0) {
    console.error("--accept needs at least one celebrity id");
    process.exit(1);
  }

  const { embedImageFile } = await import("./enroll-gallery-onnx.mjs");
  const emb = await embedImageFile(imagePath);
  const descriptor = emb.d512 ?? emb.d256;
  if (!descriptor || (descriptor.length !== 256 && descriptor.length !== 512)) {
    console.error("embedImageFile did not return a 256/512-d descriptor");
    process.exit(1);
  }

  const outPath = typeof arg("out") === "string" ? path.resolve(arg("out")) : DEFAULT_OUT;
  const set = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : {
        version: "2.0.0-edgeface512",
        description:
          "Open-set look-alike gold on EdgeFace-512. Identity seeds guard regression; civilian rows need human labels.",
        cases: [],
      };

  const notesArg = arg("notes");
  const ageArg = arg("age");
  const genderArg = arg("gender");
  const caseRow = {
    id,
    notes:
      typeof notesArg === "string"
        ? notesArg
        : refuse
          ? "Human judgment: no good doppelgänger — model should refuse top-K."
          : "Non-celebrity probe with human-ranked acceptable celebs.",
    imagePath: path.relative(ROOT, imagePath),
    queryDescriptor: Array.from(descriptor).map((x) => Math.round(x * 1e5) / 1e5),
    acceptableTopIds,
    expectRefuse: refuse || undefined,
    acceptableTopK: 5,
    queryAge: typeof ageArg === "string" ? Number(ageArg) : undefined,
    queryGender: typeof genderArg === "string" ? genderArg : undefined,
  };

  const cases = Array.isArray(set.cases) ? set.cases : [];
  const idx = cases.findIndex((c) => c.id === id);
  if (idx >= 0) cases[idx] = { ...cases[idx], ...caseRow };
  else cases.push(caseRow);
  set.cases = cases;

  fs.writeFileSync(outPath, JSON.stringify(set));
  console.log(
    `wrote ${id} → ${outPath}  dim=${descriptor.length}  accept=[${acceptableTopIds.join(",")}]  refuse=${refuse}`,
  );
}

await main();
