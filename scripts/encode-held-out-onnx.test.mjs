import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseEncodeArgs, resolveProbePath } from "./encode-held-out-onnx.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("encode-held-out-onnx harness", () => {
  it("resolves a /celebs source under public/ and does not invent a path", () => {
    const resolved = resolveProbePath("/celebs/held-out/adele/001.jpg", ROOT);
    assert.equal(resolved, path.join(ROOT, "public/celebs/held-out/adele/001.jpg"));
    assert.equal(parseEncodeArgs([]).limit, Infinity);
    assert.equal(parseEncodeArgs(["--limit", "8"]).limit, 8);
    assert.equal(parseEncodeArgs(["--dry-run"]).write, false);
    assert.equal(parseEncodeArgs(["--skip-missing", "--out", "reports/held-out-adaface.json"]).out, "reports/held-out-adaface.json");
    assert.equal(parseEncodeArgs(["--skip-missing"]).skipMissing, true);
  });
});
