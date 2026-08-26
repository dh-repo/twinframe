#!/usr/bin/env node
/**
 * Refresh identity gold seeds from the shipped AdaFace-512 gallery.
 *
 * These cases are closed-set self-vector regression, not civilian look-alikes.
 * Copying the enrolled row is the honest AdaFace encoding — do not invent
 * civilian descriptors here.
 *
 * Usage:
 *   node --experimental-strip-types scripts/refresh-gold-identity-seeds.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadV4Gallery } from "./lib/v4-gallery.mjs";
import { refreshIdentitySeeds } from "./lib/gold-identity-seeds.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOLD = path.join(ROOT, "public/celebs/lookalike-gold.json");

function main() {
  const set = JSON.parse(fs.readFileSync(GOLD, "utf8"));
  const { gallery, header } = loadV4Gallery(ROOT);
  const { refreshed } = refreshIdentitySeeds(set, gallery);
  set.version = "2.0.0-adaface512";
  set.description =
    "Open-set look-alike gold on AdaFace-512. Identity seeds are enrolled self-vectors from embeddings.v4.q8.bin (closed-set regression — not the product metric). Refuse seeds smoke-test the distance floor. Civilian acceptable@1 is omitted until real photos exist under fixtures/gold/ with human acceptableTopIds or expectRefuse — do not invent descriptors.";
  fs.writeFileSync(GOLD, JSON.stringify(set));
  console.log(
    `refreshed ${refreshed} identity seeds from AFv4 dim=${header.dimension} → ${GOLD}`,
  );
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
