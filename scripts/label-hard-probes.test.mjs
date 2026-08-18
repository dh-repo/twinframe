import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  AUTO_DERIVED_CONDITIONS,
  MANUAL_ONLY_CONDITIONS,
  fingerprintFor,
  listProbeImages,
  lowConfidenceFor,
  mergeSignals,
  parseProbeKey,
  probeKeyFor,
  summarizeConditionCounts,
} from "./label-hard-probes.mjs";

function tempTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "twinframe-hard-probes-"));
  const heldOut = path.join(root, "held-out");
  fs.mkdirSync(path.join(heldOut, "adele"), { recursive: true });
  fs.mkdirSync(path.join(heldOut, "brad-pitt"), { recursive: true });
  fs.writeFileSync(path.join(heldOut, "adele", "001.jpg"), "a");
  fs.writeFileSync(path.join(heldOut, "adele", "003.jpg"), "aaa");
  fs.writeFileSync(path.join(heldOut, "adele", "notes.txt"), "skip me");
  fs.writeFileSync(path.join(heldOut, "brad-pitt", "002.jpeg"), "bb");
  fs.writeFileSync(path.join(heldOut, "manifest.json"), "{}");
  return { root, heldOut };
}

describe("held-out image discovery", () => {
  it("lists every image slot on disk, sorted, ignoring non-images", () => {
    const { heldOut } = tempTree();
    const images = listProbeImages(heldOut);
    assert.deepEqual(
      images.map((i) => `${i.id}/${i.slot}`),
      ["adele/001", "adele/003", "brad-pitt/002"],
    );
  });

  it("returns nothing for a missing directory instead of throwing", () => {
    assert.deepEqual(listProbeImages(path.join(os.tmpdir(), "twinframe-does-not-exist")), []);
  });

  it("builds public URL keys and parses them back", () => {
    const { root, heldOut } = tempTree();
    const key = probeKeyFor(path.join(heldOut, "adele", "001.jpg"), root);
    assert.equal(key, "/celebs/held-out/adele/001.jpg");
    assert.deepEqual(parseProbeKey(key), { id: "adele", slot: "001" });
    assert.equal(parseProbeKey("/celebs/adele.jpg"), null);
  });
});

describe("cache fingerprints", () => {
  it("changes when bytes change and when the signal version changes", () => {
    const a = fingerprintFor({ size: 10, mtimeMs: 1000.4 }, "1.0.0");
    assert.equal(a, fingerprintFor({ size: 10, mtimeMs: 1000.4 }, "1.0.0"));
    assert.notEqual(a, fingerprintFor({ size: 11, mtimeMs: 1000.4 }, "1.0.0"));
    assert.notEqual(a, fingerprintFor({ size: 10, mtimeMs: 2000 }, "1.0.0"));
    assert.notEqual(a, fingerprintFor({ size: 10, mtimeMs: 1000.4 }, "1.1.0"));
  });
});

describe("manual overrides", () => {
  it("adds glasses without inventing it when absent", () => {
    const derived = { meanLuma: 0.5, yawDeg: 3 };
    const none = mergeSignals(derived, undefined);
    assert.equal(none.signals.glasses, undefined);
    assert.deepEqual(none.manualSignals, []);

    const labeled = mergeSignals(derived, { glasses: true });
    assert.equal(labeled.signals.glasses, true);
    assert.deepEqual(labeled.manualSignals, ["glasses"]);
  });

  it("lets a hand label win over a derived signal and records which keys are manual", () => {
    const merged = mergeSignals({ smileIntensity: 1, yawDeg: 3 }, { smileIntensity: 0.2, glasses: false });
    assert.equal(merged.signals.smileIntensity, 0.2);
    assert.deepEqual(merged.manualSignals, ["glasses", "smileIntensity"]);
  });

  it("ignores null override values rather than clobbering a real signal", () => {
    const merged = mergeSignals({ yawDeg: 30 }, { yawDeg: null });
    assert.equal(merged.signals.yawDeg, 30);
    assert.deepEqual(merged.manualSignals, []);
  });

  it("keeps glasses manual-only and out of the auto-derived list", () => {
    assert.ok(MANUAL_ONLY_CONDITIONS.includes("glasses"));
    assert.ok(!AUTO_DERIVED_CONDITIONS.includes("glasses"));
  });
});

describe("condition summary", () => {
  it("counts each condition, detections, and probes with no condition", () => {
    const counts = summarizeConditionCounts({
      "/celebs/held-out/a/001.jpg": { detected: true, conditions: ["yaw-gt-25"] },
      "/celebs/held-out/b/001.jpg": { detected: true, conditions: ["yaw-gt-25", "low-light"] },
      "/celebs/held-out/c/001.jpg": { detected: true, conditions: [] },
      "/celebs/held-out/d/001.jpg": { detected: false, conditions: [] },
    });
    assert.equal(counts.images, 4);
    assert.equal(counts.detected, 3);
    assert.equal(counts.easyImages, 2);
    assert.equal(counts.byCondition["yaw-gt-25"], 2);
    assert.equal(counts.byCondition["low-light"], 1);
    assert.equal(counts.byCondition.glasses, 0);
    assert.equal(counts.byCondition["phone-closeup"], 0);
  });

  it("flags the saturating smile proxy but not the geometric conditions", () => {
    assert.deepEqual(lowConfidenceFor(["big-smile", "yaw-gt-25"]), ["big-smile"]);
    assert.deepEqual(lowConfidenceFor(["low-light", "phone-closeup"]), []);
  });
});
