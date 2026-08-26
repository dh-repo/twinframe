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

  it("has identity + refuse-smoke only — no invented civilian rows", () => {
    const kinds = (set.cases ?? []).map((c) => classifyGoldCase(c));
    assert.ok(kinds.includes("identity-regression"), "expected identity seeds");
    assert.ok(kinds.includes("refuse-smoke"), "expected synthetic refuse seeds");
    assert.deepEqual(
      kinds.filter((k) => k === "civilian"),
      [],
      "civilian rows require real fixtures/gold photos — do not invent descriptors",
    );
  });

  it("reports civilian acceptable@1 as N/A until real photos exist", () => {
    assert.deepEqual(listCivilianGoldPhotos(FIXTURES), []);
    assert.equal(civilianGoldReady(FIXTURES), false);
    const lines = formatGoldSummary({
      identityN: 8,
      identityTop1: 8,
      refuseN: 8,
      refuseOk: 8,
      civilianN: 0,
      civilianTop1: 0,
      civilianReady: false,
    });
    assert.ok(lines.some((l) => l.includes("closed-set identity regression")));
    assert.ok(lines.some((l) => l.includes("refuse-smoke")));
    assert.ok(lines.some((l) => /civilian acceptable@1=N\/A/.test(l)));
    assert.ok(!lines.some((l) => /civilian acceptable@1=\d/.test(l)));
  });
});
