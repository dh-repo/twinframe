import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  CELEB_ID_ALIASES,
  EMPTY_GALLERY_DEMOTIONS,
  NEAR_CLONE_REVIEW_MAX,
  applyReviewedDemotions,
  approvedDropIds,
  isGalleryDemotionReason,
  parseGalleryDemotions,
  proposeDemotionEntries,
  type DemotionPairInput,
} from "./gallery-demotions.ts";

const SHIPPED = path.resolve(process.cwd(), "public/celebs/gallery-demotions.json");
const BINARY = path.resolve(process.cwd(), "public/celebs/embeddings.v4.q8.bin");

function spec(overrides: Record<string, unknown> = {}) {
  return parseGalleryDemotions({
    version: 1,
    approved: [],
    proposed: [],
    ...overrides,
  });
}

describe("parseGalleryDemotions", () => {
  it("accepts an empty reviewed spec", () => {
    const parsed = spec();
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.approved, []);
    assert.deepEqual(parsed.proposed, []);
  });

  it("rejects approved rows without reviewedAt", () => {
    assert.throws(
      () =>
        spec({
          approved: [
            {
              id: "gwenyth-paltrow",
              reason: "exact-clone",
              keep: "gwyneth-paltrow",
              evidence: "clone",
            },
          ],
        }),
      /reviewedAt required/,
    );
  });

  it("rejects unknown reasons", () => {
    assert.throws(
      () =>
        spec({
          proposed: [{ id: "x", reason: "lookalike-range", evidence: "crowded" }],
        }),
      /invalid reason/,
    );
  });

  it("labels every reason exhaustively", () => {
    assert.equal(isGalleryDemotionReason("exact-clone"), true);
    assert.equal(isGalleryDemotionReason("identity-range"), true);
    assert.equal(isGalleryDemotionReason("suspect"), true);
    assert.equal(isGalleryDemotionReason("reviewed-drop"), true);
    assert.equal(isGalleryDemotionReason("lookalike-range"), false);
  });
});

describe("applyReviewedDemotions", () => {
  const rows = [
    { id: "gwenyth-paltrow", name: "typo" },
    { id: "gwyneth-paltrow", name: "canonical" },
    { id: "adele", name: "Adele" },
  ];

  it("drops approved ids and leaves proposed ids", () => {
    const parsed = spec({
      approved: [
        {
          id: "gwenyth-paltrow",
          reason: "exact-clone",
          keep: "gwyneth-paltrow",
          evidence: "typo clone",
          reviewedAt: "2026-08-26",
        },
      ],
      proposed: [
        {
          id: "adele",
          reason: "identity-range",
          evidence: "should not drop",
        },
      ],
    });
    assert.deepEqual(
      applyReviewedDemotions(rows, parsed).map((r) => r.id),
      ["gwyneth-paltrow", "adele"],
    );
    assert.equal(approvedDropIds(parsed).has("adele"), false);
  });

  it("never drops a keep id even if it is also listed as approved", () => {
    const parsed = spec({
      approved: [
        {
          id: "gwyneth-paltrow",
          reason: "exact-clone",
          keep: "gwyneth-paltrow",
          evidence: "mistaken both-sides approval",
          reviewedAt: "2026-08-26",
        },
      ],
    });
    assert.deepEqual(
      applyReviewedDemotions(rows, parsed).map((r) => r.id),
      ["gwenyth-paltrow", "gwyneth-paltrow", "adele"],
    );
  });

  it("is a no-op for an empty spec", () => {
    assert.deepEqual(
      applyReviewedDemotions(rows, EMPTY_GALLERY_DEMOTIONS).map((r) => r.id),
      rows.map((r) => r.id),
    );
  });
});

describe("proposeDemotionEntries", () => {
  it("drops the known alias on an exact clone and leaves the keep id", () => {
    const pairs: DemotionPairInput[] = [
      {
        a: "gwenyth-paltrow",
        b: "gwyneth-paltrow",
        distance: 0,
        band: "clone",
      },
    ];
    const proposed = proposeDemotionEntries(pairs);
    assert.equal(proposed.length, 1);
    assert.equal(proposed[0]?.id, "gwenyth-paltrow");
    assert.equal(proposed[0]?.keep, "gwyneth-paltrow");
    assert.equal(proposed[0]?.reason, "exact-clone");
    assert.equal(CELEB_ID_ALIASES["gwenyth-paltrow"], "gwyneth-paltrow");
  });

  it("lists both sides of a clone without a known alias", () => {
    const proposed = proposeDemotionEntries([
      { a: "alpha", b: "beta", distance: 0, band: "clone" },
    ]);
    assert.deepEqual(
      proposed.map((p) => p.id).sort(),
      ["alpha", "beta"],
    );
    assert.ok(proposed.every((p) => p.keep === undefined));
  });

  it("proposes tight identity-range pairs and ignores look-alike crowding", () => {
    const proposed = proposeDemotionEntries([
      { a: "near-a", b: "near-b", distance: NEAR_CLONE_REVIEW_MAX, band: "identity-range" },
      { a: "far-a", b: "far-b", distance: NEAR_CLONE_REVIEW_MAX + 0.001, band: "identity-range" },
      { a: "like-a", b: "like-b", distance: 0.45, band: "lookalike-range" },
    ]);
    assert.deepEqual(
      proposed.map((p) => p.id).sort(),
      ["near-a", "near-b"],
    );
    assert.ok(proposed.every((p) => p.reason === "identity-range"));
  });
});

describe("shipped gallery-demotions.json", () => {
  it("approves the gwenyth typo clone and does not apply proposed ids", () => {
    const parsed = parseGalleryDemotions(JSON.parse(fs.readFileSync(SHIPPED, "utf8")));
    const typo = parsed.approved.find((e) => e.id === "gwenyth-paltrow");
    assert.ok(typo, "gwenyth-paltrow must be an approved drop");
    assert.equal(typo.reason, "exact-clone");
    assert.equal(typo.keep, "gwyneth-paltrow");
    assert.ok(typo.reviewedAt);

    const rows = [
      { id: "gwenyth-paltrow" },
      { id: "gwyneth-paltrow" },
      { id: "adele" },
      ...parsed.proposed.map((e) => ({ id: e.id })),
    ];
    const kept = new Set(applyReviewedDemotions(rows, parsed).map((r) => r.id));
    assert.equal(kept.has("gwenyth-paltrow"), false);
    assert.equal(kept.has("gwyneth-paltrow"), true);
    for (const entry of parsed.proposed) {
      if (entry.id === "gwenyth-paltrow") continue;
      assert.equal(kept.has(entry.id), true, `proposed ${entry.id} must not be dropped`);
    }
  });

  it("does not rewrite the shipped AFv4 binary", () => {
    const before = createHash("sha256").update(fs.readFileSync(BINARY)).digest("hex");
    const parsed = parseGalleryDemotions(JSON.parse(fs.readFileSync(SHIPPED, "utf8")));
    applyReviewedDemotions([{ id: "gwenyth-paltrow" }, { id: "gwyneth-paltrow" }], parsed);
    const after = createHash("sha256").update(fs.readFileSync(BINARY)).digest("hex");
    assert.equal(after, before);
    assert.equal(fs.existsSync(BINARY), true);
  });
});
