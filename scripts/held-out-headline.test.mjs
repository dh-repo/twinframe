import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_REL = "reports/held-out-v2-baseline.json";
const CI_FLOOR = 75;

function advertisedHeadline(rank1Pct) {
  return `${rank1Pct.toFixed(1)}% Rank-1`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("held-out headline is the tracked baseline, not leftover prose", () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_REL), "utf8"));
  const rank1 = baseline.clean?.rank1Pct;
  const headline = advertisedHeadline(rank1);

  it("tracked clean Rank-1 sits above the CI regression floor", () => {
    assert.equal(baseline.protocol, "held-out-v2.1-leak-excluded");
    assert.ok(typeof rank1 === "number" && Number.isFinite(rank1), "clean.rank1Pct must be a number");
    assert.ok(baseline.clean.n >= 290, `expected n>=290, got ${baseline.clean.n}`);
    assert.ok(
      rank1 >= CI_FLOOR,
      `tracked Rank-1 ${rank1.toFixed(1)}% is below CI floor ${CI_FLOOR}% — the advertised headline drifted`,
    );
  });

  it("README and AGENTS.md cite the tracked JSON and its Rank-1", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
    for (const [name, text] of [
      ["README.md", readme],
      ["AGENTS.md", agents],
    ]) {
      assert.match(text, new RegExp(escapeRegExp(BASELINE_REL)), `${name} must cite ${BASELINE_REL}`);
      assert.match(text, new RegExp(escapeRegExp(headline)), `${name} must advertise ${headline}`);
      assert.doesNotMatch(text, /74\.8% Rank-1/, `${name} still advertises the retired EdgeFace 74.8% headline`);
    }
  });

  it("night-ci held-out floor is 75, not the 40% that would pass a half-stride eval", () => {
    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/night-ci.yml"), "utf8");
    assert.match(ci, /test:heldout -- --floor 75/);
    assert.doesNotMatch(ci, /test:heldout -- --floor 40/);
  });
});
