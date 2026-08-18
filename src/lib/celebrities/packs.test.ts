import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_PACK,
  PACKS,
  celebInPack,
  clearRegisteredPackIds,
  isPackId,
  packDefinition,
  registerPackIds,
  registeredPackIds,
} from "./packs.ts";

afterEach(() => {
  clearRegisteredPackIds();
});

describe("celebInPack", () => {
  it("keeps everyone in the default pack", () => {
    assert.equal(DEFAULT_PACK, "all");
    assert.equal(celebInPack("brad-pitt", "Actor", "all"), true);
    assert.equal(celebInPack("serena-williams", "Athlete", "all"), true);
  });

  it("matches occupation packs on knownFor", () => {
    assert.equal(celebInPack("serena-williams", "Athlete", "athletes"), true);
    assert.equal(celebInPack("brad-pitt", "Actor", "athletes"), false);
    assert.equal(celebInPack("rihanna", "Artist", "musicians"), true);
    assert.equal(celebInPack("bella-hadid", "Model", "models"), true);
    assert.equal(celebInPack("barack-obama", "Public figure", "public-figures"), true);
  });

  it("keeps era packs empty until curated ids are registered", () => {
    assert.equal(celebInPack("brad-pitt", "Actor", "nineties-icons"), false);
    registerPackIds("nineties-icons", ["brad-pitt", "winona-ryder"]);
    assert.equal(celebInPack("brad-pitt", "Actor", "nineties-icons"), true);
    assert.equal(celebInPack("timothee-chalamet", "Actor", "nineties-icons"), false);
  });

  it("lets curated ids extend an occupation pack", () => {
    assert.equal(celebInPack("lady-gaga", "Actor", "musicians"), false);
    registerPackIds("musicians", ["lady-gaga"]);
    assert.equal(celebInPack("lady-gaga", "Actor", "musicians"), true);
  });

  it("falls back to including everyone for an unknown pack", () => {
    assert.equal(celebInPack("brad-pitt", "Actor", "not-a-pack" as never), true);
  });
});

describe("pack metadata", () => {
  it("exposes a definition and label for every pack", () => {
    for (const pack of PACKS) {
      assert.equal(packDefinition(pack.id)?.id, pack.id);
      assert.ok(pack.label.length > 0);
      assert.ok(pack.blurb.length > 0);
      assert.ok(isPackId(pack.id));
    }
    assert.equal(isPackId("nineties"), false);
  });

  it("reports registered ids and clears them", () => {
    registerPackIds("athletes", ["a", "b"]);
    assert.equal(registeredPackIds("athletes").size, 2);
    clearRegisteredPackIds();
    assert.equal(registeredPackIds("athletes").size, 0);
  });
});
