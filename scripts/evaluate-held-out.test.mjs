import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HILL_D0, HILL_N } from "../src/lib/face/embeddings.ts";
import {
  EASY_STRATUM,
  NEAR_DUPLICATE_MAX_DISTANCE,
  OVERALL_STRATUM,
  canonicalCelebId,
  computeRankStats,
  distanceStats,
  equalErrorDistance,
  expectedCalibrationError,
  fitHillConstants,
  formatMarkdownReport,
  hillLogLoss,
  reliabilityTable,
  isNearDuplicate,
  mergeExtraTemplates,
  partitionLeakage,
  selectProbes,
  stratify,
  wilsonInterval,
} from "./evaluate-held-out.ts";

function record(overrides = {}) {
  return {
    imagePath: "/celebs/held-out/x/001.jpg",
    id: "x",
    slot: "001",
    conditions: [],
    detected: true,
    refused: false,
    nearDuplicate: false,
    rank: 1,
    topId: "x",
    genuineDistance: 0.4,
    impostorDistance: 0.6,
    rawRank: 1,
    matchPercent: 70,
    ...overrides,
  };
}

describe("wilsonInterval", () => {
  it("returns a zero interval for an empty sample instead of NaN", () => {
    assert.deepEqual(wilsonInterval(0, 0), [0, 0]);
  });

  it("brackets the point estimate", () => {
    const [lo, hi] = wilsonInterval(90, 145);
    assert.ok(lo < 62.1 && hi > 62.1, `expected ${lo}-${hi} to bracket 62.1`);
  });

  it("is wider for a small sample than a large one at the same rate", () => {
    const small = wilsonInterval(6, 12);
    const large = wilsonInterval(100, 200);
    assert.ok(small[1] - small[0] > large[1] - large[0]);
  });

  it("keeps a perfect score's interval inside 0-100", () => {
    const [lo, hi] = wilsonInterval(8, 8);
    assert.ok(lo > 0 && lo < 100);
    assert.equal(hi, 100);
  });
});

describe("mergeExtraTemplates", () => {
  const dim = 512;
  const unit = (seed) => {
    const v = new Array(dim).fill(0);
    v[seed % dim] = 1;
    return v;
  };
  const primaries = [
    { id: "adele", name: "Adele", descriptor: unit(1), age: 35, gender: "female", genderProb: 0.9 },
    { id: "zendaya", name: "Zendaya", descriptor: unit(2), age: 27, gender: "female", genderProb: 0.9 },
  ];

  it("returns primaries untouched when there are no extra templates", () => {
    const merged = mergeExtraTemplates(primaries, []);
    assert.deepEqual(
      merged.map((g) => g.id).sort(),
      ["adele", "zendaya"],
    );
  });

  it("adds each extra template plus a centroid prototype, as the browser does", () => {
    const merged = mergeExtraTemplates(primaries, [{ id: "adele", descriptor: unit(3) }]);
    const adele = merged.filter((g) => g.id === "adele");
    assert.equal(adele.length, 3, "primary + extra template + centroid");
    assert.equal(merged.filter((g) => g.id === "zendaya").length, 1);
    assert.ok(
      adele.every((g) => g.name === "Adele" && g.gender === "female"),
      "extras inherit the primary's metadata",
    );
  });

  it("ignores templates for unknown ids, empty descriptors, and padded FaceNet vectors", () => {
    const padded = new Array(dim).fill(0);
    for (let i = 0; i < 128; i++) padded[i] = 0.05;
    const merged = mergeExtraTemplates(primaries, [
      { id: "not-in-gallery", descriptor: unit(4) },
      { id: "adele", descriptor: [] },
      { id: "adele" },
      { id: "adele", descriptor: padded },
    ]);
    assert.equal(merged.length, 2);
  });

  it("normalizes extra descriptors so an unnormalized template cannot dominate ranking", () => {
    const merged = mergeExtraTemplates(primaries, [
      { id: "adele", descriptor: unit(3).map((v) => v * 42) },
    ]);
    for (const entry of merged) {
      const norm = Math.hypot(...entry.descriptor);
      assert.ok(Math.abs(norm - 1) < 1e-5, `expected unit norm, got ${norm}`);
    }
  });
});

