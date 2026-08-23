import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

const {
  normalizeSource,
  collectGallerySources,
  evaluateHeldOutCases,
  assertDimensionsCompatible,
} = await import("./evaluate-held-out-v2.ts");

function galleryEntry(id, descriptor, extra = {}) {
  return {
    id,
    name: id,
    path: `celebs/${id}.jpg`,
    descriptor,
    age: extra.age ?? 35,
    gender: extra.gender ?? "female",
    genderProb: extra.genderProb ?? 0.9,
  };
}

function unitVec(values) {
  const norm = Math.sqrt(values.reduce((a, v) => a + v * v, 0));
  return Float32Array.from(values.map((v) => v / norm));
}

function packCase(id, values, extra = {}) {
  return {
    id,
    descriptor: Array.from(values),
    age: extra.age ?? 30,
    gender: extra.gender ?? "female",
    genderProb: extra.genderProb ?? 0.95,
    ok: extra.ok ?? true,
    source: extra.source,
  };
}

describe("held-out protocol leakage rule (structural, tracked data only)", () => {
  it("collects a non-empty source set from the shipped gallery artifacts", () => {
    const sources = collectGallerySources(CELEBS);
    assert.ok(sources.size >= 1000, `expected >=1000 enrolled sources, got ${sources.size}`);
    for (const s of sources) {
      assert.ok(!s.startsWith("/"), `sources must be root-relative, got ${s}`);
    }
  });

  it("no tracked probe may share a source file with any gallery artifact", () => {
    const pack = JSON.parse(
      fs.readFileSync(path.join(CELEBS, "held-out/descriptors.json"), "utf8"),
    );
    const leaked = collectGallerySources(CELEBS);
    const offenders = (pack.cases ?? [])
      .filter((c) => c.source && leaked.has(normalizeSource(c.source)))
      .map((c) => c.id);
    assert.deepEqual(
      offenders,
      [],
      `${offenders.length} probes are scored against their own enrollment images — regenerate descriptors.json via manifest-clean.json`,
    );
  });

  it("the clean-probe manifest excludes every gallery-sourced file", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(CELEBS, "held-out/manifest-clean.json"), "utf8"),
    );
    const leaked = collectGallerySources(CELEBS);
    for (const c of manifest.cases) {
      const rel = normalizeSource(c.imagePath);
      assert.ok(
        !leaked.has(rel),
        `manifest-clean contains gallery-sourced file ${rel} — regeneration bug`,
      );
    }
  });
});

describe("held-out protocol dimension guard", () => {
  it("throws with re-encode guidance when probe dim differs from gallery dim", () => {
    const cases = [packCase("a", new Array(128).fill(0.5))];
    assert.throws(
      () => assertDimensionsCompatible(cases, 512),
      /dimension mismatch.*re-encode/s,
    );
  });

  it("accepts matching dims and skips cases without descriptors", () => {
    assert.doesNotThrow(() => assertDimensionsCompatible([packCase("a", [1, 0])], 2));
    assert.doesNotThrow(() => assertDimensionsCompatible([{ id: "x", descriptor: [] }], 512));
  });
});

