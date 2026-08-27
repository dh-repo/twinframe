import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  EVAL_SLOT,
  MANIFEST_VERSION,
  PHOTO_MIN_BYTES_PER_PIXEL,
  PHOTO_MIN_DIMENSION,
  HELD_OUT_MAX_SAME_PERSON_DISTANCE,
  heldOutFileNameRejectReason,
  heldOutIdentityRejectReason,
  heldOutSamePersonRejectReason,
  heldOutSceneRejectReason,
  heldOutSecondPersonRejectReason,
  blockedEvalHashes,
  listHeldOutSlots,
  parseFetchMode,
  photoRejectReason,
  rebuildManifestFromDisk,
  resolveFetchIds,
  resolveLimit,
  wikiSearchName,
} from "./fetch-held-out-photos.ts";

function tempHeldOut() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "twinframe-held-out-"));
  const write = (id, file, bytes) => {
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, file), "x".repeat(bytes));
  };
  write("adele", "001.jpg", 10);
  write("adele", "002.jpg", 20);
  write("adele", "003.png", 30);
  write("brad-pitt", "001.jpg", 40);
  write("zendaya", "002.jpg", 50);
  fs.writeFileSync(path.join(root, "adele", "README.md"), "not an image");
  fs.writeFileSync(path.join(root, "manifest.json"), "{}");
  return root;
}

const INDEX = [
  { id: "adele", name: "Adele" },
  { id: "brad-pitt", name: "Brad Pitt" },
  { id: "zendaya", name: "Zendaya" },
];

describe("resolveLimit", () => {
  it("defaults to the whole catalog", () => {
    assert.equal(resolveLimit(1000, {}, []), 1000);
  });

  it("honours the HELD_OUT_LIMIT env override", () => {
    assert.equal(resolveLimit(1000, { HELD_OUT_LIMIT: "204" }, []), 204);
  });

  it("honours --limit and prefers it over the env var", () => {
    assert.equal(resolveLimit(1000, { HELD_OUT_LIMIT: "204" }, ["--limit", "12"]), 12);
  });

  it("never exceeds the catalog size", () => {
    assert.equal(resolveLimit(50, { HELD_OUT_LIMIT: "5000" }, []), 50);
  });

  it("rejects nonsense limits instead of silently fetching everything", () => {
    assert.throws(() => resolveLimit(1000, { HELD_OUT_LIMIT: "zero" }, []), /Invalid held-out limit/);
    assert.throws(() => resolveLimit(1000, {}, ["--limit", "0"]), /Invalid held-out limit/);
  });
});

describe("wikiSearchName", () => {
  it("restores apostrophes Wikipedia search needs", () => {
    assert.equal(wikiSearchName({ id: "emma-darcy", name: "Emma DArcy" }), "Emma D'Arcy");
    assert.equal(wikiSearchName({ id: "adele", name: "Adele" }), "Adele");
  });
});

describe("resolveFetchIds", () => {
  const catalog = [{ id: "adele" }, { id: "brad-pitt" }, { id: "zendaya" }];

  it("returns null when --ids is absent so the catalog slice still applies", () => {
    assert.equal(resolveFetchIds(catalog, []), null);
    assert.equal(resolveFetchIds(catalog, ["--limit", "12"]), null);
  });

  it("keeps the requested catalog order and rejects unknown ids", () => {
    assert.deepEqual(resolveFetchIds(catalog, ["--ids", "zendaya,adele"]), ["zendaya", "adele"]);
    assert.throws(() => resolveFetchIds(catalog, ["--ids", "adele,not-a-celeb"]), /Unknown catalog ids/);
    assert.throws(() => resolveFetchIds(catalog, ["--ids"]), /Missing --ids value/);
    assert.throws(() => resolveFetchIds(catalog, ["--ids", "--limit"]), /Missing --ids value/);
  });
});

