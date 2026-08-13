#!/usr/bin/tsx
/**
 * Build public/celebs/gold-set.json from real control + held-out encodings.
 * Identity labels only — query photos are not enrolled.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCanonicalCelebId, loadGalleryDataNode } from "./evaluate-match-accuracy.ts";
import { ensembleDistance } from "../src/lib/face/embeddings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type Case = {
  id: string;
  descriptor?: number[];
  source?: string;
  age?: number;
  gender?: "male" | "female";
  genderProb?: number;
  name?: string;
};

function loadCases(p: string): Case[] {
  if (!fs.existsSync(p)) return [];
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return (j.cases ?? []) as Case[];
}

const gallery = loadGalleryDataNode(ROOT);
const galleryIds = new Set(gallery.map((g) => getCanonicalCelebId(g.id)));
const byId = new Map(gallery.map((g) => [getCanonicalCelebId(g.id), g]));

const control = loadCases(path.join(ROOT, "public/celebs/control/descriptors.json"));
const held = loadCases(path.join(ROOT, "public/celebs/held-out/descriptors.json"));

const cases: Array<Record<string, unknown>> = [];

function add(c: Case, protocol: string) {
  if (!c.descriptor || c.descriptor.length !== 128) return;
  const id = getCanonicalCelebId(c.id);
  if (!galleryIds.has(id)) return;
  const enrolled = byId.get(id);
  if (!enrolled) return;
  const dSelf = ensembleDistance(c.descriptor, enrolled.descriptor);
  if (dSelf > 0.48) return;
  const slot = (c.source || "").split("/").pop()?.replace(/\.[^.]+$/, "") || "q";
  cases.push({
    id: `${protocol}-${id}-${slot}`,
    notes: `${protocol} identity query for ${c.name || id} (${slot})`,
    imagePath: c.source,
    queryDescriptor: c.descriptor,
    acceptableTopIds: [id],
    acceptableTopK: 1,
    expectedGender: enrolled?.gender ?? c.gender,
    queryAge: enrolled?.age ?? c.age ?? 35,
    queryGender: enrolled?.gender ?? c.gender ?? "unknown",
    queryGenderProb: 0.9,
  });
}

for (const c of control) add(c, "control");
for (const c of held) add(c, "held-out");

const out = {
  version: "2.0.0",
  description:
    "Real labeled identity gold set from distinct control + held-out encodings. Not perturbed self-vectors.",
  cases,
};
const dest = path.join(ROOT, "public/celebs/gold-set.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`gold-set ${cases.length} cases → ${path.relative(ROOT, dest)}`);
