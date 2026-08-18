/**
 * Canonical civilian fine-tune fixture: the standing-swing photo.
 * Keep every live Playwright tour and match-probe default pointed here.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const REPO_ROOT = ROOT;

/** Blonde woman on a gold swing — 1536×2048 standing / full-body civilian shot. */
export const SWING_PROBE = resolve(ROOT, "fixtures/probes/1000067278.jpeg");

/** Held-out Dead Ringer used as person B so closer-twin is a real contrast. */
export const SWING_FRIEND_PROBE = resolve(
  ROOT,
  "public/celebs/held-out/kate-winslet/001.jpg",
);

export const DEFAULT_APP_URL = "http://127.0.0.1:8080/";

export const PACK_CHIPS = Object.freeze([
  "Everyone",
  "90s Icons",
  "Athletes",
  "Musicians",
  "Actors",
  "Models",
  "Public Figures",
]);

export function assertSwingFixture() {
  if (!existsSync(SWING_PROBE)) {
    throw new Error(`Missing swing probe: ${SWING_PROBE}`);
  }
  const bytes = statSync(SWING_PROBE).size;
  if (bytes < 100_000) {
    throw new Error(`Swing probe looks truncated (${bytes} bytes): ${SWING_PROBE}`);
  }
}

export function assertFriendFixture() {
  if (!existsSync(SWING_FRIEND_PROBE)) {
    throw new Error(`Missing friend probe: ${SWING_FRIEND_PROBE}`);
  }
}
