import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDrops,
  dropIds,
  parseGalleryReview,
  unsetReviewIds,
} from "./gallery-review.ts";

describe("parseGalleryReview", () => {
  it("accepts drop / reenroll / keep and rejects junk", () => {
    const parsed = parseGalleryReview({
      version: "1.0.0",
      decisions: { "gwenyth-paltrow": "drop", "gwyneth-paltrow": "keep" },
    });
    assert.deepEqual(dropIds(parsed.decisions), ["gwenyth-paltrow"]);
    assert.equal(parsed.decisions["gwyneth-paltrow"], "keep");
    assert.throws(
      () => parseGalleryReview({ version: "1", decisions: { a: "maybe" } }),
      /invalid decision/,
    );
  });
});

describe("unsetReviewIds / applyDrops", () => {
  it("lists suspects without a decision", () => {
    const unset = unsetReviewIds(
      ["gwenyth-paltrow", "mohanlal", "wang-yibo", "gwenyth-paltrow"],
      { "gwenyth-paltrow": "drop", "gwyneth-paltrow": "keep" },
    );
    assert.deepEqual(unset, ["mohanlal", "wang-yibo"]);
  });

  it("removes dropped ids from catalog rows and leaves others", () => {
    const rows = [
      { id: "gwyneth-paltrow", name: "Gwyneth" },
      { id: "gwenyth-paltrow", name: "Typo" },
      { id: "adele", name: "Adele" },
    ];
    const next = applyDrops(rows, ["gwenyth-paltrow"]);
    assert.deepEqual(
      next.map((r) => r.id),
      ["gwyneth-paltrow", "adele"],
    );
  });
});