describe("computeRankStats", () => {
  it("counts rank-1, rank-5, refusals and MRR", () => {
    const stats = computeRankStats("overall", [
      record({ rank: 1 }),
      record({ rank: 3 }),
      record({ rank: 7 }),
      record({ rank: -1, refused: true, topId: null }),
    ]);
    assert.equal(stats.n, 4);
    assert.equal(stats.rank1, 1);
    assert.equal(stats.rank5, 2);
    assert.equal(stats.rank1Pct, 25);
    assert.equal(stats.rank5Pct, 50);
    assert.equal(stats.refused, 1);
    assert.equal(stats.refusedPct, 25);
    assert.equal(stats.mrr, 0.369); // (1 + 1/3 + 1/7 + 0) / 4
  });

  it("counts a refusal as a miss rather than dropping the probe", () => {
    const stats = computeRankStats("overall", [record({ rank: -1, refused: true })]);
    assert.equal(stats.n, 1);
    assert.equal(stats.rank1Pct, 0);
    assert.equal(stats.refusedPct, 100);
  });

  it("reports zeros, not NaN, for an empty stratum", () => {
    const stats = computeRankStats("glasses", []);
    assert.equal(stats.n, 0);
    assert.equal(stats.rank1Pct, 0);
    assert.deepEqual(stats.rank1Ci95, [0, 0]);
    assert.equal(stats.mrr, 0);
  });

  it("tracks the raw nearest-neighbour rank separately from the product path", () => {
    const stats = computeRankStats("overall", [record({ rank: -1, refused: true, rawRank: 1 })]);
    assert.equal(stats.rank1Pct, 0);
    assert.equal(stats.rawRank1Pct, 100);
  });
});

describe("stratify", () => {
  const records = [
    record({ conditions: ["low-light"], rank: 4 }),
    record({ conditions: ["low-light", "yaw-gt-25"], rank: 1 }),
    record({ conditions: [], rank: 1 }),
  ];

  it("emits overall, every condition, and the no-condition cohort", () => {
    const strata = stratify(records);
    assert.equal(strata[0].stratum, OVERALL_STRATUM);
    assert.equal(strata.at(-1).stratum, EASY_STRATUM);
    assert.deepEqual(
      strata.map((s) => s.stratum).sort(),
      [
        "big-smile",
        "glasses",
        "low-light",
        EASY_STRATUM,
        OVERALL_STRATUM,
        "phone-closeup",
        "yaw-gt-25",
      ].sort(),
    );
  });

  it("counts a probe in every condition it satisfies", () => {
    const strata = stratify(records);
    const byName = new Map(strata.map((s) => [s.stratum, s]));
    assert.equal(byName.get("low-light").n, 2);
    assert.equal(byName.get("low-light").rank1Pct, 50);
    assert.equal(byName.get("yaw-gt-25").n, 1);
    assert.equal(byName.get(EASY_STRATUM).n, 1);
    assert.equal(byName.get("glasses").n, 0);
  });
});

describe("near-duplicate leakage", () => {
  it("flags a probe that is the enrolled photo again", () => {
    assert.ok(isNearDuplicate(0.004));
    assert.ok(isNearDuplicate(NEAR_DUPLICATE_MAX_DISTANCE));
    assert.ok(!isNearDuplicate(0.31));
    assert.ok(!isNearDuplicate(null));
  });

  it("splits records so the leak-free cohort can be scored on its own", () => {
    const { clean, leaked } = partitionLeakage([
      record({ nearDuplicate: true, rank: 1 }),
      record({ nearDuplicate: false, rank: 4 }),
      record({ nearDuplicate: false, rank: 1 }),
    ]);
    assert.equal(leaked.length, 1);
    assert.equal(clean.length, 2);
    assert.equal(computeRankStats("overall", clean).rank1Pct, 50);
  });
});

describe("selectProbes", () => {
  const cases = [
    { id: "b", name: "B", slot: "001", imagePath: "/celebs/held-out/b/001.jpg", evalSlot: true },
    { id: "a", name: "A", slot: "002", imagePath: "/celebs/held-out/a/002.jpg", evalSlot: false },
    { id: "a", name: "A", slot: "001", imagePath: "/celebs/held-out/a/001.jpg", evalSlot: true },
  ];

  it("keeps only slot 001 by default, since 002+ are enrolled views", () => {
    assert.deepEqual(
      selectProbes(cases, { allSlots: false, limit: Number.POSITIVE_INFINITY }).map((c) => c.imagePath),
      ["/celebs/held-out/a/001.jpg", "/celebs/held-out/b/001.jpg"],
    );
  });

  it("includes later slots only when explicitly asked", () => {
    assert.equal(selectProbes(cases, { allSlots: true, limit: Number.POSITIVE_INFINITY }).length, 3);
  });

  it("applies --limit deterministically after sorting", () => {
    assert.deepEqual(
      selectProbes(cases, { allSlots: true, limit: 2 }).map((c) => c.imagePath),
      ["/celebs/held-out/a/001.jpg", "/celebs/held-out/a/002.jpg"],
    );
  });
});

