import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { checkGoldLabels, parseGoldLabels } from "./encode-gold-batch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/encode-gold-batch.mjs");
const EXAMPLE = path.join(ROOT, "fixtures/gold/labels.example.json");

describe("parseGoldLabels / checkGoldLabels", () => {
  it("rejects accept+refuse and unknown gallery ids", () => {
    assert.throws(
      () =>
        parseGoldLabels({
          cases: [{ id: "x", image: "a.jpg", refuse: true, accept: ["adele"] }],
        }),
      /either refuse/,
    );
    const cases = parseGoldLabels({
      cases: [{ id: "x", image: "fixtures/gold/missing.jpg", accept: ["not-a-celeb"] }],
    });
    const errors = checkGoldLabels(cases, {
      galleryIds: new Set(["adele"]),
      requireImages: true,
    });
    assert.ok(errors.some((e) => /missing image/.test(e)));
    assert.ok(errors.some((e) => /not in gallery/.test(e)));
  });
});

describe("encode-gold-batch CLI", () => {
  it("exits with usage when labels are missing", () => {
    const res = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Usage:/);
  });

  it("check-ids accepts the example file's real gallery slugs", () => {
    const res = spawnSync(
      process.execPath,
      ["--experimental-strip-types", SCRIPT, "--labels", EXAMPLE, "--check-ids"],
      { encoding: "utf8", cwd: ROOT },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /labels ok: 3 cases/);
  });
});