describe("photoRejectReason", () => {
  it("accepts a normal Commons portrait", () => {
    assert.equal(photoRejectReason({ bytes: 132_300, width: 960, height: 838 }), null);
  });

  it("rejects the 128px microphone icon that shipped as a celebrity probe", () => {
    assert.equal(photoRejectReason({ bytes: 7_162, width: 128, height: 128 }), "too-small");
  });

  it("rejects flat art delivered at a believable size", () => {
    // A logo rasterized to 900x900 compresses an order of magnitude below a photo.
    assert.equal(photoRejectReason({ bytes: 7_000, width: 900, height: 900 }), "flat-art");
    assert.ok(7_000 / (900 * 900) < PHOTO_MIN_BYTES_PER_PIXEL);
  });

  it("treats the dimension floor as inclusive", () => {
    const side = PHOTO_MIN_DIMENSION;
    assert.equal(photoRejectReason({ bytes: side * side, width: side, height: side }), null);
    assert.equal(
      photoRejectReason({ bytes: side * side, width: side - 1, height: side }),
      "too-small",
    );
  });

  it("passes rather than guesses when the size is unknown", () => {
    assert.equal(photoRejectReason({ bytes: 7_162 }), null);
    assert.equal(photoRejectReason({ bytes: 7_162, width: 0, height: 0 }), null);
  });
});

describe("heldOutFileNameRejectReason", () => {
  it("keeps a solo portrait filename", () => {
    assert.equal(heldOutFileNameRejectReason("File:Adam Sandler 2018.jpg"), null);
    assert.equal(heldOutFileNameRejectReason("File:Al_Pacino_Cannes_2019.jpg"), null);
  });

  it("rejects the pair shots that landed as missing-001 restores", () => {
    assert.equal(
      heldOutFileNameRejectReason("File:Abhishek and Aishwarya in Bengal.jpg"),
      "pair",
    );
    assert.equal(heldOutFileNameRejectReason("File:AdamSandlerwithdaughtersFeb11.jpg"), "pair");
    assert.equal(heldOutFileNameRejectReason("File:Aish N Madhuri.jpg"), "pair");
    assert.equal(heldOutFileNameRejectReason("File:ColinFirth LiviaGiuggioli Jan2011.jpg"), "pair");
  });

  it("keeps a solo two-word name that is not a pair token", () => {
    assert.equal(heldOutFileNameRejectReason("File:Adam Sandler.jpg"), null);
    assert.equal(heldOutFileNameRejectReason("File:Christian Bale-7837.jpg"), null);
  });

  it("rejects a vinyl scan that is not a face", () => {
    assert.equal(heldOutFileNameRejectReason("File:45 record.png"), "non-photo");
  });

  it("rejects a Broadway entrance that is not a face", () => {
    assert.equal(
      heldOutFileNameRejectReason("File:Martin Scorsese Walk of Fame.jpg"),
      "non-photo",
    );
  });

  it("rejects murals and crowd files that are not a face probe", () => {
    assert.equal(
      heldOutFileNameRejectReason("File:112 Mural al passeig de Circumval·lació (Barcelona), Al Pacino.jpg"),
      "non-photo",
    );
    assert.equal(heldOutFileNameRejectReason("File:Cast of Toy Story 2019.jpg"), "non-photo");
  });
});

describe("heldOutIdentityRejectReason", () => {
  it("keeps a filename that mentions the celebrity", () => {
    assert.equal(heldOutIdentityRejectReason("File:Adam Sandler.jpg", "Adam Sandler"), null);
    assert.equal(heldOutIdentityRejectReason("File:HoYeon Jung.jpg", "Jung Ho-yeon"), null);
  });

  it("rejects a named photo of a different person", () => {
    assert.equal(
      heldOutIdentityRejectReason("File:Elizabeth Hurley08.jpg", "Hugh Grant"),
      "wrong-person",
    );
  });

  it("does not enroll Lee Jung-jae under Lee Jung Mi", () => {
    assert.equal(
      heldOutIdentityRejectReason("File:240305 Lee Jung-jae (cropped).jpg", "Lee Jung-mi"),
      "wrong-person",
    );
    assert.equal(heldOutIdentityRejectReason("Lee Jung-jae", "Lee Jung-mi"), "wrong-person");
    assert.equal(heldOutIdentityRejectReason("File:Lee Jung-mi 2019.jpg", "Lee Jung-mi"), null);
  });

  it("does not guess on opaque camera-dump filenames", () => {
    assert.equal(
      heldOutIdentityRejectReason("File:170217-D-GO396-0147 (32577063650).jpg", "Bill Gates"),
      null,
    );
  });
});

