import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTRAS = path.join(ROOT, "public/celebs/extra-templates.json");

describe("shipped extra templates", () => {
  const pack = JSON.parse(fs.readFileSync(EXTRAS, "utf8"));

  it("is AdaFace-512 and no longer an empty EdgeFace stub", () => {
    assert.match(String(pack.model), /AdaFace/i);
    assert.equal(pack.dim, 512);
    assert.ok(pack.templates.length >= 80, `expected extras, got ${pack.templates.length}`);
    for (const t of pack.templates) {
      assert.equal(t.descriptor.length, 512, t.id);
      assert.ok(t.source && !t.source.includes("held-out/001"), `eval probe enrolled as extra: ${t.source}`);
    }
  });
});
