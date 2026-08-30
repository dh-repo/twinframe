import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALIBRATION_COEFFS,
  CALIBRATION_VERSION,
  probabilityCorrect,
  calibratedRank1Probability,
} from "./calibration.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");

describe("calibrated rank-1 probability", () => {
  it("is monotonically decreasing in candidate distance (gap fixed)", () => {
    const gap = 0.1;
    let prev = 1;
    for (let d = 0.2; d <= 1.4; d += 0.05) {
      const p = probabilityCorrect(d, gap);
      assert.ok(p <= prev + 1e-9, `probability increased at d=${d}: ${p} > ${prev}`);
      prev = p;
    }
  });

  it("is monotonically increasing in separability gap (distance fixed)", () => {
    const d = 0.6;
    let prev = 0;
    for (let gap = -0.3; gap <= 0.6; gap += 0.05) {
      const p = probabilityCorrect(d, gap);
      assert.ok(p >= prev - 1e-9, `probability decreased at gap=${gap}: ${p} < ${prev}`);
      prev = p;
    }
  });

  it("stays inside [0.001, 0.999] for degenerate and adversarial inputs", () => {
    for (const [d, gap] of [
      [NaN, 0.1],
      [0.5, NaN],
      [Infinity, Infinity],
      [-Infinity, -Infinity],
      [0, 0],
      [-5, 100],
    ] as Array<[number, number]>) {
      const p = probabilityCorrect(d, gap);
      assert.ok(p >= 0.001 && p <= 0.999, `out of clamp for (${d},${gap}): ${p}`);
    }
  });

  it("matches the fitted coefficients on a known point", () => {
    const c = CALIBRATION_COEFFS;
    const z1 = (0.5997 - c.muDtrue) / c.sdDtrue;
    const z2 = (-0.2406 - c.muGap) / c.sdGap;
    const expected = 1 / (1 + Math.exp(-(c.intercept + c.wDtrue * z1 + c.wGap * z2)));
    assert.ok(Math.abs(probabilityCorrect(0.5997, -0.2406) - expected) < 1e-9);
  });

  it("annotates only rank-1 and is undefined for an empty list", () => {
    const matches = [
      { celebrityId: "a", distance: 0.45 },
      { celebrityId: "b", distance: 0.7 },
    ];
    const p1 = calibratedRank1Probability(matches as never);
    assert.ok(p1 !== undefined && Number.isFinite(p1) && p1 > 0 && p1 < 1);
    assert.equal(calibratedRank1Probability([] as never), undefined);
  });

  it("reliably separates a clear twin from an out-ranked impostor", () => {
    // Clear twin: close distance AND nearest other identity well behind (+gap).
    const twin = calibratedRank1Probability([
      { celebrityId: "x", distance: 0.42 },
      { celebrityId: "y", distance: 0.75 },
    ] as never)!;
    // Likely-wrong: another identity sits closer than the shown candidate
    // (negative gap — the dominant signature of rank-1 misses in held-out data).
    const outranked = calibratedRank1Probability([
      { celebrityId: "x", distance: 1.05 },
      { celebrityId: "y", distance: 0.25 },
    ] as never)!;
    assert.ok(twin > 0.9, `clear twin should be high-probability, got ${twin.toFixed(3)}`);
    assert.ok(outranked < 0.35, `out-ranked match should be low-probability, got ${outranked.toFixed(3)}`);
  });

  it("recomputed ECE against the tracked leak-excluded report stays under 0.05", () => {
    const reportPath = path.join(ROOT, "reports/held-out-v2-baseline.json");
    if (!fs.existsSync(reportPath)) return; // report artifact optional in sparse checkouts
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
      records: Array<{ dTrue: number | null; dBestWrong: number | null; rank: number }>;
    };
    const pairs = report.records
      .filter(
        (r) =>
          r.dTrue !== null &&
          Number.isFinite(r.dTrue) &&
          r.dBestWrong !== null &&
          Number.isFinite(r.dBestWrong),
      )
      .map((r) => ({
        p: probabilityCorrect(r.dTrue as number, (r.dBestWrong as number) - (r.dTrue as number)),
        y: r.rank === 1 ? 1 : 0,
      }));
    assert.ok(pairs.length >= 200, `expected >=200 scored probes, got ${pairs.length}`);

    const bins = new Map<number, Array<{ p: number; y: number }>>();
    for (const pair of pairs) {
      const b = Math.min(9, Math.floor(pair.p * 10));
      if (!bins.has(b)) bins.set(b, []);
      bins.get(b)!.push(pair);
    }
    let ece = 0;
    for (const bucket of bins.values()) {
      const conf = bucket.reduce((a, v) => a + v.p, 0) / bucket.length;
      const acc = bucket.reduce((a, v) => a + v.y, 0) / bucket.length;
      ece += (bucket.length / pairs.length) * Math.abs(conf - acc);
    }
    assert.ok(ece < 0.05, `calibration ECE regressed to ${ece.toFixed(4)} (must stay < 0.05)`);
    void CALIBRATION_VERSION;
  });
});

describe("calibration provenance", () => {
  it("shipped coefficients match the deterministic refit on tracked eval data", async () => {
    const { execFileSync } = await import("node:child_process");
    // The refit script is deterministic (fixed iterations/lr) and exits 1 when
    // CALIBRATION_COEFFS drift beyond tolerance from the tracked report — the
    // guard against changing data or constants without re-fitting.
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/refit-calibration.ts"],
      { cwd: REPO_ROOT, timeout: 60_000, stdio: "pipe" },
    );
  });
});
