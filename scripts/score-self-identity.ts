#!/usr/bin/tsx
/**
 * Same-person identity retrieval: a different photo of celeb X
 * must rank X first. Does not enroll query photos.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGalleryDataNode, getCanonicalCelebId } from "./evaluate-match-accuracy.ts";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { ensembleDistance } from "../src/lib/face/embeddings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_D = Number(process.env.SELF_VALID_D || 0.48);

type Case = {
  id: string;
  name?: string;
  descriptor?: number[];
  source?: string;
  age?: number;
  gender?: "male" | "female";
};

function loadCases(p: string): Case[] {
  if (!fs.existsSync(p)) return [];
  return (JSON.parse(fs.readFileSync(p, "utf8")).cases ?? []) as Case[];
}

const gallery = loadGalleryDataNode(ROOT);
const byId = new Map(gallery.map((g) => [getCanonicalCelebId(g.id), g]));

const queries: Array<Case & { protocol: string }> = [
  ...loadCases(path.join(ROOT, "public/celebs/control/descriptors.json")).map((c) => ({
    ...c,
    protocol: "control",
  })),
  ...loadCases(path.join(ROOT, "public/celebs/held-out/descriptors.json")).map((c) => ({
    ...c,
    protocol: "held-out",
  })),
];

let scored = 0;
let rank1 = 0;
let rank5 = 0;
let validN = 0;
let valid1 = 0;
let valid5 = 0;
const rows: string[] = [];
const misses: string[] = [];

console.log("SELF-IDENTITY  gallery=" + gallery.length + "  queries=" + queries.length);
console.log(
  "proto".padEnd(10) +
    "id".padEnd(24) +
    "top1".padEnd(24) +
    "pct".padStart(6) +
    "  r   d_self  result",
);
console.log("-".repeat(96));

for (const c of queries) {
  if (!c.descriptor || c.descriptor.length !== 128) continue;
  const want = getCanonicalCelebId(c.id);
  const enrolled = byId.get(want);
  if (!enrolled) continue;
  const matches = rankByDescriptor(
    {
      descriptor: Float32Array.from(c.descriptor),
      age: enrolled.age ?? c.age ?? 35,
      gender: enrolled.gender ?? c.gender ?? "unknown",
      genderProbability: 0.9,
    },
    gallery,
    5,
  );
  scored++;
  const ids = matches.map((m) => getCanonicalCelebId(m.celebrityId));
  const r = ids.indexOf(want) + 1;
  if (r === 1) rank1++;
  if (r > 0) rank5++;
  const dSelf = ensembleDistance(c.descriptor, enrolled.descriptor);
  const valid = dSelf <= VALID_D;
  if (valid) {
    validN++;
    if (r === 1) valid1++;
    if (r > 0) valid5++;
  }
  const hit = r === 1 ? "HIT" : r > 0 ? `rank${r}` : "MISS";
  const line = `${c.protocol.padEnd(10)}${want.padEnd(24)}${(matches[0]?.name ?? "?").padEnd(24)}${String(matches[0]?.matchPercent ?? 0).padStart(6)}  ${String(r || "-").padStart(2)}  ${dSelf.toFixed(3)}  ${hit}${valid ? "" : "  invalid"}`;
  rows.push(line);
  if (r !== 1) misses.push(line);
}

for (const line of rows) console.log(line);
console.log("-".repeat(96));
console.log(`all queries     Rank-1 ${scored ? ((rank1 / scored) * 100).toFixed(1) : 0}%  (${rank1}/${scored})   Rank-5 ${scored ? ((rank5 / scored) * 100).toFixed(1) : 0}%  (${rank5}/${scored})`);
console.log(`valid d≤${VALID_D}   Rank-1 ${validN ? ((valid1 / validN) * 100).toFixed(1) : 0}%  (${valid1}/${validN})   Rank-5 ${validN ? ((valid5 / validN) * 100).toFixed(1) : 0}%  (${valid5}/${validN})`);
if (misses.length) {
  console.log(`\nmisses ${misses.length}:`);
  for (const m of misses) console.log(m);
}
