import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  EVAL_SLOT,
  MANIFEST_VERSION,
  PHOTO_MIN_BYTES_PER_PIXEL,
  PHOTO_MIN_DIMENSION,
  listHeldOutSlots,
  photoRejectReason,
  rebuildManifestFromDisk,
  resolveLimit,
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
