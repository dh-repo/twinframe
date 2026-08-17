import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreEnrollmentCandidate } from "./enrollment-qa.ts";

describe("enrollment-qa", () => {
  it("accepts clean frontal references", () => {
    const r = scoreEnrollmentCandidate({
      faceCount: 1,
      faceCoverage: 0.18,
      sharpness: 64,
      illumination: 0.5,
      detConfidence: 0.92,
      yawDeg: 4,
      pitchDeg: 2,
      rollDeg: 1,
      smileIntensity: 0.1,
    });
    assert.equal(r.ok, true);
    assert.ok(r.score >= 0.55);
  });

  it("rejects multi-face / extreme pose / soft shots", () => {
    assert.equal(
      scoreEnrollmentCandidate({
        faceCount: 2,
        faceCoverage: 0.2,
        sharpness: 70,
        illumination: 0.5,
        detConfidence: 0.9,
      }).ok,
      false,
    );
    assert.equal(
      scoreEnrollmentCandidate({
        faceCount: 1,
        faceCoverage: 0.2,
        sharpness: 70,
        illumination: 0.5,
        detConfidence: 0.9,
        yawDeg: 35,
      }).ok,
      false,
    );
    assert.equal(
      scoreEnrollmentCandidate({
        faceCount: 1,
        faceCoverage: 0.2,
        sharpness: 20,
        illumination: 0.5,
        detConfidence: 0.9,
      }).ok,
      false,
    );
  });
});
