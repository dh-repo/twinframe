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
 *
 *   node --experimental-strip-types scripts/encode-gold-probe.mjs \
 *     --dir fixtures/gold --refuse
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
  node --experimental-strip-types scripts/encode-gold-probe.mjs --dir fixtures/gold --refuse
  Optional: --notes "..." --age 32 --gender female --out public/celebs/lookalike-gold.json`);
}

function listGoldImages(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function upsertCase(set, caseRow) {
  const cases = Array.isArray(set.cases) ? set.cases : [];
  const idx = cases.findIndex((c) => c.id === caseRow.id);
  if (idx >= 0) cases[idx] = { ...cases[idx], ...caseRow };
  else cases.push(caseRow);
  set.cases = cases;
}

async function encodeOne(embedImageFile, imagePath, { id, refuse, acceptableTopIds, notes, age, gender }) {
  const emb = await embedImageFile(imagePath);
  const descriptor = emb.d512 ?? emb.d256;
  if (!descriptor || descriptor.length !== 512 || emb.embedKind !== "adaface") {
    throw new Error("embedImageFile did not return an AdaFace-512 descriptor");
  }
  return {
    id,
    notes:
      notes ??
      (refuse
        ? "Single-rater visual refuse: no obvious gallery doppelgänger. Do not invent look-alike names."
        : "Non-celebrity probe with human-ranked acceptable celebs."),
    imagePath: path.relative(ROOT, imagePath),
    queryDescriptor: Array.from(descriptor).map((x) => Math.round(x * 1e5) / 1e5),
    acceptableTopIds,
    expectRefuse: refuse || undefined,
    acceptableTopK: 5,
    queryAge: age,
    queryGender: gender,
  };
}

async function main() {
  const dirArg = arg("dir");
  const image = arg("image");
  const id = arg("id");
  const acceptRaw = arg("accept");
  const refuse = Boolean(arg("refuse"));

  if (dirArg) {
    if (!refuse || acceptRaw) {
      console.error("--dir encodes refuse-only. Do not invent --accept lists in batch.");
      process.exit(1);
    }
    const dir = path.resolve(String(dirArg));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      console.error(`Missing gold dir: ${dir}`);
      process.exit(1);
    }
  } else if (typeof image !== "string" || typeof id !== "string" || (!acceptRaw && !refuse)) {
    usage();
    process.exit(1);
  }

  const { adafaceModelReady, embedImageFile } = await import("./enroll-gallery-onnx.mjs");
  if (!adafaceModelReady()) {
    console.error("AdaFace IR-101 is required to encode gold probes (public/models/adaface_ir101_webface12m.onnx)");
    process.exit(1);
  }

  const outPath = typeof arg("out") === "string" ? path.resolve(arg("out")) : DEFAULT_OUT;
  const set = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : {
        version: "2.0.0-adaface512",
        description:
          "Open-set look-alike gold on AdaFace-512. Identity seeds guard regression; civilian rows need human labels.",
        cases: [],
      };

  const jobs = [];
  if (dirArg) {
    const dir = path.resolve(String(dirArg));
    for (const imagePath of listGoldImages(dir)) {
      jobs.push({
        imagePath,
        id: path.basename(imagePath).replace(/\.(jpe?g|png)$/i, ""),
        refuse: true,
        acceptableTopIds: [],
      });
    }
    if (jobs.length === 0) {
      console.error(`No images in ${dir}`);
      process.exit(1);
    }
  } else {
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
    const notesArg = arg("notes");
    const ageArg = arg("age");
    const genderArg = arg("gender");
    jobs.push({
      imagePath,
      id,
      refuse,
      acceptableTopIds,
      notes: typeof notesArg === "string" ? notesArg : undefined,
      age: typeof ageArg === "string" ? Number(ageArg) : undefined,
      gender: typeof genderArg === "string" ? genderArg : undefined,
    });
  }

  for (const job of jobs) {
    const caseRow = await encodeOne(embedImageFile, job.imagePath, job);
    upsertCase(set, caseRow);
    console.log(
      `wrote ${caseRow.id} → ${outPath}  dim=${caseRow.queryDescriptor.length}  accept=[${caseRow.acceptableTopIds.join(",")}]  refuse=${Boolean(caseRow.expectRefuse)}`,
    );
  }
  fs.writeFileSync(outPath, JSON.stringify(set));
}

await main();
