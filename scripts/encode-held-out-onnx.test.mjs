import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { filterEncodeCases, mergeEncodedCases, parseEncodeArgs, resolveProbePath } from "./encode-held-out-onnx.mjs";

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
    assert.deepEqual(parseEncodeArgs(["--ids", "kim-kardashian,meryl-streep"]).ids, [
      "kim-kardashian",
      "meryl-streep",
    ]);
    assert.equal(parseEncodeArgs(["--merge"]).merge, true);
    assert.throws(() => parseEncodeArgs(["--ids"]), /Missing --ids value/);
  });

  it("filters and merges packs by id / source without dropping the rest", () => {
    const cases = [
      { id: "adele", source: "/celebs/held-out/adele/001.jpg" },
      { id: "adele", source: "/celebs/held-out/adele/002.jpg" },
      { id: "meryl-streep", source: "/celebs/held-out/meryl-streep/001.jpg" },
    ];
    assert.deepEqual(
      filterEncodeCases(cases, { ids: ["meryl-streep"], limit: Infinity }).map((c) => c.id),
      ["meryl-streep"],
    );
    const merged = mergeEncodedCases(cases, [
      { id: "meryl-streep", source: "/celebs/held-out/meryl-streep/001.jpg", ok: true, descriptor: [1] },
    ]);
    assert.equal(merged.length, 3);
    assert.deepEqual(
      merged.find((c) => c.id === "meryl-streep"),
      { id: "meryl-streep", source: "/celebs/held-out/meryl-streep/001.jpg", ok: true, descriptor: [1] },
    );
  });
});
