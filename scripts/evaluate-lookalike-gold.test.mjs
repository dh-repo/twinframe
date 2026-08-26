import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGoldSet } from "./evaluate-lookalike-gold.mjs";
import { identityCelebId, refreshIdentitySeeds } from "./lib/gold-identity-seeds.mjs";
import {
  classifyGoldCase,
  civilianGoldReady,
  formatGoldSummary,
  listCivilianGoldPhotos,
} from "./lib/lookalike-gold.mjs";
import { loadV4Gallery } from "./lib/v4-gallery.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOLD = path.join(ROOT, "public/celebs/lookalike-gold.json");
const FIXTURES = path.join(ROOT, "fixtures/gold");

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

  it("labels civilian ids even before a fixture is attached", () => {
    assert.equal(
      classifyGoldCase({ id: "civilian-01", acceptableTopIds: ["ana-de-armas"], fixture: "fixtures/gold/civilian-01.jpg" }),
      "civilian",
    );
  });
});

describe("shipped gold set stays honest", () => {
  const set = JSON.parse(fs.readFileSync(GOLD, "utf8"));

  it("civilian rows have real fixture files and no invented look-alike names", () => {
    const kinds = (set.cases ?? []).map((c) => classifyGoldCase(c));
    assert.ok(kinds.includes("identity-regression"), "expected identity seeds");
    assert.ok(kinds.includes("refuse-smoke"), "expected synthetic refuse seeds");
    const civilians = (set.cases ?? []).filter((c) => classifyGoldCase(c) === "civilian");
    assert.ok(civilians.length >= 12, "expected royalty-free civilian fixtures");
    for (const c of civilians) {
      assert.ok(c.imagePath && fs.existsSync(path.join(ROOT, c.imagePath)), `${c.id} missing fixture`);
      assert.equal(c.expectRefuse, true, `${c.id} must not invent an accept list`);
      assert.deepEqual(c.acceptableTopIds, [], `${c.id} invented look-alike names`);
      assert.equal(c.queryDescriptor?.length, 512, `${c.id} must be AdaFace-512`);
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
      civilianRefuseOk: 16,
      civilianReady: true,
    });
    assert.ok(lines.some((l) => l.includes("closed-set identity regression")));
    assert.ok(lines.some((l) => l.includes("refuse-smoke")));
    assert.ok(lines.some((l) => /civilian acceptable@1=N\/A/.test(l)));
    assert.ok(!lines.some((l) => /civilian acceptable@1=\d/.test(l)));
    assert.ok(lines.some((l) => /civilian refuse_ok=100\.0%/.test(l)));
  });

  it("keeps identity seeds as AdaFace-512 enrolled self-vectors", () => {
    const identities = (set.cases ?? []).filter((c) => classifyGoldCase(c) === "identity-regression");
    assert.equal(identities.length, 8);
    for (const c of identities) {
      assert.equal(c.queryDescriptor?.length, 512, `${c.id} must be 512-d`);
      assert.equal(c.encodedFrom, "public/celebs/embeddings.v4.q8.bin");
    }
  });
});

describe("refreshIdentitySeeds", () => {
  it("copies the shipped gallery row for identity cases only", () => {
    const gallery = [
      { id: "adele", descriptor: Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0)) },
      { id: "other", descriptor: Array.from({ length: 512 }, (_, i) => (i === 1 ? 1 : 0)) },
    ];
    const set = {
      cases: [
        { id: "identity-adele", notes: "Enrolled self-vector regression.", acceptableTopIds: ["adele"], queryDescriptor: [0] },
        { id: "no-match-random-1", expectRefuse: true, acceptableTopIds: [], queryDescriptor: [0.1] },
      ],
    };
    const { refreshed } = refreshIdentitySeeds(set, gallery);
    assert.equal(refreshed, 1);
    assert.equal(identityCelebId(set.cases[0]), "adele");
    assert.equal(set.cases[0].queryDescriptor.length, 512);
    assert.equal(set.cases[0].queryDescriptor[0], 1);
    assert.deepEqual(set.cases[1].queryDescriptor, [0.1]);
  });
});

describe("shipped identity seeds retrieve themselves", () => {
  it("closed-set identity regression is 8/8 against the live gallery", () => {
    const set = JSON.parse(fs.readFileSync(GOLD, "utf8"));
    const { gallery } = loadV4Gallery(ROOT);
    const { stats, summary } = evaluateGoldSet(set, gallery);
    assert.equal(stats.identityN, 8);
    assert.equal(stats.identityTop1, 8);
    assert.equal(stats.refuseN, 8);
    assert.equal(stats.refuseOk, 8);
    assert.equal(stats.civilianN, 0);
    assert.equal(stats.civilianRefuseN, 16);
    assert.ok(summary.some((l) => /identity regression @1=100\.0%/.test(l)));
    assert.ok(summary.some((l) => /civilian acceptable@1=N\/A/.test(l)));
    assert.ok(summary.some((l) => /civilian refuse_ok=/.test(l)));
  });
});
