import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collapseSameIdDescriptorClones,
  dropCrossIdExactCollisions,
  sanitizeGalleryEmbeddings,
} from "./gallery-dedupe.ts";
import type { CelebrityEmbedding } from "./embeddings.ts";

function emb(
  id: string,
  desc: number[],
  extra: Partial<CelebrityEmbedding> = {},
): CelebrityEmbedding {
  return {
    id,
    name: id,
    path: `/${id}.jpg`,
    descriptor: desc,
    age: 30,
    gender: "female",
    genderProb: 0.9,
    ...extra,
  };
}

describe("gallery-dedupe", () => {
  it("collapses same-id exact clones to one row", () => {
    const d = Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1));
    const out = collapseSameIdDescriptorClones([
      emb("a", d, { age: 20 }),
      emb("a", d, { age: 40 }),
      emb("b", d.map((x) => x + 0.5)),
    ]);
    assert.equal(out.filter((e) => e.id === "a").length, 1);
    assert.equal(out.filter((e) => e.id === "b").length, 1);
  });

  it("drops all ids that share an exact cross-id collision vector", () => {
    const shared = Array.from({ length: 128 }, (_, i) => Math.cos(i * 0.07));
    const unique = Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.13));
    const { gallery, droppedIds } = dropCrossIdExactCollisions([
      emb("alice", shared),
      emb("bob", shared),
      emb("carol", unique),
    ]);
    assert.ok(droppedIds.includes("alice") && droppedIds.includes("bob"));
    assert.equal(gallery.length, 1);
    assert.equal(gallery[0]!.id, "carol");
  });

  it("sanitizeGalleryEmbeddings runs both steps", () => {
    const shared = Array.from({ length: 128 }, () => 0.02);
    const u = Array.from({ length: 128 }, (_, i) => (i % 7) * 0.01 + 0.05);
    const { gallery, droppedCrossId } = sanitizeGalleryEmbeddings([
      emb("x", shared, { age: 20 }),
      emb("x", shared, { age: 50 }),
      emb("y", shared),
      emb("z", u),
    ]);
    assert.ok(droppedCrossId.includes("x") && droppedCrossId.includes("y"));
    assert.ok(gallery.every((e) => e.id === "z"));
  });
});
