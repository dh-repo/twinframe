import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/encode-gold-probe.mjs");

describe("encode-gold-probe harness", () => {
  it("exits with usage when image/id/labels are missing", () => {
    const res = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
      encoding: "utf8",
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Usage:/);
  });

  it("refuses a missing image path without inventing a descriptor", () => {
    const res = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        SCRIPT,
        "--image",
        path.join(ROOT, "fixtures/gold/does-not-exist.jpg"),
        "--id",
        "civilian-missing",
        "--refuse",
      ],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Missing image/);
  });

  it("refuses a missing --dir without inventing descriptors", () => {
    const res = spawnSync(
      process.execPath,
      ["--experimental-strip-types", SCRIPT, "--dir", path.join(ROOT, "fixtures/gold/no-such-dir"), "--refuse"],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Missing gold dir/);
  });

  it("refuses batch --dir without --refuse so it cannot invent accept lists", () => {
    const res = spawnSync(
      process.execPath,
      ["--experimental-strip-types", SCRIPT, "--dir", path.join(ROOT, "fixtures/gold")],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 1);
    assert.match(res.stderr, /refuse-only/);
  });
});
