import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEAD_RINGER_MAX_DISTANCE,
  DEAD_RINGER_MIN_MARGIN,
  verdictFromMatch,
  verdictLabel,
  verdictSubtitle,
  type VerdictTier,
} from "./verdict.ts";

describe("verdictFromMatch", () => {
  it("calls a dead ringer only inside identity range with a clear gap", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.3, rankMargin: 0.12, matchPercent: 92 }),
      "dead-ringer",
    );
    assert.equal(
      verdictFromMatch({
        adjustedDistance: DEAD_RINGER_MAX_DISTANCE,
        rankMargin: DEAD_RINGER_MIN_MARGIN,
        matchPercent: 78,
      }),
      "dead-ringer",
    );
  });

  it("demotes a close distance when the gallery is crowded at that point", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.3, rankMargin: 0.02, matchPercent: 88 }),
      "soft-match",
    );
  });

  it("keeps a distinctive but non-identity match at strong resemblance", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.52, rankMargin: 0.06, matchPercent: 74 }),
      "strong-resemblance",
    );
  });

  it("treats low percents as distant twins regardless of margin", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.72, rankMargin: 0.2, matchPercent: 41 }),
      "distant-twin",
    );
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.68, rankMargin: 0.01, matchPercent: 54.9 }),
      "distant-twin",
    );
  });

  it("lands mid-percent matches in soft match", () => {
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.6, rankMargin: 0.09, matchPercent: 62 }),
      "soft-match",
    );
  });

  it("survives NaN and missing signals without claiming a twin", () => {
    // An unknowable margin cannot support any look-alike claim, so the honest
    // fallback is the labeled nearest neighbor even at high percents.
    assert.equal(
      verdictFromMatch({ adjustedDistance: Number.NaN, rankMargin: Number.NaN, matchPercent: 90 }),
      "distant-twin",
    );
    assert.equal(
      verdictFromMatch({ adjustedDistance: 0.3, rankMargin: 0.2, matchPercent: Number.NaN }),
      "distant-twin",
    );
  });
});

describe("verdict copy", () => {
  it("gives every tier a label and subtitle", () => {
    const tiers: VerdictTier[] = [
      "dead-ringer",
      "strong-resemblance",
      "soft-match",
      "distant-twin",
    ];
    for (const tier of tiers) {
      assert.ok(verdictLabel(tier).length > 0);
      assert.ok(verdictSubtitle(tier).length > 0);
    }
    assert.equal(verdictLabel("dead-ringer"), "Dead Ringer");
    assert.match(verdictSubtitle("distant-twin"), /not a real look-alike/i);
  });
});

describe("verdict tier evidentiary floors (held-out v2.1)", () => {
  // Reproduces verdictFromMatch's decision boundaries over the tracked held-out
  // report and pins an empirical-correctness floor per tier, exactly like the
  // strong-lookalike margin gate in open-set-score.test.ts. If a tier starts
  // mislabeling (e.g. "dead-ringer" below 95% correct), the shipped label is
  // lying and this fails.
  const FLOORS: Record<string, number> = {
    "dead-ringer": 0.95,
    "strong-resemblance": 0.9,
    "soft-match": 0.6,
    "distant-twin": 0.0, // labeled nearest neighbor; no look-alike claim to falsify
  };

  it("each tier meets its empirical correctness floor on tracked data", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const reportPath = path.join(root, "reports/held-out-v2-baseline.json");
    if (!fs.existsSync(reportPath)) return;

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
      records: Array<{
        dTop1: number | null;
        dBestWrong: number | null;
        rank: number;
      }>;
    };

    const { verdictFromMatch } = await import("./verdict.ts");
    const { distanceToMatchPercent } = await import("./embeddings.ts");

    const buckets = new Map<string, { n: number; correct: number }>();
    for (const r of report.records) {
      if (r.dTop1 === null || !Number.isFinite(r.dTop1)) continue;
      if (r.dBestWrong === null || !Number.isFinite(r.dBestWrong)) continue;
      const rankMargin = r.dBestWrong - r.dTop1;
      const percent = distanceToMatchPercent(r.dTop1);
      // verdict input uses the winner's own geometry regardless of identity;
      // correctness = whether that winner was the true id.
      const tier = verdictFromMatch({
        adjustedDistance: r.dTop1,
        rankMargin,
        matchPercent: percent,
      });
      if (!buckets.has(tier)) buckets.set(tier, { n: 0, correct: 0 });
      const b = buckets.get(tier)!;
      b.n++;
      if (r.rank === 1) b.correct++;
    }

    for (const [tier, floor] of Object.entries(FLOORS)) {
      const b = buckets.get(tier);
      if (!b || b.n < 20) continue; // tiers with tiny populations are informational
      const precision = b.correct / b.n;
      assert.ok(
        precision >= floor,
        `tier "${tier}" precision ${(precision * 100).toFixed(1)}% < floor ${floor * 100}% (n=${b.n}) — the label is lying`,
      );
    }
    assert.ok(buckets.size >= 3, `expected multiple populated tiers, got ${[...buckets.keys()]}`);
  });
});