describe("heldOutSecondPersonRejectReason", () => {
  it("rejects a second named person with a year", () => {
    assert.equal(
      heldOutSecondPersonRejectReason("File:Gong Li Andie MacDowell 1998 (cropped).jpg", "Gong Li"),
      "pair",
    );
    assert.equal(
      heldOutSecondPersonRejectReason("File:Dakota Johnson (2014).jpg", "Dakota Johnson"),
      null,
    );
  });
});

describe("listHeldOutSlots", () => {
  it("finds every image slot, not just 001", () => {
    const root = tempHeldOut();
    assert.deepEqual(
      listHeldOutSlots(root).map((s) => `${s.id}/${s.slot}`),
      ["adele/001", "adele/002", "adele/003", "brad-pitt/001", "zendaya/002"],
    );
  });

  it("returns an empty list when the tree does not exist", () => {
    assert.deepEqual(listHeldOutSlots(path.join(os.tmpdir(), "twinframe-absent-tree")), []);
  });
});

describe("rebuildManifestFromDisk", () => {
  it("counts every image on disk, not only rows a fetch wrote", () => {
    const root = tempHeldOut();
    const manifest = rebuildManifestFromDisk({
      heldOutDir: root,
      index: INDEX,
      previous: { cases: [{ id: "adele", imagePath: "/celebs/held-out/adele/001.jpg" }] },
    });
    assert.equal(manifest.count, 5);
    assert.equal(manifest.identities, 3);
    assert.equal(manifest.version, MANIFEST_VERSION);
  });

  it("marks only slot 001 as the eval slot", () => {
    const root = tempHeldOut();
    const manifest = rebuildManifestFromDisk({ heldOutDir: root, index: INDEX });
    const evalRows = manifest.cases.filter((c) => c.evalSlot);
    assert.equal(manifest.evalSlotCount, 2);
    assert.deepEqual(
      evalRows.map((r) => r.id),
      ["adele", "brad-pitt"],
    );
    assert.equal(EVAL_SLOT, "001");
  });

  it("keeps the id / name / imagePath shape the browser encoder consumes", () => {
    const root = tempHeldOut();
    const manifest = rebuildManifestFromDisk({ heldOutDir: root, index: INDEX });
    const row = manifest.cases[0];
    assert.equal(row.id, "adele");
    assert.equal(row.name, "Adele");
    assert.equal(row.imagePath, "/celebs/held-out/adele/001.jpg");
    assert.equal(row.bytes, 10);
  });

  it("carries provenance over from the previous manifest and drops stale rows", () => {
    const root = tempHeldOut();
    const manifest = rebuildManifestFromDisk({
      heldOutDir: root,
      index: INDEX,
      previous: {
        cases: [
          {
            id: "adele",
            imagePath: "/celebs/held-out/adele/001.jpg",
            sourceUrl: "https://example.org/a.jpg",
            wikiTitle: "Adele",
          },
          {
            id: "deleted-celeb",
            imagePath: "/celebs/held-out/deleted-celeb/001.jpg",
            sourceUrl: "https://example.org/gone.jpg",
          },
        ],
      },
    });
    const adele = manifest.cases.find((c) => c.imagePath === "/celebs/held-out/adele/001.jpg");
    assert.equal(adele.sourceUrl, "https://example.org/a.jpg");
    assert.equal(adele.wikiTitle, "Adele");
    assert.ok(!manifest.cases.some((c) => c.id === "deleted-celeb"));
    assert.equal(manifest.cases.find((c) => c.slot === "002").sourceUrl, undefined);
  });

  it("falls back to the id when the catalog has no name for a directory", () => {
    const root = tempHeldOut();
    const manifest = rebuildManifestFromDisk({ heldOutDir: root, index: [] });
    assert.equal(manifest.cases[0].name, "adele");
  });
});

