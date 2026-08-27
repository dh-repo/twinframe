import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cosineDistance, l2Normalize } from "./lib/gallery-binary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTRAS = path.join(ROOT, "public/celebs/extra-templates.json");

describe("shipped extra templates", () => {
  const pack = JSON.parse(fs.readFileSync(EXTRAS, "utf8"));

  it("is AdaFace-512 and no longer an empty EdgeFace stub", () => {
    assert.match(String(pack.model), /AdaFace/i);
    assert.equal(pack.dim, 512);
    assert.ok(pack.templates.length >= 130, `expected extras, got ${pack.templates.length}`);
    for (const t of pack.templates) {
      assert.equal(t.descriptor.length, 512, t.id);
      assert.ok(t.source && !t.source.includes("held-out/001"), `eval probe enrolled as extra: ${t.source}`);
    }
  });

  it("covers weak Rank-1 household names with gated extra views", () => {
    const byId = new Map();
    for (const t of pack.templates) {
      byId.set(t.id, (byId.get(t.id) ?? 0) + 1);
    }
    assert.ok((byId.get("adele") ?? 0) >= 2, "Adele extras missing");
    assert.ok((byId.get("zendaya") ?? 0) >= 3, "Zendaya extras missing");
    assert.ok((byId.get("justin-bieber") ?? 0) >= 1, "Bieber extras missing");
    assert.ok((byId.get("lady-gaga") ?? 0) >= 1, "Gaga extras missing");
    assert.ok((byId.get("al-pacino") ?? 0) >= 2, "Pacino extras missing");
    assert.equal(byId.has("leon-rippy"), false, "thumb-only namesake must not gain extras");
  });

  it("does not enroll a byte-duplicate of any held-out 001 eval probe", () => {
    const leaks = [];
    for (const t of pack.templates) {
      const extra = path.join(ROOT, "public/celebs", t.source);
      const probe = path.join(ROOT, "public/celebs/held-out", t.id, "001.jpg");
      if (!fs.existsSync(extra) || !fs.existsSync(probe)) continue;
      const a = fs.readFileSync(extra);
      const b = fs.readFileSync(probe);
      if (a.equals(b)) leaks.push(`${t.id}:${t.source}`);
    }
    assert.deepEqual(leaks, [], `eval probe leaked into extras: ${leaks.join(", ")}`);
  });

  it("does not enroll a near-clone of held-out 001", () => {
    const probes = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public/celebs/held-out/descriptors.json"), "utf8"),
    );
    const byId = new Map();
    for (const c of probes.cases ?? []) {
      if (!c.descriptor?.length || c.ok === false) continue;
      const src = String(c.source ?? "");
      if (!src.includes("/001.")) continue;
      byId.set(c.id, l2Normalize(c.descriptor));
    }
    const close = [];
    for (const t of pack.templates) {
      const probe = byId.get(t.id);
      if (!probe) continue;
      const d = cosineDistance(l2Normalize(t.descriptor), probe);
      if (d < 0.05) close.push(`${t.id}:${t.source} d=${d.toFixed(4)}`);
    }
    assert.deepEqual(close, [], `eval near-clone extra: ${close.join("; ")}`);
  });
});
