import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isEvalSlotSource,
  parseFp16EvalArgs,
  selectLeakExcludedSubset,
} from "./evaluate-held-out-fp16.mjs";
import {
  collectGallerySources,
  evaluateHeldOutCases,
  loadGallery,
  mergeExtraTemplates,
  metricsFor,
  normalizeSource,
} from "./evaluate-held-out-v2.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, "reports/held-out-fp16-ranking.json");
const DESC = path.join(ROOT, "reports/held-out-fp16-descriptors.json");
const PROTOCOL = "held-out-v2.1-leak-excluded-fp16-session";
const CI_FLOOR = 75;
const MIN_N = 30;

describe("FP16 held-out subset protocol", () => {
  it("parses --limit and refuses a nonsense limit", () => {
    assert.equal(parseFp16EvalArgs([]).limit, 48);
    assert.equal(parseFp16EvalArgs(["--limit", "32"]).limit, 32);
    assert.equal(parseFp16EvalArgs(["--fetch"]).fetch, true);
    assert.throws(() => parseFp16EvalArgs(["--limit", "0"]), /Invalid --limit/);
  });

  it("prefers eval-slot 001 and drops leaked + duplicate ids", () => {
    const leaked = new Set(["celebs/adele.jpg", "adele.jpg"]);
    const cases = [
      { id: "adele", source: "/celebs/adele.jpg", ok: true },
      { id: "brad-pitt", source: "/celebs/held-out/brad-pitt/001.jpg", ok: true },
      { id: "brad-pitt", source: "/celebs/held-out/brad-pitt/002.jpg", ok: true },
      { id: "zendaya", source: "/celebs/held-out/zendaya/001.jpg", ok: true },
      { id: "miss", source: "/celebs/held-out/miss/001.jpg", ok: false },
    ];
    const out = selectLeakExcludedSubset(cases, leaked, 8);
    assert.deepEqual(
      out.map((c) => c.id),
      ["brad-pitt", "zendaya"],
    );
    assert.equal(isEvalSlotSource(out[0].source), true);
    assert.equal(leaked.has(normalizeSource(cases[0].source)), true);
  });

  it("browser held-out AdaFace engine defaults to the live FP16 URL", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/routes/held-out-encode.tsx"), "utf8");
    assert.match(src, /adaModel.*adaface_ir101_webface12m\.fp16\.onnx/);
    assert.doesNotMatch(
      src,
      /adaModel.*\|\| \"\/models\/adaface_ir101_webface12m\.onnx\"/,
    );
  });
});

describe("FP16 held-out ranking vs shipped gallery (tracked pack)", () => {
  it("tracked report documents n, protocol, and paired fp32", () => {
    assert.equal(fs.existsSync(REPORT), true, "run scripts/evaluate-held-out-fp16.mjs --fetch");
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    assert.equal(report.protocol, PROTOCOL);
    assert.equal(report.ciFloorPct, CI_FLOOR);
    assert.ok(report.n >= MIN_N, `expected n>=${MIN_N} leak-excluded probes, got ${report.n}`);
    assert.ok(typeof report.fp16?.rank1Pct === "number");
    assert.ok(typeof report.fp32Paired?.rank1Pct === "number");
    assert.equal(report.fp16.n, report.n);
    assert.ok(report.cosine?.mean >= 0.97, `paired cosine ${report.cosine?.mean} failed the identity gate`);
  });

  it("FP16 Rank-1 meets the 75% CI floor and does not drop vs fp32 on the same probes", () => {
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    assert.ok(
      report.fp16.rank1Pct >= CI_FLOOR,
      `FP16 Rank-1 ${report.fp16.rank1Pct.toFixed(1)}% collapsed below ${CI_FLOOR}% (n=${report.n})`,
    );
    const drop = report.fp32Paired.rank1Pct - report.fp16.rank1Pct;
    assert.ok(
      drop <= 2 || report.fp16.rank1Pct >= report.fp32Paired.rank1Pct,
      `FP16 Rank-1 dropped ${drop.toFixed(1)} pts vs paired fp32 (${report.fp32Paired.rank1Pct.toFixed(1)}% → ${report.fp16.rank1Pct.toFixed(1)}%)`,
    );
  });

  it("re-ranks the tracked FP16 descriptors through rankByDescriptor and fails if ranking collapsed", () => {
    const pack = JSON.parse(fs.readFileSync(DESC, "utf8"));
    assert.equal(pack.model, "adaface-ir101-fp16-512d");
    assert.equal(pack.dim, 512);
    assert.equal(pack.protocol, PROTOCOL);
    assert.ok(pack.cases?.length >= MIN_N);

    const leaked = collectGallerySources();
    const offenders = pack.cases.filter((c) => c.source && leaked.has(normalizeSource(c.source)));
    assert.deepEqual(offenders, [], `${offenders.length} FP16 probes share a gallery source`);

    const gallery = mergeExtraTemplates(loadGallery());
    const { records } = evaluateHeldOutCases(gallery, pack.cases, { excludeLeaked: true });
    const fp16 = metricsFor(records, (r) => !r.leaked);
    assert.ok(fp16.n >= MIN_N, `re-rank n=${fp16.n}`);
    assert.ok(
      fp16.rank1Pct >= CI_FLOOR,
      `re-ranked FP16 Rank-1 ${fp16.rank1Pct.toFixed(1)}% < ${CI_FLOOR}% — FP16 ranking collapsed`,
    );

    if (pack.fp32PairedCases?.length) {
      const { records: fp32Records } = evaluateHeldOutCases(gallery, pack.fp32PairedCases, {
        excludeLeaked: true,
      });
      const fp32 = metricsFor(fp32Records, (r) => !r.leaked);
      const drop = fp32.rank1Pct - fp16.rank1Pct;
      assert.ok(
        drop <= 2 || fp16.rank1Pct >= fp32.rank1Pct,
        `re-ranked FP16 dropped ${drop.toFixed(1)} pts vs paired fp32`,
      );
    }
  });
});
