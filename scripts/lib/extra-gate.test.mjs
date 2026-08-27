import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXTRA_EVAL_NEAR_CLONE_EPS,
  EXTRA_MAX_DISTANCE,
  EXTRA_PRIMARY_NEAR_DUPLICATE_EPS,
  gateExtraCandidates,
  mergeExtraTemplates,
} from "./extra-gate.mjs";
import { l2Normalize } from "./gallery-binary.mjs";

const DIM = 16;

function unit(index) {
  const v = new Float32Array(DIM);
  v[index] = 1;
  return v;
}

/** Vector at a chosen cosine distance from `unit(0)`, in the 0/1 plane. */
function atDistance(distance) {
  const cos = 1 - distance;
  const v = new Float32Array(DIM);
  v[0] = cos;
  v[1] = Math.sqrt(Math.max(0, 1 - cos * cos));
  return Array.from(l2Normalize(v));
}

const primaries = new Map([["adele", unit(0)]]);

describe("gateExtraCandidates", () => {
  it("accepts a same-person view and rejects a wrong-person view", () => {
    const { accepted, rejected, stats } = gateExtraCandidates(
      [
        { id: "adele", source: "extra-photos/adele/002.jpg", descriptor: atDistance(0.4), score: 0.9 },
        { id: "adele", source: "extra-photos/adele/003.jpg", descriptor: atDistance(0.95), score: 0.9 },
      ],
      { primaries },
    );
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].source, "extra-photos/adele/002.jpg");
    assert.ok(Math.abs(accepted[0].distanceToPrimary - 0.4) < 1e-3);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason, "too-far-from-primary");
    assert.equal(stats.byReason["too-far-from-primary"], 1);
    assert.equal(stats.idsWithNewViews, 1);
  });

  it("gates on detection, descriptor and a known primary", () => {
    const { rejected } = gateExtraCandidates(
      [
        { id: "adele", source: "a.jpg", descriptor: atDistance(0.2), usedDetection: false },
        { id: "adele", source: "b.jpg", descriptor: atDistance(0.2), score: 0.1 },
        { id: "adele", source: "c.jpg", descriptor: [], score: 0.9 },
        { id: "nobody", source: "d.jpg", descriptor: atDistance(0.2), score: 0.9 },
      ],
      { primaries },
    );
    assert.deepEqual(
      rejected.map((r) => r.reason),
      ["no-detection", "low-detection-score", "bad-descriptor", "no-primary"],
    );
  });

  it("drops near-duplicate crops of views it already kept, including shipped ones", () => {
    const res = gateExtraCandidates(
      [
        { id: "adele", source: "a.jpg", descriptor: atDistance(0.3), score: 0.9 },
        { id: "adele", source: "b.jpg", descriptor: atDistance(0.3001), score: 0.9 },
        { id: "adele", source: "c.jpg", descriptor: atDistance(0.5), score: 0.9 },
      ],
      { primaries },
    );
    assert.deepEqual(
      res.accepted.map((a) => a.source),
      ["a.jpg", "c.jpg"],
    );
    assert.equal(res.rejected[0].reason, "near-duplicate");

    const withShipped = gateExtraCandidates(
      [{ id: "adele", source: "a.jpg", descriptor: atDistance(0.3), score: 0.9 }],
      { primaries, existingById: new Map([["adele", [atDistance(0.3)]]]) },
    );
    assert.equal(withShipped.accepted.length, 0);
    assert.equal(withShipped.rejected[0].reason, "near-duplicate");
  });

  it("rejects a near-clone of the enrolled primary", () => {
    const res = gateExtraCandidates(
      [{ id: "adele", source: "clone.jpg", descriptor: atDistance(0.01), score: 0.9 }],
      { primaries },
    );
    assert.equal(res.accepted.length, 0);
    assert.equal(res.rejected[0].reason, "near-duplicate");
    assert.ok(EXTRA_PRIMARY_NEAR_DUPLICATE_EPS > 0.01);
    const distinct = gateExtraCandidates(
      [{ id: "adele", source: "era.jpg", descriptor: atDistance(0.4), score: 0.9 }],
      { primaries },
    );
    assert.equal(distinct.accepted.length, 1);
  });

  it("rejects a near-clone of the held-out eval probe", () => {
    const probe = atDistance(0.4);
    const res = gateExtraCandidates(
      [{ id: "adele", source: "eval-crop.jpg", descriptor: atDistance(0.401), score: 0.9 }],
      { primaries, probesById: new Map([["adele", probe]]) },
    );
    assert.equal(res.accepted.length, 0);
    assert.equal(res.rejected[0].reason, "eval-near-clone");
    assert.ok(EXTRA_EVAL_NEAR_CLONE_EPS > 0.01);
    const distinct = gateExtraCandidates(
      [{ id: "adele", source: "other-era.jpg", descriptor: atDistance(0.4), score: 0.9 }],
      { primaries, probesById: new Map([["adele", unit(5)]]) },
    );
    assert.equal(distinct.accepted.length, 1);
  });

  it("honours per-id caps and a custom distance threshold", () => {
    const cand = [
      { id: "adele", source: "a.jpg", descriptor: atDistance(0.2), score: 0.9 },
      { id: "adele", source: "b.jpg", descriptor: atDistance(0.4), score: 0.9 },
      { id: "adele", source: "c.jpg", descriptor: atDistance(0.6), score: 0.9 },
    ];
    const capped = gateExtraCandidates(cand, { primaries, maxPerId: 2 });
    assert.equal(capped.accepted.length, 2);
    assert.equal(capped.rejected[0].reason, "cap-reached");

    const strict = gateExtraCandidates(cand, { primaries, maxDistance: 0.3 });
    assert.equal(strict.accepted.length, 1);
    assert.ok(EXTRA_MAX_DISTANCE > 0.3);
  });
});

