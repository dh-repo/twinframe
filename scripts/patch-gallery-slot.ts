#!/usr/bin/tsx
/**
 * Replace one celebrity's primary FaceNet slot (f32 + q8), features, and metadata.
 * Usage: npx tsx scripts/patch-gallery-slot.ts --id billie-eilish --desc path.json [--features feat.json] [--age 25] [--gender female] [--genderProb 0.94]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { l2Normalize } from "../src/lib/face/embeddings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const id = arg("id");
const descPath = arg("desc");
const featPath = arg("features");
const age = Number(arg("age") ?? 25);
const gender = (arg("gender") ?? "female") as "male" | "female";
const genderProb = Number(arg("genderProb") ?? 0.94);

if (!id || !descPath) {
  console.error("usage: --id <celeb-id> --desc <json> [--features <json>] [--age N] [--gender male|female] [--genderProb 0.94]");
  process.exit(1);
}

const pack = JSON.parse(fs.readFileSync(descPath, "utf8")) as {
  descriptor?: number[];
  cases?: Array<{ id: string; descriptor: number[] }>;
};
const raw =
  pack.descriptor ??
  pack.cases?.find((c) => c.id === id)?.descriptor ??
  pack.cases?.[0]?.descriptor;
if (!raw || raw.length !== 128) throw new Error("need 128-d descriptor");
const vec = l2Normalize(raw);

const meta = JSON.parse(fs.readFileSync(path.join(CELEBS, "embeddings.meta.json"), "utf8"));
const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8")) as Array<{
  id: string;
  name: string;
  age: number;
  gender: string;
  genderProb: number;
  path: string;
  path192: string;
  fallbackPath: string;
}>;
const idx = buckets.findIndex((b) => b.id === id);
if (idx < 0) throw new Error(`id not in buckets: ${id}`);

const dim = meta.dim || 128;
const scale = meta.scale || 0.003;
const f32Path = path.join(CELEBS, "embeddings.f32.bin");
const q8Path = path.join(CELEBS, "embeddings.q8.bin");
const f32 = new Float32Array(fs.readFileSync(f32Path).buffer);
const q8 = Uint8Array.from(fs.readFileSync(q8Path));
const off = idx * dim;
for (let j = 0; j < dim; j++) {
  const v = vec[j] ?? 0;
  f32[off + j] = v;
  const q = Math.max(-127, Math.min(127, Math.round(v / scale)));
  q8[off + j] = q + 127;
}
fs.writeFileSync(f32Path, Buffer.from(f32.buffer));
fs.writeFileSync(q8Path, Buffer.from(q8.buffer));

const jpg = `/celebs/${id}.jpg`;
buckets[idx] = {
  ...buckets[idx]!,
  age,
  gender,
  genderProb,
  fallbackPath: fs.existsSync(path.join(CELEBS, `${id}.jpg`)) ? jpg : buckets[idx]!.fallbackPath,
};
fs.writeFileSync(path.join(CELEBS, "gallery.buckets.json"), JSON.stringify(buckets, null, 2));

const indexPath = path.join(CELEBS, "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as Array<{
  id: string;
  fallbackPath?: string;
  baseAge?: number;
  ageBuckets?: number[];
  gender?: string;
  genderProb?: number;
}>;
const ie = index.find((e) => e.id === id);
if (ie) {
  if (fs.existsSync(path.join(CELEBS, `${id}.jpg`))) ie.fallbackPath = jpg;
  ie.baseAge = age;
  ie.ageBuckets = [age];
  ie.gender = gender;
  ie.genderProb = genderProb;
}
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

// Update gallery.features.json if features provided
if (featPath && fs.existsSync(featPath)) {
  const featJsonPath = path.join(CELEBS, "gallery.features.json");
  if (fs.existsSync(featJsonPath)) {
    const allFeatures = JSON.parse(fs.readFileSync(featJsonPath, "utf8"));
    const newFeatures = JSON.parse(fs.readFileSync(featPath, "utf8"));
    allFeatures[id] = newFeatures[id] ?? newFeatures;
    fs.writeFileSync(featJsonPath, JSON.stringify(allFeatures, null, 2));
    console.log(`updated gallery.features.json for ${id}`);
  }
}

console.log(`patched ${id} bucket=${idx} age=${age} gender=${gender} genderProb=${genderProb}`);

