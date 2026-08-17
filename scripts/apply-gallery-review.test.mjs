import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { applyReviewToCatalog } from "./apply-gallery-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/apply-gallery-review.mjs");

describe("applyReviewToCatalog", () => {
  it("drops only decided ids and reports the rest as unset", () => {
    const result = applyReviewToCatalog({
      review: {
        version: "1.0.0",
        decisions: { "gwenyth-paltrow": "drop", "gwyneth-paltrow": "keep" },
      },
      suspectIds: ["gwenyth-paltrow", "gwyneth-paltrow", "mohanlal"],
      buckets: [
        { id: "gwyneth-paltrow" },
        { id: "gwenyth-paltrow" },
        { id: "mohanlal" },
      ],
      index: [
        { id: "gwyneth-paltrow" },
        { id: "gwenyth-paltrow" },
        { id: "mohanlal" },
      ],
    });
    assert.deepEqual(result.drops, ["gwenyth-paltrow"]);
    assert.deepEqual(result.unset, ["mohanlal"]);
    assert.deepEqual(
      result.buckets.map((b) => b.id),
      ["gwyneth-paltrow", "mohanlal"],
    );
    assert.deepEqual(
      result.index.map((b) => b.id),
      ["gwyneth-paltrow", "mohanlal"],
    );
  });
});

describe("apply-gallery-review CLI", () => {
  it("dry-run does not write catalog files", () => {
    const res = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Dry run/);
    assert.match(res.stdout, /gwenyth-paltrow/);
    assert.match(res.stdout, /Will not write embeddings\.v4\.q8\.bin/);
    assert.match(res.stdout, /unset:\s+0/);
  });

  it("refuses to treat the binary as an output", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-review-"));
    const bin = path.join(dir, "embeddings.v4.q8.bin");
    fs.writeFileSync(bin, "keep-me");
    const before = fs.readFileSync(bin);
    const res = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.readFileSync(bin).equals(before), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