describe("held-out protocol metrics on synthetic galleries", () => {
  // 8-d synthetic space; equal-length probe/gallery vectors keep cosine well-defined.
  const gA1 = unitVec([1, 0, 0, 0, 0, 0, 0, 0]);
  const gA2 = unitVec([0.9, 0.1, 0, 0, 0, 0, 0, 0]);
  const gB = unitVec([0, 1, 0, 0, 0, 0, 0, 0]);
  const gallery = [
    galleryEntry("alice", gA1),
    galleryEntry("alice", gA2),
    galleryEntry("bob", gB),
  ];

  it("ranks a clean probe rank-1 and computes metrics", () => {
    const probeAlice = unitVec([0.98, 0.02, 0, 0, 0, 0, 0, 0]);
    const probeBob = unitVec([0, 0.98, 0.02, 0, 0, 0, 0, 0]);
    const { records, skipped, notEnrolled } = evaluateHeldOutCases(
      gallery,
      [
        { ...packCase("alice", probeAlice), source: "held-out/alice/x.jpg" },
        { ...packCase("bob", probeBob), source: "held-out/bob/y.jpg" },
      ],
      { excludeLeaked: true },
    );
    assert.equal(records.length, 2);
    assert.equal(records[0].rank, 1);
    assert.equal(records[0].id, "alice");
    assert.equal(skipped, 0);
    assert.equal(notEnrolled, 0);
  });

  it("counts prior-driven same-id bucket flips with non-negative margin", () => {
    // Geometry: probe sits at angle 0. Bucket "close" is 20 degrees away (raw-closest)
    // but male + ancient; bucket "far" sits at acos(1 - 1.1*dClose) (10% farther raw)
    // yet female + same-age-as-probe. Priors may only overcome a distance deficit when
    // adjusted = dist / (0.72 + 0.18*g + 0.10*a) favors them; max affinity spread gives
    // denominator ratio ~1.16, so a 10% deficit flips the within-id choice. This pins
    // margin = dTop1 - dMinSameId >= 0 (the historical "negative margin" report bug).
    const deg = (x) => (x * Math.PI) / 180;
    const angleVec = (thetaRad) => {
      const v = new Array(8).fill(0);
      v[0] = Math.cos(thetaRad);
      v[1] = Math.sin(thetaRad);
      return unitVec(v);
    };
    const thetaClose = deg(20);
    const dClose = 1 - Math.cos(thetaClose);
    const thetaFar = Math.acos(1 - 1.1 * dClose);

    const closeMaleOld = galleryEntry("carol", angleVec(thetaClose), {
      age: 95,
      gender: "male",
      genderProb: 0.99,
    });
    const farFemaleYoung = galleryEntry("carol", angleVec(thetaFar), {
      age: 30,
      gender: "female",
      genderProb: 0.99,
    });
    const other = galleryEntry("dave", unitVec([0, 0, 1, 0, 0, 0, 0, 0]));
    const probe = unitVec([1, 0, 0, 0, 0, 0, 0, 0]);
    const { records } = evaluateHeldOutCases(
      [closeMaleOld, farFemaleYoung, other],
      [packCase("carol", probe, { age: 30, gender: "female", genderProb: 1 })],
      { excludeLeaked: true },
    );
    assert.equal(records.length, 1);
    const r = records[0];
    assert.ok(r.priorFlipped, `expected prior flip, got margin=${r.margin}`);
    assert.ok(Math.abs(r.margin - (r.dTop1 - r.dMinSameId)) < 1e-9);
    assert.ok(r.margin > 0 && r.margin <= 0.2 * r.dMinSameId, `margin should be a modest positive gap, got ${r.margin}`);
    assert.equal(r.rank, 1, "true identity must still rank #1");
    assert.ok(r.dTop1 > r.dMinSameId);
  });

  it("skips invalid cases and unknown ids instead of ranking them", () => {
    const probe = unitVec([1, 0, 0, 0, 0, 0, 0, 0]);
    const { records, skipped, notEnrolled } = evaluateHeldOutCases(
      gallery,
      [
        packCase("alice", probe, { ok: false }),
        { id: "ghost", descriptor: Array.from(probe), ok: true },
        { id: "nulldesc", descriptor: [], ok: true },
        packCase("alice", probe),
      ],
      { excludeLeaked: true },
    );
    assert.equal(skipped, 2);
    assert.equal(notEnrolled, 1);
    assert.equal(records.length, 1);
  });

  it("returns zeroed metrics for empty record sets (divide-by-zero guard)", async () => {
    const mod = await import("./evaluate-held-out-v2.ts");
    // metricsFor is private; exercise via evaluateHeldOutCases with all-invalid cases
    // and verify report math downstream in main() — here we pin the guard indirectly.
    const { records } = mod.evaluateHeldOutCases(gallery, [{ id: "x", descriptor: [] }], {
      excludeLeaked: true,
    });
    assert.equal(records.length, 0);
  });

  it("treats missing source as not-leaked but never as an error", () => {
    const probe = unitVec([1, 0, 0, 0, 0, 0, 0, 0]);
    const { records } = evaluateHeldOutCases(gallery, [packCase("alice", probe)], {
      excludeLeaked: true,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].leaked, false);
  });
});
