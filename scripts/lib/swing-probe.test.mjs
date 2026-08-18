import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PACK_CHIPS,
  SWING_FRIEND_PROBE,
  SWING_PROBE,
  assertFriendFixture,
  assertSwingFixture,
} from "./swing-probe.mjs";

describe("swing civilian fixture", () => {
  it("keeps the standing-swing jpeg as the live tour probe", () => {
    assert.ok(SWING_PROBE.endsWith("fixtures/probes/1000067278.jpeg"));
    assertSwingFixture();
    assert.ok(statSync(SWING_PROBE).size > 100_000);
  });

  it("pairs the swing photo with the held-out Kate friend probe", () => {
    assert.ok(existsSync(SWING_FRIEND_PROBE));
    assertFriendFixture();
  });

  it("exposes every product pack chip the tour should click", () => {
    assert.deepEqual(PACK_CHIPS, [
      "Everyone",
      "90s Icons",
      "Athletes",
      "Musicians",
      "Actors",
      "Models",
      "Public Figures",
    ]);
  });
});
