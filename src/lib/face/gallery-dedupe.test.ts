import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMultiShotCentroidGallery,
  computeCentroidEmbedding,
  dropPoisonedNearCloneClusters,
  isPaddedFaceNetDescriptor,
  POISONED_CLUSTER_MIN_IDS,
} from "./gallery-dedupe.ts";
import { cosineDistance256, l2Normalize, type CelebrityEmbedding } from "./embeddings.ts";

function emb(
  id: string,
  descriptor: number[],
): CelebrityEmbedding {
  return {
    id,
    path: `/${id}.jpg`,
    name: id,
    descriptor,
    age: 40,
    gender: "female",
    genderProb: 0.9,
  };
}

describe("multi-shot prototypes", () => {
  it("detects FaceNet-padded 256-d vectors", () => {
    const real = Array.from(l2Normalize(Float32Array.from({ length: 256 }, (_, i) => (i % 7) + 1)));
    const padded = new Array(256).fill(0);
    for (let i = 0; i < 128; i++) padded[i] = ((i % 5) + 1) * 0.1;
    assert.equal(isPaddedFaceNetDescriptor(real), false);
    assert.equal(isPaddedFaceNetDescriptor(padded), true);
    const oneHot = Array.from(
      l2Normalize(Float32Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0))),
    );
    assert.equal(isPaddedFaceNetDescriptor(oneHot), false);
  });

  it("keeps all real templates and appends the centroid prototype", () => {
    const a = Array.from(l2Normalize(Float32Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0))));
    const b = Array.from(l2Normalize(Float32Array.from({ length: 256 }, (_, i) => (i === 1 ? 1 : 0))));
    const c = Array.from(l2Normalize(Float32Array.from({ length: 256 }, (_, i) => (i === 2 ? 1 : 0))));
    const gallery = [emb("x", a), emb("x", b), emb("x", c), emb("y", a)];
    const out = buildMultiShotCentroidGallery(gallery);
    const xs = out.filter((e) => e.id === "x");
    const ys = out.filter((e) => e.id === "y");
    assert.equal(ys.length, 1);
    // 3 originals + 1 centroid
    assert.equal(xs.length, 4);
    // Primary template must survive untouched (best-of-N matching relies on it)
    assert.ok(xs.some((e) => cosineDistance256(e.descriptor, a) < 1e-6));
    const centroid = computeCentroidEmbedding([a, b, c]);
    assert.ok(xs.some((e) => cosineDistance256(e.descriptor, centroid) < 1e-5));
  });
});

describe("poisoned near-clone clusters", () => {
  it("keeps two similar people and drops an 8-id identical-face pile", () => {
    const face = Array.from(l2Normalize(Float32Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : 0.01 * i))));
    const other = Array.from(l2Normalize(Float32Array.from({ length: 32 }, (_, i) => (i === 1 ? 1 : 0))));
    const pile = Array.from({ length: POISONED_CLUSTER_MIN_IDS }, (_, i) => emb(`clone-${i}`, face));
    const kept = dropPoisonedNearCloneClusters([...pile, emb("adele", other)]);
    assert.equal(kept.droppedIds.length, POISONED_CLUSTER_MIN_IDS);
    assert.ok(!kept.droppedIds.includes("adele"));
    assert.equal(kept.gallery.some((e) => e.id === "adele"), true);
    assert.equal(kept.gallery.some((e) => e.id.startsWith("clone-")), false);
  });

  it("does not drop a pair of distinct look-alikes", () => {
    const a = Array.from(l2Normalize(Float32Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : 0))));
    const b = Array.from(l2Normalize(Float32Array.from({ length: 32 }, (_, i) => (i === 0 ? 0.96 : i === 1 ? 0.28 : 0))));
    const out = dropPoisonedNearCloneClusters([emb("one", a), emb("two", b)]);
    assert.deepEqual(out.droppedIds, []);
    assert.equal(out.gallery.length, 2);
  });
});
