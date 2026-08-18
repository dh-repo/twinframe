import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { composeMatchBlurb } from "../ux/match-blurb.ts";
import {
  applyGalleryFeatureManifest,
  galleryFeatureCount,
  galleryFeaturesFor,
  resetGalleryFeaturesForTests,
} from "./gallery-features.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const FEATURES_PATH = join(ROOT, "public/celebs/gallery.features.json");

afterEach(() => {
  resetGalleryFeaturesForTests();
});

describe("galleryFeaturesFor", () => {
  it("returns kate-winslet geometry from the shipping manifest", () => {
    applyGalleryFeatureManifest(JSON.parse(readFileSync(FEATURES_PATH, "utf8")));
    assert.ok(galleryFeatureCount() >= 800);
    const kate = galleryFeaturesFor("kate-winslet");
    assert.ok(kate);
    assert.ok((kate.cheekboneProminence ?? 0) > 0.6);
    assert.ok((kate.lipFullness ?? 0) > 0.6);
  });

  it("drives a distinctive-trait blurb without the tiny CELEBRITIES table", () => {
    applyGalleryFeatureManifest(JSON.parse(readFileSync(FEATURES_PATH, "utf8")));
    const blurb = composeMatchBlurb({
      name: "Kate Winslet",
      gender: "female",
      tags: ["classic", "expressive"],
      celebFeatures: galleryFeaturesFor("kate-winslet"),
    });
    assert.match(blurb, /^You share her /);
    assert.ok(!blurb.includes("share a look"));
  });

  it("returns null for an unknown id", () => {
    applyGalleryFeatureManifest({ "kate-winslet": { lipFullness: 0.8 } });
    assert.equal(galleryFeaturesFor("not-a-celeb"), null);
  });
});
