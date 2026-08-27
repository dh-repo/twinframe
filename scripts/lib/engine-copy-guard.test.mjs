import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BANNED_ENGINE_COPY,
  bannedEngineLines,
  engineCopyFailures,
} from "./engine-copy-guard.mjs";

describe("engine-copy-guard", () => {
  it("flags EdgeFace / Anti-GAN / Biohash product copy", () => {
    const text = "Instant matching with EdgeFace 512-d & SCRFD-2.5G";
    assert.match(text, BANNED_ENGINE_COPY);
    assert.deepEqual(bannedEngineLines(text), [text]);
    assert.equal(engineCopyFailures("landing", text).length, 1);
  });

  it("requires AdaFace on landing and accepts honest copy", () => {
    const honest = "Instant, on-device matching with AdaFace IR-101 & SCRFD-2.5G against";
    assert.deepEqual(engineCopyFailures("landing", honest, { requireAdaFace: true }), []);
    assert.equal(
      engineCopyFailures("landing", "Upload a selfie.", { requireAdaFace: true }).length,
      1,
    );
  });

  it("does not flag the held-out encode tooling when not asked to", () => {
    const honest = "AdaFace IR-101 · SCRFD-2.5G · On-device engine v4.0.0-accuface";
    assert.equal(engineCopyFailures("results", honest).length, 0);
  });
});
