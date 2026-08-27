import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isThumbOnlyEnrollment } from "../src/lib/face/gallery-dedupe.ts";
import { loadV4Gallery } from "./lib/v4-gallery.mjs";
import { loadGallery, mergeExtraTemplates } from "./evaluate-held-out-v2.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

describe("ranking gallery is verified jpg primaries only", () => {
  const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
  const { gallery } = loadV4Gallery(ROOT);
  const rankingIds = new Set(gallery.map((row) => row.id));

  it("drops every thumb-only bucket from ranking and keeps household jpg identities", () => {
    const thumbs = gallery.filter((row) => isThumbOnlyEnrollment(row));
    assert.equal(thumbs.length, 0, `ranking still contains thumb-only rows: ${thumbs.slice(0, 8).map((r) => r.id)}`);
    assert.ok(rankingIds.size >= 500, `expected >=500 verified identities, got ${rankingIds.size}`);
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
      assert.ok(rankingIds.has(id), `${id} jpg primary missing from ranking`);
    }
  });

  it("does not rank known thumb-only namesakes or poisoned-halo extras", () => {
    for (const id of [
      "leon-rippy",
      "josh-carter",
      "anna-sharma",
      "jacinto-taras-riddick",
      "robert-beitzel",
      "glenn-ennis",
      "mackenzie-gray",
    ]) {
      assert.equal(rankingIds.has(id), false, `${id} should not rank without a verified primary`);
    }
  });

  it("catalog still lists thumb-only people for browse", () => {
    const catalogThumbs = buckets.filter((b) => isThumbOnlyEnrollment(b));
    assert.ok(catalogThumbs.length >= 400, `expected leftover browse thumbs, got ${catalogThumbs.length}`);
    assert.ok(
      catalogThumbs.every((b) => !rankingIds.has(b.id)),
      "a thumb-only catalog id leaked into ranking",
    );
  });

  it("held-out eval ranking agrees with the live loader: no thumb-only ids", () => {
    const heldOut = mergeExtraTemplates(loadGallery());
    const heldIds = new Set(heldOut.map((row) => row.id));
    assert.equal(heldOut.filter((row) => isThumbOnlyEnrollment(row)).length, 0);
    assert.ok(heldIds.has("zendaya"));
    assert.equal(heldIds.has("leon-rippy"), false);
    for (const id of rankingIds) {
      assert.ok(heldIds.has(id), `live ranking id ${id} missing from held-out gallery`);
    }
  });
});
