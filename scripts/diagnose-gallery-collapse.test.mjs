import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertReportsJsonPath,
  classifyPair,
  COLLAPSE_IDS,
  HOUSEHOLD_COLLAPSE_IDS,
  loadShippedGalleryRows,
  MEASURED_CAUSE,
  NEAR_CLONE_MAX,
  parseDiagnoseArgs,
  SMOKING_GUN_PAIRS,
  shippedCollapsePairs,
  sourceKind,
} from "./lib/gallery-collapse.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("diagnose-gallery-collapse harness", () => {
  it("parses --ids and keeps --json under reports/", () => {
    const args = parseDiagnoseArgs(["--ids", "alec-burden,ralph-fiennes", "--json", "reports/gallery-collapse-diagnosis.json"]);
    assert.deepEqual(args.ids, ["alec-burden", "ralph-fiennes"]);
    assert.match(assertReportsJsonPath(args.json, ROOT), /reports\/gallery-collapse-diagnosis\.json$/);
    assert.throws(() => assertReportsJsonPath("public/celebs/embeddings.v4.q8.bin", ROOT), /reports/);
  });

  it("classifies thumb vs pipeline vs recovery without inventing a cause", () => {
    assert.equal(classifyPair(0.001, 0.001), "pipeline-collapses-even-on-better-source");
    assert.equal(classifyPair(0.001, 0.45), "shipped-collapsed-live-recovers");
    assert.equal(classifyPair(0.4, 0.001), "live-collapses-shipped-ok");
    assert.equal(classifyPair(0.4, 0.5), "neither-collapsed");
    assert.equal(classifyPair(0.001, null), "live-encode-failed");
    assert.equal(sourceKind("/workspace/public/celebs/thumbs/96/adele.webp"), "thumb96");
    assert.equal(sourceKind("/workspace/public/celebs/adele.jpg"), "fullres");
  });
});

describe("shipped AdaFace collapse cluster", () => {
  const { header, rows } = loadShippedGalleryRows(ROOT);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const clusterPairs = shippedCollapsePairs(rows);

  it("loads the AFv4 binary at 512-d without rewriting it", () => {
    assert.equal(header.magic, "AFv4");
    assert.equal(header.dimension, 512);
    assert.ok(rows.length >= 1000);
  });

  it("still contains the 14 visually distinct near-clone ids", () => {
    for (const id of COLLAPSE_IDS) {
      assert.ok(byId.has(id), `missing shipped id ${id}`);
    }
    assert.equal(NEAR_CLONE_MAX, 0.005);
  });

  it("keeps the three smoking-gun pairs at d≤0.005 and not exact clones", () => {
    for (const [a, b] of SMOKING_GUN_PAIRS) {
      const hit = clusterPairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
      assert.ok(hit, `${a} ↔ ${b} dropped out of the d≤${NEAR_CLONE_MAX} cluster`);
      assert.ok(hit.distance > 0, `${a} ↔ ${b} became an exact clone`);
      assert.equal(hit.sameFingerprint, false, `${a} ↔ ${b} share a raw q8 fingerprint`);
    }
  });

  it("does not share one q8 fingerprint across the 14-id neighborhood", () => {
    const prints = COLLAPSE_IDS.map((id) => byId.get(id)?.q8Fingerprint);
    assert.equal(new Set(prints).size, COLLAPSE_IDS.length);
  });

  it("leaves household names proposed-only when a demotion file exists", () => {
    const demotionsPath = path.join(ROOT, "public/celebs/gallery-demotions.json");
    if (!fs.existsSync(demotionsPath)) {
      assert.ok(HOUSEHOLD_COLLAPSE_IDS.has("ralph-fiennes"));
      return;
    }
    const demotions = JSON.parse(fs.readFileSync(demotionsPath, "utf8"));
    const approved = new Set((demotions.approved ?? []).map((row) => row.id));
    for (const id of HOUSEHOLD_COLLAPSE_IDS) {
      assert.equal(approved.has(id), false, `${id} must not be an approved drop`);
    }
  });

  it("records a measured cause only after live diagnosis — not a guessed one", () => {
    assert.ok(MEASURED_CAUSE.kind);
    assert.notEqual(MEASURED_CAUSE.kind, "guessed");
    if (MEASURED_CAUSE.kind === "pending-live-measurement") {
      assert.match(MEASURED_CAUSE.note, /live AdaFace/);
    }
  });
});
