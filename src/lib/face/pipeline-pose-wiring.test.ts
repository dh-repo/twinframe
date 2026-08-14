import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateHeadPose68, getPoseAdaptiveLandmarkWeight } from "./pose.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";
import type { CelebrityEmbedding } from "./embeddings.ts";
import type { FaceFeatures } from "./types.ts";

/** Minimal frontal 68-pt landmarks (percentage space). */
function frontalLandmarks68(): Array<{ x: number; y: number }> {
  const pts = new Array(68).fill(0).map(() => ({ x: 50, y: 50 }));
  pts[36] = { x: 35, y: 40 };
  pts[39] = { x: 42, y: 40 };
  pts[42] = { x: 58, y: 40 };
  pts[45] = { x: 65, y: 40 };
  pts[30] = { x: 50, y: 55 };
  pts[27] = { x: 50, y: 42 };
  pts[8] = { x: 50, y: 80 };
  return pts;
}

function featuresStub(): FaceFeatures {
  return {
    faceAspect: 0.7,
    jawWidth: 0.5,
    chinSharpness: 0.5,
    foreheadHeight: 0.5,
    eyeSpacing: 0.5,
    eyeOpenness: 0.5,
    eyeSlant: 0.5,
    browHeight: 0.5,
    noseLength: 0.5,
    noseWidth: 0.5,
    mouthWidth: 0.5,
    lipFullness: 0.5,
    cheekboneProminence: 0.5,
    faceRoundness: 0.5,
    skinL: 0.5,
    skinA: 0.5,
    skinB: 0.5,
    hairL: 0.5,
    hairA: 0.5,
    hairB: 0.5,
    masculine: 0.4,
    feminine: 0.6,
    youthfulness: 0.5,
  };
}

describe("Production pose wiring (pipeline contract)", () => {
  it("estimateHeadPose68 + rankByDescriptor path matches analyzeFaceSource wiring", () => {
    const landmarks = frontalLandmarks68();
    const headPose = estimateHeadPose68(landmarks);
    assert.ok(Math.abs(headPose.yawDeg) < 15, "Frontal landmarks should yield small yaw");

    const w = getPoseAdaptiveLandmarkWeight(headPose, 0.10);
    assert.ok(w >= 0.09, `Frontal geom weight should be near 0.10 (got ${w})`);

    const desc = new Float32Array(128).fill(0.05);
    desc[0] = 1;
    const gallery: CelebrityEmbedding[] = [
      {
        id: "a",
        name: "A",
        path: "/a.jpg",
        descriptor: Array.from(desc),
        age: 30,
        gender: "female",
        genderProb: 0.9,
        features: featuresStub(),
      },
    ];

    // Same construction as pipeline.ts after detectAndDescribe
    const query: UserFaceQuery = {
      descriptor: desc,
      age: 30,
      gender: "female",
      genderProbability: 0.9,
      features: featuresStub(),
      headPose,
    };
    const matches = rankByDescriptor(query, gallery, 1);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.celebrityId, "a");
    assert.ok(Number.isFinite(matches[0]!.matchPercent));
  });
});
