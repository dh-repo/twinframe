import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/studio-rebuild-gallery.sh");

describe("studio-rebuild-gallery.sh", () => {
  it("dry plan exits 0 and does not write the catalog", () => {
    const res = spawnSync("sh", [SCRIPT], { encoding: "utf8", cwd: ROOT });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Dry plan/);
    assert.match(res.stdout, /enroll-gallery-onnx/);
    assert.match(res.stdout, /write-gallery-v4/);
    assert.doesNotMatch(res.stdout, /Wrote .*gallery\.buckets\.json/);
  });
});
