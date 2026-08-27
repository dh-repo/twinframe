import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { ENGINE_VERSION } from "../face/types.ts";
import {
  BANNED_USER_FACING_ENGINE,
  HUD_IDLE_TELEMETRY,
  SHARE_ENGINE_STAMP,
  analyzingSteps,
  captureEngineBlurb,
  engineFooter,
  galleryLoadingCopy,
  hudEmbeddingLine,
  hudRankingLine,
  userFacingEngineCopy,
} from "./engine-copy.ts";

const USER_FACING_SOURCES = [
  "src/components/app-home.tsx",
  "src/components/analyzing-state.tsx",
  "src/components/scanning/face-scanning-hud.tsx",
  "src/components/results/match-results.tsx",
  "src/components/results/friend-share-modal.tsx",
  "src/components/results/share-card-modal.tsx",
  "src/components/gallery/star-gallery-modal.tsx",
  "src/lib/ux/share-image.ts",
  "src/lib/ux/pair-share-image.ts",
];

describe("engine-copy", () => {
  it("names AdaFace IR-101 on every user-facing engine string", () => {
    const bundle = userFacingEngineCopy();
    assert.match(bundle, /AdaFace IR-101/);
    assert.match(captureEngineBlurb(), /AdaFace IR-101/);
    assert.match(engineFooter(ENGINE_VERSION), /AdaFace IR-101/);
    assert.match(galleryLoadingCopy(), /AdaFace IR-101/);
    assert.match(SHARE_ENGINE_STAMP, /ADAFACE IR-101/);
    assert.equal(analyzingSteps(1000)[2]?.label, "Extracting AdaFace embedding");
    assert.match(HUD_IDLE_TELEMETRY.join("\n"), /ADAFACE IR-101/);
    assert.match(hudEmbeddingLine(12), /ADAFACE IR-101/);
    assert.match(hudRankingLine(), /COSINE RANK/);
  });

  it("does not name the retired EdgeFace / Anti-GAN / Biohash path", () => {
    assert.doesNotMatch(userFacingEngineCopy(), BANNED_USER_FACING_ENGINE);
  });

  it("keeps shipped UI/share sources free of retired-engine literals", () => {
    for (const rel of USER_FACING_SOURCES) {
      const text = readFileSync(resolve(rel), "utf8");
      assert.doesNotMatch(
        text,
        BANNED_USER_FACING_ENGINE,
        `${rel} still names a retired engine`,
      );
    }
  });

  it("wires AnalyzingState and the HUD to the shared AdaFace steps", () => {
    const analyzing = readFileSync(resolve("src/components/analyzing-state.tsx"), "utf8");
    const hud = readFileSync(resolve("src/components/scanning/face-scanning-hud.tsx"), "utf8");
    const results = readFileSync(resolve("src/components/results/match-results.tsx"), "utf8");
    const home = readFileSync(resolve("src/components/app-home.tsx"), "utf8");
    assert.match(analyzing, /analyzingSteps/);
    assert.match(hud, /HUD_IDLE_TELEMETRY/);
    assert.match(hud, /hudEmbeddingLine/);
    assert.match(results, /engineFooter/);
    assert.match(home, /captureEngineBlurb/);
    assert.match(home, /REFUSE_HEADING/);
  });
});
