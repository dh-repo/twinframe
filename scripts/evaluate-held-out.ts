#!/usr/bin/env tsx
/**
 * Held-out identity protocol (honest Rank-1).
 *
 * Drop extra photos (not the enrolled Wikipedia thumb) at:
 *   public/celebs/held-out/<celeb-id>/001.jpg
 *
 * This script only inventories the slice and refuses to pretend it scored
 * images. Full embedding still needs the browser FaceNet path
 * (`npx playwright` + /re-encode or a future Playwright gold runner).
 *
 * Empty dir → exit 0 with instructions (so CI does not go red).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGalleryDataNode, getCanonicalCelebId } from "./evaluate-match-accuracy.ts";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { ensembleDistance } from "../src/lib/face/embeddings.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELD_OUT = path.join(ROOT, "public/celebs/held-out");
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

function main() {
  console.log("================================================================================");
  console.log("          TWINFRAME HELD-OUT IDENTITY INVENTORY                                  ");
  console.log("================================================================================");

  if (!fs.existsSync(HELD_OUT)) {
    fs.mkdirSync(HELD_OUT, { recursive: true });
    fs.writeFileSync(
      path.join(HELD_OUT, ".gitkeep"),
      "",
    );
    console.log(`Created ${path.relative(ROOT, HELD_OUT)}`);
    console.log("Add second photos as held-out/<celeb-id>/001.jpg then re-run.");
    console.log("SKIP: no held-out images yet — not a Rank-1 score.");
    process.exit(0);
  }

  const ids = fs
    .readdirSync(HELD_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let images = 0;
  const rows: Array<{ id: string; n: number }> = [];
  for (const id of ids) {
    const files = fs
      .readdirSync(path.join(HELD_OUT, id))
      .filter((f) => IMAGE_RE.test(f));
    if (files.length === 0) continue;
    images += files.length;
    rows.push({ id, n: files.length });
  }

  console.log(`Dir: ${path.relative(ROOT, HELD_OUT)}`);
  console.log(`Identities with ≥1 extra photo: ${rows.length}`);
  console.log(`Images: ${images}`);
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.id}  n=${r.n}`);
  }
  if (rows.length > 20) console.log(`  … ${rows.length - 20} more`);

  if (images === 0) {
    console.log("");
    console.log("SKIP: no held-out images. This is not Rank-1 accuracy.");
    console.log("Need a second real photo per id (not a sine-noised gallery vector).");
    process.exit(0);
  }

  const descPath = path.join(HELD_OUT, "descriptors.json");
  if (!fs.existsSync(descPath)) {
    console.log("");
    console.log("Images are present but descriptors.json is missing.");
    console.log("Run: node scripts/encode-held-out-browser.mjs");
    process.exit(0);
  }

  const pack = JSON.parse(fs.readFileSync(descPath, "utf8")) as {
    cases: Array<{
      id: string;
      descriptor: number[];
      age?: number;
      gender?: "male" | "female";
      genderProb?: number;
    }>;
  };
  const gallery = loadGalleryDataNode(ROOT);
  const byId = new Map(gallery.map((g) => [getCanonicalCelebId(g.id), g]));

  let scored = 0;
  let rank1 = 0;
  let rank5 = 0;
  let valid = 0;
  let valid1 = 0;
  let valid5 = 0;
  const misses: string[] = [];
  const VALID_D = 0.48;

  console.log("");
  console.log("Scoring held-out descriptors against the enrolled gallery…");
  console.log(`Queries: ${pack.cases.length}  gallery=${gallery.length}`);

  for (const c of pack.cases) {
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
    const hit1 = ids[0] === want;
    const hit5 = ids.includes(want);
    if (hit1) rank1++;
    if (hit5) rank5++;
    const dSelf = ensembleDistance(c.descriptor, enrolled.descriptor);
    if (dSelf <= VALID_D) {
      valid++;
      if (hit1) valid1++;
      if (hit5) valid5++;
    }
    if (!hit1) misses.push(`${c.id} → top=${ids.slice(0, 3).join(",") || "(none)"}`);
  }

  const r1 = scored ? (rank1 / scored) * 100 : 0;
  const r5 = scored ? (rank5 / scored) * 100 : 0;
  console.log("");
  console.log(`Held-out Rank-1: ${r1.toFixed(1)}%  (${rank1}/${scored})`);
  console.log(`Held-out Rank-5: ${r5.toFixed(1)}%  (${rank5}/${scored})`);
  if (valid) {
    console.log(
      `Valid d_self≤${VALID_D} Rank-1: ${((valid1 / valid) * 100).toFixed(1)}%  (${valid1}/${valid})`,
    );
    console.log(
      `Valid d_self≤${VALID_D} Rank-5: ${((valid5 / valid) * 100).toFixed(1)}%  (${valid5}/${valid})`,
    );
  }
  if (misses.length) {
    console.log("Misses (up to 20):");
    for (const m of misses.slice(0, 20)) console.log(`  ${m}`);
  }
  process.exit(0);
}

main();
