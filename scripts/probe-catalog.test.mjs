import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_PROBE_SOURCES,
  PROBE_SOURCES,
  classifyGalleryDescriptors,
  collectProbeCatalog,
  countBySource,
  enrollmentRelation,
  parseProbeSourcesArg,
  probeSourceCandidates,
  sampleProbes,
  summarizeByEnrollment,
  summarizeBySource,
} from "./lib/probe-catalog.mjs";

const CELEBS = "/celebs-dir";

function index(...ids) {
  return ids.map((id) => ({
    id,
    name: id.toUpperCase(),
    path: `/celebs/thumbs/192/${id}.webp`,
    path192: `/celebs/thumbs/192/${id}.webp`,
    gender: "female",
    baseAge: 30,
  }));
}

/** Deterministic pseudo-random unit vector, so the tests never flake. */
function pseudoRandomUnit(dim, seed) {
  let state = seed * 2654435761 + 1;
  const out = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out[i] = state / 0x3fffffff - 1;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

/** A unit vector inside a narrow cone around axis 0, like a real FaceNet descriptor. */
function conedUnit(dim, seed) {
  const noise = pseudoRandomUnit(dim, seed);
  const out = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    out[i] = (i === 0 ? 3 : 0) + noise[i];
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

describe("probe source selection", () => {
  test("defaults to root JPGs so a limited run stays comparable to the historical set", () => {
    assert.deepEqual(parseProbeSourcesArg(undefined), ["root-jpg"]);
    assert.deepEqual(DEFAULT_PROBE_SOURCES, ["root-jpg"]);
  });

  test("expands the named aliases and preserves source priority order", () => {
    assert.deepEqual(parseProbeSourcesArg("all"), PROBE_SOURCES);
    assert.deepEqual(parseProbeSourcesArg("root"), ["root-jpg"]);
    assert.deepEqual(parseProbeSourcesArg("thumbs"), ["thumb-192", "thumb-96"]);
    assert.deepEqual(parseProbeSourcesArg("thumb-96, root-jpg"), ["root-jpg", "thumb-96"]);
  });

  test("rejects unknown sources instead of silently measuring nothing", () => {
    assert.throws(() => parseProbeSourcesArg("root-png"), /Unknown probe source/);
  });

  test("lists candidates best-first per id", () => {
    const candidates = probeSourceCandidates("adele", CELEBS);
    assert.deepEqual(
      candidates.map((c) => c.source),
      ["root-jpg", "thumb-192", "thumb-96"],
    );
    assert.equal(candidates[0].needsTranscode, false);
    assert.equal(candidates[1].needsTranscode, true);
  });
});

describe("enrollmentRelation", () => {
  test("calls a root JPG the enrolled photo, because enrollment prefers it", () => {
    assert.equal(enrollmentRelation("root-jpg", true), "enrolled photo");
    assert.equal(enrollmentRelation("root-jpg", false), "enrolled photo");
  });

  test("distinguishes a thumbnail that shadows a root JPG from one enrollment used itself", () => {
    assert.equal(enrollmentRelation("thumb-192", true), "downscale of the enrolled photo");
    assert.equal(enrollmentRelation("thumb-192", false), "enrolled photo (downscaled)");
    assert.equal(enrollmentRelation("thumb-96", false), "enrolled photo (downscaled)");
  });

  test("throws on an unhandled source instead of implying the probe is unseen", () => {
    assert.throws(() => enrollmentRelation("held-out", false), /Unknown probe source/);
  });
});

describe("collectProbeCatalog", () => {
  const onDisk = new Set([
    `${CELEBS}/adele.jpg`,
    `${CELEBS}/thumbs/192/adele.webp`,
    `${CELEBS}/thumbs/192/zendaya.webp`,
    `${CELEBS}/thumbs/96/nobody.webp`,
  ]);
  const exists = (p) => onDisk.has(p);

  test("prefers the root JPG and falls back to thumbnails only when allowed", () => {
    const rootOnly = collectProbeCatalog(index("adele", "zendaya"), {
      celebsDir: CELEBS,
      sources: ["root-jpg"],
      exists,
    });
    assert.deepEqual(
      rootOnly.map((p) => [p.id, p.source]),
      [["adele", "root-jpg"]],
    );

    const withThumbs = collectProbeCatalog(index("adele", "zendaya", "nobody"), {
      celebsDir: CELEBS,
      sources: PROBE_SOURCES,
      exists,
    });
    assert.deepEqual(
      withThumbs.map((p) => [p.id, p.source]),
      [
        ["adele", "root-jpg"],
        ["nobody", "thumb-96"],
        ["zendaya", "thumb-192"],
      ],
    );
  });

  test("records how each probe relates to enrollment and flags transcoding", () => {
    const catalog = collectProbeCatalog(index("adele", "zendaya"), {
      celebsDir: CELEBS,
      sources: PROBE_SOURCES,
      exists,
    });
    const adele = catalog.find((p) => p.id === "adele");
    const zendaya = catalog.find((p) => p.id === "zendaya");
    assert.equal(adele.enrollmentRelation, "enrolled photo");
    assert.equal(adele.needsTranscode, false);
    assert.equal(
      zendaya.enrollmentRelation,
      "enrolled photo (downscaled)",
      "with no root JPG, enrollment itself came from this thumbnail",
    );
    assert.equal(zendaya.needsTranscode, true, "node-canvas cannot decode WebP");
  });

  test("emits one probe per id and counts the source mix", () => {
    const catalog = collectProbeCatalog(index("adele", "zendaya", "nobody"), {
      celebsDir: CELEBS,
      sources: PROBE_SOURCES,
      exists,
    });
    assert.equal(new Set(catalog.map((p) => p.id)).size, catalog.length);
    assert.deepEqual(countBySource(catalog), { "root-jpg": 1, "thumb-192": 1, "thumb-96": 1 });
  });

  test("skips index entries with no id and ids with no file on disk", () => {
    const catalog = collectProbeCatalog([...index("adele"), { name: "nameless" }, { id: "missing" }], {
      celebsDir: CELEBS,
      sources: PROBE_SOURCES,
      exists,
    });
    assert.deepEqual(
      catalog.map((p) => p.id),
      ["adele"],
    );
  });
});

describe("sampleProbes", () => {
  const catalog = Array.from({ length: 100 }, (_, i) => ({ id: `id-${String(i).padStart(3, "0")}` }));

  test("returns everything when the limit is absent or wider than the catalog", () => {
    assert.equal(sampleProbes(catalog, null).length, 100);
    assert.equal(sampleProbes(catalog, 0).length, 100);
    assert.equal(sampleProbes(catalog, 500).length, 100);
  });

  test("spreads a limited run across the whole id-sorted catalog", () => {
    const picked = sampleProbes(catalog, 5, "spread");
    assert.deepEqual(
      picked.map((p) => p.id),
      ["id-000", "id-020", "id-040", "id-060", "id-080"],
    );
  });

  test("keeps the old head-slice behaviour available and both modes deterministic", () => {
    assert.deepEqual(
      sampleProbes(catalog, 3, "first").map((p) => p.id),
      ["id-000", "id-001", "id-002"],
    );
    assert.deepEqual(sampleProbes(catalog, 7, "spread"), sampleProbes(catalog, 7, "spread"));
  });

  test("rejects an unknown mode rather than quietly picking one", () => {
    assert.throws(() => sampleProbes(catalog, 3, "random"), /Unknown sample mode/);
  });
});

describe("classifyGalleryDescriptors", () => {
  test("separates random filler vectors from real coned embeddings", () => {
    const descriptors = [
      ...Array.from({ length: 30 }, (_, i) => conedUnit(128, i + 1)),
      ...Array.from({ length: 70 }, (_, i) => pseudoRandomUnit(128, i + 500)),
    ];
    const result = classifyGalleryDescriptors(descriptors);
    assert.equal(result.syntheticCount, 70);
    assert.ok(
      result.enrolled.slice(0, 30).every(Boolean),
      "every coned descriptor should read as enrolled",
    );
    assert.ok(
      result.enrolled.slice(30).every((v) => v === false),
      "every random descriptor should read as filler",
    );
    assert.ok(result.splitAt > 0.3 && result.splitAt < 0.8, `split ${result.splitAt} should land in the gap`);
  });

  test("treats a gallery of real embeddings as fully enrolled", () => {
    const descriptors = Array.from({ length: 60 }, (_, i) => conedUnit(128, i + 1));
    const result = classifyGalleryDescriptors(descriptors);
    assert.equal(result.syntheticCount, 0);
    assert.equal(result.splitAt, null);
    assert.ok(result.enrolled.every(Boolean));
  });

  test("treats a gallery with no shared direction as fully enrolled rather than all filler", () => {
    const descriptors = Array.from({ length: 60 }, (_, i) => pseudoRandomUnit(128, i + 1));
    const result = classifyGalleryDescriptors(descriptors);
    assert.equal(result.syntheticCount, 0);
    assert.equal(result.splitAt, null);
  });

  test("handles an empty gallery", () => {
    assert.deepEqual(classifyGalleryDescriptors([]), {
      enrolled: [],
      syntheticCount: 0,
      splitAt: null,
      alignment: [],
    });
  });
});

describe("summaries", () => {
  const records = [
    { source: "root-jpg", enrollmentRelation: "enrolled photo", detected: true, isTop1: true, isTop5: true, groundTruthEnrolled: true },
    { source: "root-jpg", enrollmentRelation: "enrolled photo", detected: true, isTop1: false, isTop5: true, groundTruthEnrolled: true },
    { source: "thumb-192", enrollmentRelation: "enrolled photo (downscaled)", detected: true, isTop1: false, isTop5: false, groundTruthEnrolled: false },
    { source: "thumb-192", enrollmentRelation: "enrolled photo (downscaled)", detected: false, isTop1: false, isTop5: false, groundTruthEnrolled: false },
  ];

  test("summarizeBySource reports per-rendition accuracy and keeps the enrollment relation", () => {
    const bySource = summarizeBySource(records);
    assert.equal(bySource["root-jpg"].totalProbes, 2);
    assert.equal(bySource["root-jpg"].top1AccuracyPct, 50);
    assert.equal(bySource["root-jpg"].top5AccuracyPct, 100);
    assert.equal(bySource["root-jpg"].enrollmentRelation, "enrolled photo");
    assert.equal(bySource["thumb-192"].detectionRatePct, 50);
    assert.equal(bySource["thumb-192"].enrollmentRelation, "enrolled photo (downscaled)");
  });

  test("summarizeByEnrollment keeps never-enrolled identities out of the headline number", () => {
    const cohorts = summarizeByEnrollment(records);
    assert.equal(cohorts.enrolled.totalProbes, 2);
    assert.equal(cohorts.enrolled.top1AccuracyPct, 50);
    assert.equal(cohorts.unenrolled.totalProbes, 2);
    assert.equal(cohorts.unenrolled.top1AccuracyPct, 0);
  });

  test("summarizeByEnrollment treats a missing flag as enrolled so old records still summarize", () => {
    const cohorts = summarizeByEnrollment([{ detected: true, isTop1: true, isTop5: true }]);
    assert.equal(cohorts.enrolled.totalProbes, 1);
    assert.equal(cohorts.unenrolled, undefined);
  });
});
