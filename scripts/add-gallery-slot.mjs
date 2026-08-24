#!/usr/bin/env node
/**
 * Append a new celebrity slot to the shipped gallery atomically: extends the
 * AFv4 binary by one vector and appends aligned entries to buckets.json and
 * index.json. Demographics come from the encode run that produced the
 * descriptor (never fabricated).
 *
 * Usage:
 *   node scripts/add-gallery-slot.mjs --desc descriptors.json \
 *     --age 34 --gender female --genderProb 0.95 [--name "Display Name"]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { l2Normalize } from "../src/lib/face/embeddings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const descPath = arg("desc");
let age = Number(arg("age"));
const gender = arg("gender");
const genderProbRaw = arg("genderProb");
const genderProb = Number(genderProbRaw);
const nameOverride = arg("name");

if (
  !descPath ||
  !Number.isFinite(age) || age < 0 || age > 120 ||
  (gender !== "male" && gender !== "female") ||
  genderProbRaw === undefined || !Number.isFinite(genderProb) || genderProb < 0 || genderProb > 1
) {
  console.error("usage: --desc <descriptors.json> --age N(0-120) --gender male|female --genderProb P(0-1) [--name \"Name\"]");
  console.error("demographics are required explicitly — they are never fabricated or defaulted");
  process.exit(1);
}

// Width from the header — never assume (cycle-6 half-stride lesson).
const binPath = path.join(CELEBS, "embeddings.v4.q8.bin");
const bin = fs.readFileSync(binPath);
if (bin.subarray(0, 4).toString("latin1") !== "AFv4") throw new Error("Bad v4 magic");
const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const count = view.getUint32(8, true);
const dim = view.getUint16(12, true);
if (dim !== 256 && dim !== 512) throw new Error(`unsupported gallery dim ${dim}`);
const scale = view.getFloat32(16, true);

const pack = JSON.parse(fs.readFileSync(descPath, "utf8"));
const cases = Array.isArray(pack) ? pack : pack.cases;
const requestedId = arg("id");
// When --id is given, THAT celeb's descriptor must be used — taking the first
// usable case enrolled 26 celebs with one person's face before this was caught.
const entry = requestedId
  ? cases.find((c) => c.id === requestedId && c.ok !== false && c.descriptor?.length)
  : cases.find((c) => c.ok !== false && c.descriptor?.length);
if (!entry) {
  throw new Error(
    requestedId
      ? `no usable ${dim}-d descriptor for id "${requestedId}" in ${descPath}`
      : `no usable ${dim}-d descriptor in ${descPath}`,
  );
}
const vec = l2Normalize(Float32Array.from(entry.descriptor));
const id = requestedId ?? entry.id;
if (!id) throw new Error("descriptor has no id and --id not given");

const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(CELEBS, "index.json"), "utf8"));
// Preflight: all artifacts must agree before any is mutated (drop-gallery-slot
// asserts the same invariant; a crash mid-write here would fail the loader and
// silently downgrade the app to the legacy gallery path).
if (count !== buckets.length) throw new Error(`header ${count} != buckets ${buckets.length} — repair before enrolling`);
if (index.length !== buckets.length) throw new Error(`index ${index.length} != buckets ${buckets.length} — repair before enrolling`);
if (buckets.some((b) => b.id === id) || index.some((e) => e.id === id)) {
  throw new Error(`id already present in catalog: ${id} (use patch-gallery-slot.ts to replace)`);
}
for (const size of [96, 192]) {
  const thumbPath = path.join(CELEBS, `thumbs/${size}/${id}.webp`);
  if (!fs.existsSync(thumbPath)) throw new Error(`missing thumb ${thumbPath} — generate it before enrolling`);
}

// Extend binary: header count+1, one more record appended.
view.setUint32(8, count + 1, true);
const out = Buffer.alloc(bin.byteLength + dim);
bin.copy(out, 0);
out.subarray(0, 32).set(bin.subarray(0, 32));
for (let j = 0; j < dim; j++) {
  const q = Math.max(-127, Math.min(127, Math.round((vec[j] ?? 0) / scale)));
  out[32 + count * dim + j] = q + 128;
}
fs.writeFileSync(binPath, out);

const displayName = nameOverride ?? entry.name ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const jpg = `/celebs/${id}.jpg`;
buckets.push({
  id,
  name: displayName,
  age,
  gender,
  genderProb,
  path: `/celebs/thumbs/96/${id}.webp`,
  path192: `/celebs/thumbs/192/${id}.webp`,
  fallbackPath: fs.existsSync(path.join(CELEBS, `${id}.jpg`)) ? jpg : "",
});
fs.writeFileSync(path.join(CELEBS, "gallery.buckets.json"), JSON.stringify(buckets, null, 2));

index.push({
  id,
  name: displayName,
  path: `/celebs/thumbs/96/${id}.webp`,
  path192: `/celebs/thumbs/192/${id}.webp`,
  fallbackPath: buckets[buckets.length - 1].fallbackPath,
  baseAge: age,
  ageBuckets: [age],
  gender,
  genderProb,
});
fs.writeFileSync(path.join(CELEBS, "index.json"), JSON.stringify(index, null, 2));

const metaPath = path.join(CELEBS, "embeddings.v4.meta.json");
if (fs.existsSync(metaPath)) {
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.countBuckets = count + 1;
  meta.countCelebs = count + 1;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

console.log(
  `appended slot "${id}" (${displayName}) as row ${count}; gallery now ${count + 1} buckets, dim ${dim}`,
);
