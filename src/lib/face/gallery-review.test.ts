import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  applyDrops,
  dropIds,
  fillUnsetAsReenroll,
  parseGalleryReview,
  unsetReviewIds,
} from "./gallery-review.ts";

const CELEBS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public/celebs");

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

  it("defaults only missing audit ids to reenroll", () => {
    const filled = fillUnsetAsReenroll(
      { "gwenyth-paltrow": "drop", "gwyneth-paltrow": "keep" },
      ["gwenyth-paltrow", "mohanlal", "wang-yibo", "mohanlal"],
    );
    assert.equal(filled["gwenyth-paltrow"], "drop");
    assert.equal(filled["gwyneth-paltrow"], "keep");
    assert.equal(filled.mohanlal, "reenroll");
    assert.equal(filled["wang-yibo"], "reenroll");
    assert.deepEqual(unsetReviewIds(["gwenyth-paltrow", "mohanlal", "wang-yibo"], filled), []);
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

describe("live gallery-review.json", () => {
  it("covers every audit demotion and only drops the typo clone", () => {
    const review = parseGalleryReview(
      JSON.parse(readFileSync(path.join(CELEBS, "gallery-review.json"), "utf8")),
    );
    const audit = JSON.parse(readFileSync(path.join(CELEBS, "gallery-audit-v4.json"), "utf8"));
    const suspects = audit.demotionIds as string[];
    assert.deepEqual(unsetReviewIds(suspects, review.decisions), []);
    assert.deepEqual(dropIds(review.decisions), ["gwenyth-paltrow"]);
    assert.equal(review.decisions["gwyneth-paltrow"], "keep");
    assert.equal(
      Object.values(review.decisions).filter((d) => d === "reenroll").length,
      119,
    );
  });
});