describe("parseFetchMode", () => {
  it("defaults to a fill-missing held-out fetch", () => {
    assert.deepEqual(parseFetchMode([]), {
      replace: false,
      primaries: false,
      audit: false,
      manifestOnly: false,
    });
  });

  it("recognises replace, primaries, and maintenance flags", () => {
    assert.equal(parseFetchMode(["--replace", "--primaries"]).replace, true);
    assert.equal(parseFetchMode(["--replace", "--primaries"]).primaries, true);
    assert.equal(parseFetchMode(["--audit"]).audit, true);
    assert.equal(parseFetchMode(["--manifest-only"]).manifestOnly, true);
  });
});

describe("heldOutSceneRejectReason", () => {
  it("rejects a plaque or empty frame with no face", () => {
    assert.equal(heldOutSceneRejectReason({ faceCount: 0, primaryArea: 0, secondArea: 0 }), "no-face");
  });

  it("rejects a pair whose second face is a real rival crop", () => {
    assert.equal(
      heldOutSceneRejectReason({ faceCount: 2, primaryArea: 1000, secondArea: 400 }),
      "multi-face",
    );
  });

  it("keeps a tiny background extra behind a dominant subject", () => {
    assert.equal(
      heldOutSceneRejectReason({ faceCount: 2, primaryArea: 1000, secondArea: 100 }),
      null,
    );
  });

  it("rejects crowds and three-person groups with a real second crop", () => {
    assert.equal(heldOutSceneRejectReason({ faceCount: 8, primaryArea: 900, secondArea: 800 }), "crowd");
    assert.equal(heldOutSceneRejectReason({ faceCount: 3, primaryArea: 900, secondArea: 200 }), "group");
  });

  it("keeps a stadium/red-carpet primary with tiny background heads", () => {
    assert.equal(
      heldOutSceneRejectReason({ faceCount: 3, primaryArea: 1000, secondArea: 80 }),
      null,
    );
  });
});

describe("blockedEvalHashes", () => {
  it("blocks enrolled extras so 001 cannot reuse a 002 view", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "twinframe-blocked-"));
    fs.mkdirSync(path.join(root, "held-out", "adele"), { recursive: true });
    fs.writeFileSync(path.join(root, "adele.jpg"), "primary");
    fs.writeFileSync(path.join(root, "held-out", "adele", "002.jpg"), "extra-view");
    fs.writeFileSync(path.join(root, "held-out", "adele", "001.jpg"), "eval-slot");
    const blocked = blockedEvalHashes({ id: "adele", name: "Adele" }, root);
    const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
    assert.equal(blocked.has(sha("primary")), true);
    assert.equal(blocked.has(sha("extra-view")), true);
    assert.equal(blocked.has(sha("eval-slot")), false);
  });
});

describe("heldOutSamePersonRejectReason", () => {
  it("keeps genuine AdaFace pairs and rejects impostor-range candidates", () => {
    assert.equal(heldOutSamePersonRejectReason(0.36), null);
    assert.equal(heldOutSamePersonRejectReason(0.8), null);
    assert.equal(heldOutSamePersonRejectReason(0.801), "different-person");
    assert.equal(HELD_OUT_MAX_SAME_PERSON_DISTANCE, 0.8);
    assert.equal(heldOutSamePersonRejectReason(Number.NaN), null);
  });
});
