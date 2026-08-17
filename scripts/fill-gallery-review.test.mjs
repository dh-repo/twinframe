import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { fillReviewFile } from "./fill-gallery-review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/fill-gallery-review.mjs");

describe("fillReviewFile", () => {
  it("keeps drop/keep and adds only missing ids as reenroll", () => {
    const result = fillReviewFile(
      {
        version: "1.0.0",
        decisions: { "gwenyth-paltrow": "drop", "gwyneth-paltrow": "keep" },
      },
      ["gwenyth-paltrow", "gwyneth-paltrow", "mohanlal", "wang-yibo"],
    );
    assert.deepEqual(result.added, ["mohanlal", "wang-yibo"]);
    assert.equal(result.decisions.mohanlal, "reenroll");
    assert.equal(result.decisions["gwenyth-paltrow"], "drop");
    assert.deepEqual(result.unset, []);
    assert.deepEqual(result.drops, ["gwenyth-paltrow"]);
  });
});

describe("fill-gallery-review CLI", () => {
  it("dry-run does not require --write and reports added reenroll", () => {
    const res = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Dry run/);
    assert.match(res.stdout, /added reenroll/);
  });
});
