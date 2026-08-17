import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_CLONE_MAX,
  AUDIT_IDENTITY_MAX,
  AUDIT_LOOKALIKE_MAX,
  classifyCrossIdPair,
  collectCrossIdPairs,
  demotionIds,
  findSuspectVectors,
  minCrossIdDistance,
  pairBandLabel,
  type GalleryAuditRow,
} from "./gallery-audit.ts";

function axis(index: number, dim = 256): Float32Array {
  const v = new Float32Array(dim);
  v[index] = 1;
  return v;
}

function atCosineDistance(distance: number, dim = 256): Float32Array {
  const v = new Float32Array(dim);
  const cos = 1 - distance;
  v[0] = cos;
  v[1] = Math.sqrt(Math.max(0, 1 - cos * cos));
  return v;
}

describe("classifyCrossIdPair", () => {
  it("splits clone / identity-range / look-alike-range / far", () => {
    assert.equal(classifyCrossIdPair(0), "clone");
    assert.equal(classifyCrossIdPair(AUDIT_CLONE_MAX / 2), "clone");
    assert.equal(classifyCrossIdPair(AUDIT_CLONE_MAX), "identity-range");
    assert.equal(classifyCrossIdPair(0.2), "identity-range");
    assert.equal(classifyCrossIdPair(AUDIT_IDENTITY_MAX), "identity-range");
    assert.equal(classifyCrossIdPair(0.45), "lookalike-range");
    assert.equal(classifyCrossIdPair(AUDIT_LOOKALIKE_MAX), "lookalike-range");
    assert.equal(classifyCrossIdPair(0.5), "far");
    assert.equal(classifyCrossIdPair(0.9), "far");
  });

  it("treats invalid distances as far", () => {
    assert.equal(classifyCrossIdPair(Number.NaN), "far");
    assert.equal(classifyCrossIdPair(-0.1), "far");
    assert.equal(classifyCrossIdPair(Number.POSITIVE_INFINITY), "far");
  });

  it("labels every band exhaustively", () => {
    assert.match(pairBandLabel("clone"), /clone/i);
    assert.match(pairBandLabel("identity-range"), /identity/i);
    assert.match(pairBandLabel("lookalike-range"), /look-alike/i);
    assert.equal(pairBandLabel("far"), "far");
  });
});

describe("collectCrossIdPairs", () => {
  it("uses the closest templates across two ids", () => {
    const aFar: GalleryAuditRow = { id: "a", name: "A", descriptor: axis(0) };
    const aNear: GalleryAuditRow = { id: "a", name: "A", descriptor: atCosineDistance(0.12) };
    const b: GalleryAuditRow = { id: "b", name: "B", descriptor: axis(0) };
    const d = minCrossIdDistance([aFar, aNear], [b]);
    assert.ok(d < 0.01, `expected near-zero via aFar, got ${d}`);
    const pairs = collectCrossIdPairs([aFar, aNear, b]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]?.band, "clone");
    assert.ok((pairs[0]?.distance ?? 1) < AUDIT_CLONE_MAX);
  });

  it("keeps identity-range and look-alike-range, drops far pairs", () => {
    const probe: GalleryAuditRow = { id: "probe", descriptor: axis(0) };
    const ident: GalleryAuditRow = { id: "ident", descriptor: atCosineDistance(0.2) };
    const like: GalleryAuditRow = { id: "like", descriptor: atCosineDistance(0.45) };
    const far: GalleryAuditRow = { id: "far", descriptor: atCosineDistance(0.8) };
    const pairs = collectCrossIdPairs([probe, ident, like, far]);
    const bandOf = (id: string) =>
      pairs.find((p) => (p.a === "probe" && p.b === id) || (p.a === id && p.b === "probe"))?.band;
    assert.equal(bandOf("ident"), "identity-range");
    assert.equal(bandOf("like"), "lookalike-range");
    assert.equal(bandOf("far"), undefined);
  });

  it("demotes clone and identity-range ids, not look-alike crowding", () => {
    const pairs = collectCrossIdPairs([
      { id: "probe", descriptor: axis(0) },
      { id: "clone", descriptor: axis(0) },
      { id: "like", descriptor: atCosineDistance(0.45) },
    ]);
    const ids = demotionIds(pairs, []);
    assert.ok(ids.includes("probe"));
    assert.ok(ids.includes("clone"));
    assert.ok(!ids.includes("like"));
  });
});

describe("findSuspectVectors", () => {
  it("flags padded FaceNet and empty descriptors", () => {
    const padded = new Float32Array(256);
    for (let i = 0; i < 64; i++) padded[i] = 0.1;
    const suspects = findSuspectVectors([
      { id: "pad", name: "Pad", descriptor: padded },
      { id: "empty", descriptor: new Float32Array(0) },
    ]);
    assert.ok(suspects.some((s) => s.id === "pad" && s.reason === "padded-facenet"));
    assert.ok(suspects.some((s) => s.id === "empty" && s.reason === "empty-descriptor"));
  });
});
