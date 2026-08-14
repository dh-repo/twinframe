#!/usr/bin/tsx
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGalleryDataNode, getCanonicalCelebId } from "./evaluate-match-accuracy.ts";
import { ensembleDistance, distanceToMatchPercent } from "../src/lib/face/embeddings.ts";
import { rankByDescriptor } from "../src/lib/face/match.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACK = path.join(ROOT, "public/celebs/control/descriptors.json");

const pack = JSON.parse(fs.readFileSync(PACK, "utf8")) as {
  cases: Array<{
    id: string;
    name: string;
    descriptor: number[];
    age?: number;
    gender?: "male" | "female";
    genderProb?: number;
    ok?: boolean;
  }>;
};
const gallery = loadGalleryDataNode(ROOT);
const byId = new Map(gallery.map((g) => [getCanonicalCelebId(g.id), g]));

let rank1 = 0;
let rank5 = 0;
let scored = 0;
const rows: string[] = [];

console.log("CONTROL SCORE  gallery=" + gallery.length);
console.log("id".padEnd(24) + "top1".padEnd(24) + "pct".padStart(6) + "  r   d_self   result");
console.log("-".repeat(88));

for (const c of pack.cases) {
  if (!c.descriptor || c.descriptor.length !== 128) continue;
  const want = getCanonicalCelebId(c.id);
  const enrolled = byId.get(want);
  if (!enrolled) {
    rows.push(`${c.id}  NOT IN GALLERY`);
    continue;
  }
  const matches = rankByDescriptor(
    {
      descriptor: Float32Array.from(c.descriptor),
      age: c.age ?? enrolled.age ?? 35,
      // Identity control: use the enrolled label, not the crop detector
      // (Viola's control crop was tagged male at 0.92 and then lost to men).
      gender: enrolled.gender ?? c.gender ?? "unknown",
      genderProbability: Math.max(c.genderProb ?? 0.7, 0.9),
    },
    gallery,
    5,
  );
  scored++;
  const ids = matches.map((m) => getCanonicalCelebId(m.celebrityId));
  const top = matches[0];
  const r = ids.indexOf(want) + 1;
  if (r === 1) rank1++;
  if (r > 0) rank5++;
  const dSelf = ensembleDistance(c.descriptor, enrolled.descriptor);
  const hit = r === 1 ? "HIT" : r > 0 ? `rank${r}` : "MISS";
  const line = `${c.id.padEnd(24)}${(top?.name ?? "?").padEnd(24)}${String(top?.matchPercent ?? 0).padStart(6)}  ${String(r || "-").padStart(2)}  ${dSelf.toFixed(3)}   ${hit}`;
  console.log(line);
  if (r !== 1) {
    console.log("   top5: " + matches.map((m) => `${m.name} ${m.matchPercent}%`).join(" | "));
  }
}

console.log("-".repeat(88));
console.log(`scored ${scored}`);
console.log(`Rank-1  ${scored ? ((rank1 / scored) * 100).toFixed(1) : 0}%   (${rank1}/${scored})`);
console.log(`Rank-5  ${scored ? ((rank5 / scored) * 100).toFixed(1) : 0}%   (${rank5}/${scored})`);
