import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_PACK,
  PACKS,
  applyPackManifest,
  celebInPack,
  clearRegisteredPackIds,
  isPackId,
  packDefinition,
  registerPackIds,
  registeredPackIds,
} from "./packs.ts";
import { loadCuratedPacks, resetPacksLoadForTests } from "./load-packs.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKS_JSON = JSON.parse(readFileSync(join(ROOT, "public/celebs/packs.json"), "utf8")) as unknown;
const INDEX = JSON.parse(readFileSync(join(ROOT, "public/celebs/index.json"), "utf8")) as Array<{
  id: string;
}>;
const GALLERY_IDS = new Set(INDEX.map((c) => c.id));

afterEach(() => {
  clearRegisteredPackIds();
  resetPacksLoadForTests();
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

describe("applyPackManifest", () => {
  it("registers curated 90s and musician ids from packs.json", () => {
    applyPackManifest(PACKS_JSON);

    const nineties = registeredPackIds("nineties-icons");
    assert.ok(nineties.size >= 40, `expected 40+ 90s icons, got ${nineties.size}`);
    assert.ok(nineties.size <= 80, `expected at most 80 90s icons, got ${nineties.size}`);
    assert.equal(celebInPack("brad-pitt", "Actor", "nineties-icons"), true);
    assert.equal(celebInPack("jennifer-aniston", "Actor", "nineties-icons"), true);
    assert.equal(celebInPack("uma-thurman", "Actor", "nineties-icons"), true);
    assert.equal(celebInPack("britney-spears", "Artist", "nineties-icons"), true);
    assert.equal(celebInPack("timothee-chalamet", "Actor", "nineties-icons"), false);

    assert.equal(celebInPack("lady-gaga", "Actor", "musicians"), true);
    assert.equal(celebInPack("will-smith", "Actor", "musicians"), true);
    assert.equal(celebInPack("zendaya", "Actor", "musicians"), true);
    assert.equal(celebInPack("rihanna", "Artist", "musicians"), true);
  });

  it("only lists ids that exist in the 1000-celeb gallery", () => {
    applyPackManifest(PACKS_JSON);
    for (const pack of PACKS) {
      for (const id of registeredPackIds(pack.id)) {
        assert.ok(GALLERY_IDS.has(id), `${id} is not in the gallery (pack ${pack.id})`);
      }
    }
  });

  it("ignores unknown keys and the implicit everyone pack", () => {
    applyPackManifest({
      all: ["brad-pitt"],
      "not-a-pack": ["brad-pitt"],
      "nineties-icons": ["brad-pitt"],
    });
    assert.equal(registeredPackIds("all").size, 0);
    assert.equal(celebInPack("brad-pitt", "Actor", "nineties-icons"), true);
  });
});

describe("loadCuratedPacks", () => {
  it("fetches packs.json and registers membership", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(PACKS_JSON), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    await loadCuratedPacks(fetchImpl);
    assert.equal(celebInPack("brad-pitt", "Actor", "nineties-icons"), true);
    assert.equal(celebInPack("lady-gaga", "Actor", "musicians"), true);
  });

  it("stays knownFor-only when the fetch fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    await loadCuratedPacks(fetchImpl);
    assert.equal(celebInPack("brad-pitt", "Actor", "nineties-icons"), false);
    assert.equal(celebInPack("rihanna", "Artist", "musicians"), true);
  });
});
