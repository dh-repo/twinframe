import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { cosineDistance, decodeV4Gallery } from "./lib/gallery-binary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function primaryById() {
  const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
  const { vectors } = decodeV4Gallery(fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin")));
  const byId = new Map();
  for (let i = 0; i < buckets.length; i++) {
    if (!byId.has(buckets[i].id)) byId.set(buckets[i].id, vectors[i]);
  }
  return byId;
}

describe("shipped primaries of different people are not near-clones", () => {
  const byId = primaryById();

  const pairs = [
    ["xiao-zhan", "roger-federer"],
    ["samuel-l-jackson", "ryan-reynolds"],
    ["son-ye-jin", "hyun-bin"],
    ["robert-downey-jr", "jamie-dornan"],
    ["cha-eun-woo", "chris-pine"],
    ["neymar", "kylian-mbappe"],
    ["lebron-james", "halle-bailey"],
    ["rafael-nadal", "bruce-macvittie"],
    ["rafael-nadal", "rami-malek"],
    ["colin-salmon", "samuel-l-jackson"],
    ["son-ye-jin", "rose-blackpink"],
  ];

  for (const [a, b] of pairs) {
    it(`${a} is not ${b}`, () => {
      const va = byId.get(a);
      const vb = byId.get(b);
      assert.ok(va, `missing ${a}`);
      assert.ok(vb, `missing ${b}`);
      const d = cosineDistance(va, vb);
      assert.ok(d > 0.4, `${a} vs ${b} d=${d.toFixed(3)} still collapsed`);
    });
  }
});
