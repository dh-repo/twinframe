import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributeConflictLevel,
  distanceLookalikeGate,
  hardQualityRefuseGate,
  LOOKALIKE_MAX_ADJUSTED_DISTANCE,
  poseRefuseGate,
  softQualityBlockGate,
} from "./lookalike-policy.ts";

describe("lookalike-policy gates", () => {
  it("poseRefuseGate refuses extreme yaw/pitch", () => {
    assert.equal(poseRefuseGate({ yaw: 10, pitch: 5 }).pass, true);
    assert.equal(poseRefuseGate({ yaw: 41, pitch: 0 }).pass, false);
    assert.equal(poseRefuseGate({ yaw: 0, pitch: -36 }).pass, false);
    assert.equal(poseRefuseGate({ yaw: 41 }).reason, "pose");
  });

  it("hardQualityRefuseGate refuses blur / tiny faces / low confidence", () => {
    const okBase = {
      ok: true,
      score: 0.8,
      faceCoverage: 0.12,
      sharpness: 60,
      illumination: 0.5,
      confidence: 0.9,
      issues: [] as string[],
    };
    assert.equal(hardQualityRefuseGate(okBase).pass, true);
    assert.equal(
      hardQualityRefuseGate({ ...okBase, sharpness: 20 }).pass,
      false,
    );
    assert.equal(
      hardQualityRefuseGate({ ...okBase, faceCoverage: 0.01 }).pass,
      false,
    );
    assert.equal(
      hardQualityRefuseGate({ ...okBase, confidence: 0.2 }).pass,
      false,
    );
  });

  it("softQualityBlockGate blocks soft quality.ok failures", () => {
    assert.equal(
      softQualityBlockGate({
        ok: false,
        score: 0.3,
        faceCoverage: 0.1,
        sharpness: 50,
        illumination: 0.5,
        confidence: 0.8,
        issues: ["Slightly blurry"],
      }).pass,
      false,
    );
  });

  it("attributeConflictLevel is honesty-only and never infers from unknown gender", () => {
    assert.equal(
      attributeConflictLevel(
        { gender: "unknown", genderProbability: 0.99, age: 35 },
        { gender: "male", age: 30 },
      ),
      "none",
    );
    assert.equal(
      attributeConflictLevel(
        { gender: "unknown", genderProbability: 0.99, age: 70 },
        { gender: "male", age: 30 },
      ),
      "partial",
    );
    assert.equal(
      attributeConflictLevel(
        { gender: "female", genderProbability: 0.9, age: 70 },
        { gender: "male", age: 30 },
      ),
      "strong",
    );
    assert.equal(
      attributeConflictLevel(
        { gender: "female", genderProbability: 0.9, age: 70 },
        { gender: "male", age: 55 },
      ),
      "partial",
    );
    assert.equal(
      attributeConflictLevel(
        { gender: "female", genderProbability: 0.5, age: 35 },
        { gender: "male", age: 34 },
      ),
      "none",
    );
    assert.equal(
      attributeConflictLevel(
        { gender: "female", genderProbability: 0.9, age: 34 },
        { gender: "female", age: 36 },
      ),
      "none",
    );
  });

  it("distanceLookalikeGate refuses far neighbors", () => {
    assert.equal(distanceLookalikeGate(0.45, 76).pass, true);
    assert.equal(
      distanceLookalikeGate(LOOKALIKE_MAX_ADJUSTED_DISTANCE + 0.01, 20).pass,
      false,
    );
    // Percent floor refuses even when distance squeaks under the max
    assert.equal(distanceLookalikeGate(0.7, 30).pass, false);
  });
});