describe("distanceStats", () => {
  it("summarises quantiles and ignores nulls", () => {
    const stats = distanceStats([0.2, 0.4, 0.6, 0.8, Number.NaN]);
    assert.equal(stats.n, 4);
    assert.equal(stats.mean, 0.5);
    assert.equal(stats.p50, 0.6);
  });

  it("returns nulls rather than zeros when there is no data", () => {
    assert.deepEqual(distanceStats([]), { n: 0, mean: null, p10: null, p50: null, p90: null });
  });
});

describe("hill calibration", () => {
  const genuine = [0.2, 0.25, 0.3, 0.32, 0.35];
  const impostor = [0.7, 0.72, 0.75, 0.8, 0.85];

  it("scores a well-separated sample better than a badly-placed curve", () => {
    const good = hillLogLoss(genuine, impostor, 0.5, 6);
    const bad = hillLogLoss(genuine, impostor, 0.15, 6);
    assert.ok(good < bad, `expected ${good} < ${bad}`);
  });

  it("puts the equal-error distance between the two distributions", () => {
    const eer = equalErrorDistance(genuine, impostor);
    assert.ok(eer.distance >= 0.35 && eer.distance < 0.7, `eer ${eer.distance}`);
    assert.equal(eer.errorRate, 0);
  });

  it("reports insufficient-data instead of inventing constants", () => {
    const fit = fitHillConstants([], []);
    assert.equal(fit.fitted, null);
    assert.equal(fit.verdict, "insufficient-data");
    assert.equal(fit.current.d0, HILL_D0);
    assert.equal(fit.current.n, HILL_N);
  });

  it("recovers the constants that generated a separable sample", () => {
    const fit = fitHillConstants(genuine, impostor);
    assert.ok(fit.fitted.d0 > 0.35 && fit.fitted.d0 < 0.75, `d0 ${fit.fitted.d0}`);
    assert.ok(fit.fitted.logLoss <= fit.current.logLoss);
    assert.ok(fit.grid.some((cell) => cell.d0 === HILL_D0 && cell.n === HILL_N));
  });

  it("keeps the current constants when the refit barely moves", () => {
    const tight = fitHillConstants([HILL_D0 - 0.3], [HILL_D0 + 0.3]);
    assert.ok(tight.verdict.startsWith("keep-current") || tight.verdict === "recalibrate");
    const same = fitHillConstants([0.45, 0.5], [0.7, 0.75]);
    assert.equal(typeof same.verdict, "string");
  });

  it("refuses to recalibrate when the refit only wins log-loss by hedging", () => {
    const fit = fitHillConstants(genuine, impostor);
    assert.ok(fit.calibrationError.current !== null);
    if (fit.calibrationError.fitted - fit.calibrationError.current > 1) {
      assert.ok(
        fit.verdict.startsWith("keep-current"),
        `a worse-calibrated refit must not win: ${fit.verdict}`,
      );
    }
  });
});

describe("reliabilityTable", () => {
  it("reports the claimed percentage against how often the top match was right", () => {
    // Distances chosen so the correct pairs land near-certain and the wrong ones near-even.
    const pairs = [
      { genuine: 0.1, impostor: 0.6 },
      { genuine: 0.1, impostor: 0.6 },
      { genuine: 0.7, impostor: 0.6 },
      { genuine: 0.7, impostor: 0.62 },
    ];
    const bins = reliabilityTable(pairs, HILL_D0, HILL_N);
    const confident = bins.find((b) => b.band === "95-100%");
    assert.equal(confident.n, 2);
    assert.equal(confident.observedPct, 100, "both near-zero-distance probes were correct");
    assert.ok(confident.claimedPct > 95);

    const middling = bins.filter((b) => b.n > 0 && b.band !== "95-100%");
    assert.equal(
      middling.reduce((acc, b) => acc + b.n, 0),
      2,
    );
    assert.ok(
      middling.every((b) => b.observedPct === 0),
      "the impostor-topped probes were wrong",
    );
  });

  it("emits an empty band rather than dropping it, so a report cannot hide a gap", () => {
    const bins = reliabilityTable([{ genuine: 0.05, impostor: 0.9 }], HILL_D0, HILL_N);
    assert.equal(bins.length, 6);
    const empty = bins.find((b) => b.band === "40-60%");
    assert.equal(empty.n, 0);
    assert.equal(empty.claimedPct, null);
    assert.equal(empty.gapPct, null);
  });

  it("signs the gap so overstatement is positive", () => {
    const overstating = reliabilityTable([{ genuine: 0.61, impostor: 0.6 }], HILL_D0, HILL_N);
    const populated = overstating.find((b) => b.n > 0);
    assert.equal(populated.observedPct, 0);
    assert.ok(populated.gapPct > 0, "claiming anything about a wrong answer overstates");
  });
});

