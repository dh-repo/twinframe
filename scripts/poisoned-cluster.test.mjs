import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dropPoisonedNearCloneClusters } from "../src/lib/face/gallery-dedupe.ts";
import { cosineDistance, decodeV4Gallery } from "./lib/gallery-binary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

describe("shipped gallery poisoned thumb cluster", () => {
  const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
  const { vectors } = decodeV4Gallery(fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin")));
  const rows = buckets.map((b, i) => ({ id: b.id, descriptor: vectors[i] }));
  const { gallery, droppedIds } = dropPoisonedNearCloneClusters(rows);

  it("drops the remaining near-clone pile and keeps repaired identities", () => {
    assert.ok(droppedIds.length >= 70, `expected a large cluster, dropped ${droppedIds.length}`);
    for (const id of [
      "adele",
      "zendaya",
      "ke-huy-quan",
      "rafael-nadal",
      "harrison-ford",
      "rosalia",
      "lee-majdoub",
      "michael-xavier",
      "adam-stein",
    ]) {
      assert.equal(droppedIds.includes(id), false, `${id} was dropped with the poisoned pile`);
      assert.ok(gallery.some((r) => r.id === id), `${id} missing after cluster drop`);
    }
  });

  it("dropped ids really were near-clones of each other", () => {
    const byId = new Map(rows.map((r) => [r.id, r.descriptor]));
    const sample = droppedIds.slice(0, 12);
    let near = 0;
    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        if (cosineDistance(byId.get(sample[i]), byId.get(sample[j])) < 0.08) near++;
      }
    }
    assert.ok(near >= 20, `dropped sample was not a cluster (near pairs ${near})`);
  });
});