describe("cluster consensus rescue", () => {
  /** Candidates agreeing with each other but not with a thumbnail-quality primary. */
  function farCluster(sources) {
    return sources.map((source, i) => ({
      id: "greta",
      source,
      score: 0.9,
      descriptor: Array.from(
        l2Normalize(
          Float32Array.from(
            Array.from({ length: DIM }, (_, k) =>
              k === 5 ? 1 : k === 6 + i ? 0.28 : 0,
            ),
          ),
        ),
      ),
    }));
  }

  const weakPrimary = new Map([["greta", unit(0)]]);

  it("accepts a consistent cluster when the primary agrees with nothing", () => {
    const res = gateExtraCandidates(farCluster(["a.jpg", "b.jpg", "c.jpg"]), {
      primaries: weakPrimary,
    });
    assert.equal(res.accepted.length, 3);
    assert.equal(res.stats.acceptedViaCluster, 3);
    assert.ok(res.accepted.every((a) => a.via === "cluster"));
    assert.ok(res.accepted[0].distanceToPrimary > EXTRA_MAX_DISTANCE);
  });

  it("needs at least three agreeing views", () => {
    const res = gateExtraCandidates(farCluster(["a.jpg", "b.jpg"]), { primaries: weakPrimary });
    assert.equal(res.accepted.length, 0);
    assert.deepEqual(res.stats.byReason, { "too-far-from-primary": 2 });
  });

  it("trusts the primary when it validates some views or shipped templates", () => {
    const mixed = [
      ...farCluster(["a.jpg", "b.jpg", "c.jpg"]),
      { id: "greta", source: "d.jpg", descriptor: atDistance(0.3), score: 0.9 },
    ];
    const withGoodPrimary = gateExtraCandidates(mixed, { primaries: weakPrimary });
    assert.deepEqual(
      withGoodPrimary.accepted.map((a) => a.source),
      ["d.jpg"],
    );

    const alreadyShipped = gateExtraCandidates(farCluster(["a.jpg", "b.jpg", "c.jpg"]), {
      primaries: weakPrimary,
      existingById: new Map([["greta", [atDistance(0.3)]]]),
    });
    assert.equal(alreadyShipped.accepted.length, 0);
  });
});

describe("mergeExtraTemplates", () => {
  it("adds new rows, replaces re-enrolled sources and never drops shipped views", () => {
    const existing = {
      templates: [
        { id: "adele", source: "held-out/adele/002.jpg", descriptor: [1, 0] },
        { id: "zendaya", source: "held-out/zendaya/002.jpg", descriptor: [0, 1] },
      ],
    };
    const merged = mergeExtraTemplates(existing, [
      { id: "adele", source: "held-out/adele/002.jpg", descriptor: [0.9, 0.1] },
      { id: "adele", source: "extra-photos/adele/003.jpg", descriptor: [0.5, 0.5] },
    ]);
    assert.equal(merged.total, 3);
    assert.equal(merged.added, 1);
    assert.equal(merged.replaced, 1);
    assert.equal(merged.ids, 2);
    assert.deepEqual(merged.templates[0].descriptor, [0.9, 0.1]);
    assert.ok(merged.templates.some((t) => t.id === "zendaya"));
  });

  it("is idempotent when the same batch is merged twice", () => {
    const incoming = [{ id: "adele", source: "extra-photos/adele/002.jpg", descriptor: [1, 0] }];
    const once = mergeExtraTemplates({ templates: [] }, incoming);
    const twice = mergeExtraTemplates({ templates: once.templates }, incoming);
    assert.equal(twice.total, 1);
    assert.equal(twice.added, 0);
  });
});
