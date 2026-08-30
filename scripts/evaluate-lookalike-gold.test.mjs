import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyGoldCase,
  civilianGoldReady,
  formatGoldSummary,
  listCivilianGoldPhotos,
} from "./lib/lookalike-gold.mjs";
import { evaluateGoldSet } from "./evaluate-lookalike-gold.mjs";
import { loadGallery, mergeExtraTemplates } from "./evaluate-held-out-v2.ts";
import { decodeV4Header } from "./lib/gallery-binary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOLD = path.join(ROOT, "public/celebs/lookalike-gold.json");
const FIXTURES = path.join(ROOT, "fixtures/gold");
const BIN = path.join(ROOT, "public/celebs/embeddings.v4.q8.bin");

describe("lookalike gold classification", () => {
  it("labels identity seeds as closed-set regression", () => {
    assert.equal(
      classifyGoldCase({ id: "identity-adele", notes: "Enrolled self-vector regression.", acceptableTopIds: ["adele"] }),
      "identity-regression",
    );
  });

  it("labels synthetic refuses as floor smoke", () => {
    assert.equal(classifyGoldCase({ id: "no-match-random-1", expectRefuse: true, acceptableTopIds: [] }), "refuse-smoke");
  });

  it("treats a real photo with --refuse as civilian refuse, not an invented look-alike name", () => {
    assert.equal(
      classifyGoldCase({
        id: "civilian-01",
        imagePath: "fixtures/gold/civilian-01.jpg",
        expectRefuse: true,
        acceptableTopIds: [],
      }),
      "civilian",
    );
  });

  it("labels civilian ids even before a fixture is attached", () => {
    assert.equal(
      classifyGoldCase({ id: "civilian-01", acceptableTopIds: ["ana-de-armas"], fixture: "fixtures/gold/civilian-01.jpg" }),
      "civilian",
    );
  });
});

describe("shipped gold set stays honest", () => {
  const set = JSON.parse(fs.readFileSync(GOLD, "utf8"));
  const header = decodeV4Header(fs.readFileSync(BIN));

  it("does not invent civilian descriptors or look-alike names", () => {
    const kinds = (set.cases ?? []).map((c) => classifyGoldCase(c));
    assert.ok(kinds.includes("identity-regression"), "expected identity seeds");
    assert.ok(kinds.includes("refuse-smoke"), "expected synthetic refuse seeds");
    const photos = listCivilianGoldPhotos(FIXTURES);
    assert.ok(photos.length >= 12, "expected royalty-free gold photos on disk");
    assert.ok(fs.existsSync(path.join(FIXTURES, "ATTRIBUTION.md")));
    const civilians = (set.cases ?? []).filter((c) => classifyGoldCase(c) === "civilian");
    for (const c of civilians) {
      assert.ok(c.imagePath && fs.existsSync(path.join(ROOT, c.imagePath)), `${c.id} missing fixture`);
      assert.equal(c.expectRefuse, true, `${c.id} must not invent an accept list`);
      assert.deepEqual(c.acceptableTopIds, [], `${c.id} invented look-alike names`);
      assert.equal(c.queryDescriptor?.length, header.dimension, `${c.id} dim must match AFv4 header`);
    }
  });

  it("reports civilian acceptable@1 as N/A until humans name look-alikes", () => {
    assert.ok(listCivilianGoldPhotos(FIXTURES).length >= 12);
    assert.equal(civilianGoldReady(FIXTURES), true);
    const lines = formatGoldSummary({
      identityN: 8,
      identityTop1: 8,
      refuseN: 8,
      refuseOk: 8,
      civilianN: 0,
      civilianTop1: 0,
      civilianRefuseN: 16,
      civilianRefuseOk: 14,
      civilianReady: true,
    });
    assert.ok(lines.some((l) => l.includes("closed-set identity regression")));
    assert.ok(lines.some((l) => l.includes("refuse-smoke")));
    assert.ok(lines.some((l) => /civilian acceptable@1=N\/A/.test(l)));
    assert.ok(!lines.some((l) => /civilian acceptable@1=\d/.test(l)));
    assert.ok(lines.some((l) => /civilian refuse_ok=/.test(l)));
  });

  it("pins gold descriptor dim to the AFv4 gallery header", () => {
    assert.equal(header.dimension, 512);
    for (const c of set.cases ?? []) {
      if (!c.queryDescriptor) continue;
      assert.equal(c.queryDescriptor.length, header.dimension, `${c.id} dim !== gallery header`);
    }
  });

  it("identity seeds retrieve Top-1 on the live ranking gallery (jpg + extras)", () => {
    const gallery = mergeExtraTemplates(loadGallery());
    assert.ok(
      gallery.length >= 600,
      `gold eval must use extra-templates like the product path, got ${gallery.length}`,
    );
    const { stats, summary } = evaluateGoldSet(set, gallery, { expectedDim: header.dimension });
    assert.equal(stats.identityN, 8);
    assert.equal(stats.identityTop1, 8, `identity regression missed ${stats.identityN - stats.identityTop1} seeds`);
    assert.ok(stats.refuseN >= 8);
    assert.equal(stats.refuseOk, stats.refuseN, "a refuse seed presented a look-alike");
    assert.equal(stats.civilianN, 0, "acceptable@1 stays N/A — do not invent accept lists");
    assert.ok(summary.some((l) => /civilian acceptable@1=N\/A/.test(l)));
  });
});
