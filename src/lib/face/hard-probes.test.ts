import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HARD_PROBE_CONDITIONS,
  classifyHardProbe,
  hardProbeLabel,
  isHardProbeCondition,
} from "./hard-probes.ts";

describe("classifyHardProbe", () => {
  it("returns nothing for an easy frontal portrait", () => {
    assert.deepEqual(
      classifyHardProbe({
        meanLuma: 0.62,
        yawDeg: 4,
        smileIntensity: 0.1,
        faceCoverage: 0.18,
        glasses: false,
      }),
      [],
    );
  });

  it("flags each condition from its own signal", () => {
    assert.deepEqual(classifyHardProbe({ meanLuma: 0.2 }), ["low-light"]);
    assert.deepEqual(classifyHardProbe({ glasses: true }), ["glasses"]);
    assert.deepEqual(classifyHardProbe({ smileIntensity: 0.8 }), ["big-smile"]);
    assert.deepEqual(classifyHardProbe({ yawDeg: -33 }), ["yaw-gt-25"]);
    assert.deepEqual(classifyHardProbe({ faceCoverage: 0.55 }), ["phone-closeup"]);
  });

  it("reports every condition a probe satisfies at once", () => {
    const conditions = classifyHardProbe({
      meanLuma: 0.22,
      yawDeg: 40,
      smileIntensity: 0.9,
      faceCoverage: 0.5,
      glasses: true,
    });
    assert.equal(conditions.length, 5);
    for (const c of HARD_PROBE_CONDITIONS) assert.ok(conditions.includes(c));
  });

  it("ignores missing and non-finite signals", () => {
    assert.deepEqual(classifyHardProbe({}), []);
    assert.deepEqual(classifyHardProbe({ yawDeg: Number.NaN, meanLuma: Number.NaN }), []);
  });

  it("treats yaw exactly at the threshold as easy", () => {
    assert.deepEqual(classifyHardProbe({ yawDeg: 25 }), []);
    assert.deepEqual(classifyHardProbe({ yawDeg: 25.1 }), ["yaw-gt-25"]);
  });
});

describe("hard probe metadata", () => {
  it("labels every condition and validates ids", () => {
    for (const c of HARD_PROBE_CONDITIONS) {
      assert.ok(hardProbeLabel(c).length > 0);
      assert.ok(isHardProbeCondition(c));
    }
    assert.equal(isHardProbeCondition("sunglasses"), false);
  });
});
