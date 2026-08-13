#!/usr/bin/tsx
/**
 * Build public/celebs/extra-references.json from held-out encodings.
 * Only keep a second view when it is close to the enrolled primary
 * (same person). Drops group-shot / wrong-face encodings.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGalleryDataNode, getCanonicalCelebId } from "./evaluate-match-accuracy.ts";
import { ensembleDistance } from "../src/lib/face/embeddings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELD = path.join(ROOT, "public/celebs/held-out/descriptors.json");
const EXTRA_DESC = path.join(ROOT, "public/celebs/extra-photos/descriptors.json");
const CONTROL_DIR = path.join(ROOT, "public/celebs/control");
const OUT = path.join(ROOT, "public/celebs/extra-references.json");
const MAX_DIST = Number(process.env.EXTRA_MAX_DIST || 0.44);

function fileSha(p: string): string | null {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

const controlShaById = new Map<string, string>();
if (fs.existsSync(CONTROL_DIR)) {
  for (const id of fs.readdirSync(CONTROL_DIR)) {
    const p = path.join(CONTROL_DIR, id, "001.jpg");
    const s = fileSha(p);
    if (s) controlShaById.set(id, s);
  }
}

function loadPack(p: string): Array<{ id: string; descriptor: number[]; source?: string }> {
  if (!fs.existsSync(p)) return [];
  const pack = JSON.parse(fs.readFileSync(p, "utf8")) as {
    cases: Array<{ id: string; descriptor: number[]; source?: string }>;
  };
  return pack.cases ?? [];
}

const includeHeldOut = process.env.INCLUDE_HELDOUT_EXTRAS === "1";
const pack = [
  ...(includeHeldOut
    ? loadPack(HELD).map((c) => ({ ...c, source: c.source ?? `held-out/${c.id}` }))
    : []),
  ...loadPack(EXTRA_DESC).map((c) => ({ ...c, source: c.source ?? `extra-photos/${c.id}` })),
];
const gallery = loadGalleryDataNode(ROOT);
const byId = new Map(gallery.map((g) => [getCanonicalCelebId(g.id), g]));

const kept: Array<{
  id: string;
  descriptor: number[];
  photoUrl: string;
  distanceToPrimary: number;
}> = [];
const dropped: Array<{ id: string; d: number }> = [];

for (const c of pack) {
  if (!c.descriptor || c.descriptor.length !== 128) continue;
  const id = getCanonicalCelebId(c.id);
  const enrolled = byId.get(id);
  if (!enrolled) continue;
  const extraDir = path.join(ROOT, "public/celebs/extra-photos", id);
  const extraFiles = fs.existsSync(extraDir)
    ? fs.readdirSync(extraDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => path.join(extraDir, f))
    : [];
  const candidatePaths = [
    c.source?.startsWith("/") ? path.join(ROOT, "public", c.source.replace(/^\//, "")) : "",
    path.join(ROOT, "public/celebs/held-out", c.id, "001.jpg"),
    ...extraFiles,
  ].filter(Boolean);
  const candSha = candidatePaths.map(fileSha).find(Boolean);
  if (candSha && controlShaById.get(id) === candSha) {
    dropped.push({ id, d: -1 });
    continue;
  }
  const d = ensembleDistance(c.descriptor, enrolled.descriptor);
  if (d > MAX_DIST) {
    dropped.push({ id, d: Number(d.toFixed(3)) });
    continue;
  }
  const photoUrl = c.source?.startsWith("/")
    ? c.source
    : `/celebs/held-out/${c.id}/001.jpg`;
  kept.push({
    id,
    descriptor: c.descriptor,
    photoUrl,
    distanceToPrimary: Number(d.toFixed(4)),
  });
}

const out = {
  version: "1.0.0",
  source: "held-out encodings gated vs enrolled primary",
  maxDistance: MAX_DIST,
  kept: kept.length,
  dropped: dropped.length,
  references: kept,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`kept ${kept.length}  dropped ${dropped.length}  maxDist=${MAX_DIST}`);
const leaks = dropped.filter((r) => r.d < 0);
const far = dropped.filter((r) => r.d >= 0);
console.log(`control-set leaks skipped: ${leaks.length}  (${leaks.map((l) => l.id).join(", ")})`);
console.log("dropped (likely wrong face / era):");
for (const r of far.sort((a, b) => b.d - a.d).slice(0, 15)) {
  console.log(`  ${r.id}  d=${r.d}`);
}