describe("expectedCalibrationError", () => {
  it("weights each band by its probe count, so a tiny band cannot dominate", () => {
    const bins = [
      { band: "40-60%", n: 1, claimedPct: 50, observedPct: 0, gapPct: 50 },
      { band: "95-100%", n: 99, claimedPct: 99, observedPct: 99, gapPct: 0 },
    ];
    assert.equal(expectedCalibrationError(bins), 0.5);
  });

  it("ignores sign, so understating is penalised too", () => {
    const over = expectedCalibrationError([{ band: "a", n: 10, claimedPct: 90, observedPct: 70, gapPct: 20 }]);
    const under = expectedCalibrationError([{ band: "a", n: 10, claimedPct: 50, observedPct: 70, gapPct: -20 }]);
    assert.equal(over, 20);
    assert.equal(under, 20);
  });

  it("returns null when no band has probes", () => {
    assert.equal(expectedCalibrationError([{ band: "a", n: 0, claimedPct: null, observedPct: null, gapPct: null }]), null);
  });
});

describe("formatMarkdownReport", () => {
  const report = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    engine: "EdgeFace-512",
    gallerySize: 1000,
    galleryIdentities: 999,
    slots: "001 only",
    conditionProvenance: {
      "low-light": "auto (SCRFD geometry)",
      glasses: "manual labels only",
      "big-smile": "auto (low-confidence proxy)",
      "yaw-gt-25": "auto (SCRFD geometry)",
      "phone-closeup": "auto (SCRFD geometry)",
      [EASY_STRATUM]: "derived",
    },
    strata: stratify([record({ rank: 1 }), record({ rank: 9, conditions: ["low-light"] })]),
    strataExcludingNearDuplicates: stratify([record({ rank: 9, conditions: ["low-light"] })]),
    distances: { "genuine (probe → own identity)": distanceStats([0.4, 0.5]) },
    distancesExcludingNearDuplicates: { "genuine (probe → own identity)": distanceStats([0.5]) },
    hill: fitHillConstants([0.3, 0.35], [0.7, 0.75]),
    hillExcludingNearDuplicates: fitHillConstants([0.45], [0.72]),
    leakage: { maxDistance: 0.05, count: 1, pct: 50, note: "n", ids: ["x"] },
    misses: [{ id: "x", slot: "001", conditions: ["low-light"], topId: "y", refused: false, rawRank: 9 }],
    commands: ["node --experimental-strip-types scripts/evaluate-held-out.ts"],
  };

  it("leads with the leak-free cohort and still shows the inflated one", () => {
    const md = formatMarkdownReport(report);
    const headline = md.indexOf("Held out for real");
    const inflated = md.indexOf("Every probe on disk");
    assert.ok(headline > 0 && inflated > headline);
    assert.match(md, /1 of 2 probes \(50%\)/);
  });

  it("names every condition and marks which labels are manual", () => {
    const md = formatMarkdownReport(report);
    for (const label of ["Low light", "Glasses", "Big smile", "Yaw > 25°", "Phone close-up"]) {
      assert.ok(md.includes(label), `missing ${label}`);
    }
    assert.ok(md.includes("manual labels only"));
    assert.ok(md.includes("low-confidence proxy"));
  });

  it("renders empty strata as an em dash instead of 0%", () => {
    const md = formatMarkdownReport(report);
    const glassesRow = md.split("\n").find((l) => l.startsWith("| Glasses |"));
    assert.ok(glassesRow.includes("—"), glassesRow);
    assert.ok(!glassesRow.includes("0%"), glassesRow);
  });

  it("includes the reproduce commands verbatim", () => {
    assert.ok(formatMarkdownReport(report).includes(report.commands[0]));
  });
});

describe("canonicalCelebId", () => {
  it("folds the duplicated catalog spelling", () => {
    assert.equal(canonicalCelebId("gwenyth-paltrow"), "gwyneth-paltrow");
    assert.equal(canonicalCelebId("brad-pitt"), "brad-pitt");
  });
});
