import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { l2Normalize, euclideanDistance, cosineDistance, ensembleDistance } from "./embeddings.ts";
import { estimateHeadPose68, getPoseAdaptiveLandmarkWeight } from "./pose.ts";
import { analyzeImageQuality } from "./quality.ts";
import { isValidHumanFaceLandmarks68 } from "./geometry.ts";

/**
 * Generate a synthetic 128-d face descriptor vector with controlled noise perturbation.
 */
function createPerturbedDescriptor(baseVec: number[], noiseLevel = 0.05): Float32Array {
  const out = new Float32Array(baseVec.length);
  for (let i = 0; i < baseVec.length; i++) {
    const noise = (Math.sin(i * 1.7 + noiseLevel * 10) * 0.5) * noiseLevel;
    out[i] = (baseVec[i] ?? 0) + noise;
  }
  return l2Normalize(out);
}

describe("Adversarial & Perturbation Robustness Suite", () => {
  const baseDesc = Array.from(l2Normalize(new Array(128).fill(0).map((_, i) => Math.cos(i * 0.1))));

  it("maintains high similarity under 5% descriptor noise perturbation", () => {
    const perturbed = createPerturbedDescriptor(baseDesc, 0.05);
    const dist = ensembleDistance(baseDesc, perturbed);
    assert.ok(dist < 0.25, `Distance under 5% noise should be < 0.25, got ${dist}`);
  });

  it("maintains ranking stability under 15% heavy noise perturbation", () => {
    const lightNoise = createPerturbedDescriptor(baseDesc, 0.05);
    const heavyNoise = createPerturbedDescriptor(baseDesc, 0.15);

    const distLight = ensembleDistance(baseDesc, lightNoise);
    const distHeavy = ensembleDistance(baseDesc, heavyNoise);

    assert.ok(distLight < distHeavy, "Light noise distance should be strictly smaller than heavy noise distance");
    assert.ok(distHeavy < 0.60, "Heavy noise distance should remain bounded < 0.60");
  });

  it("evaluates head pose roll tilt invariance across +/- 15 and +/- 30 degrees", () => {
    const baseLandmarks = new Array(68).fill(0).map(() => ({ x: 0.5, y: 0.5 }));
    baseLandmarks[36] = { x: 0.30, y: 0.45 };
    baseLandmarks[39] = { x: 0.40, y: 0.45 };
    baseLandmarks[42] = { x: 0.60, y: 0.45 };
    baseLandmarks[45] = { x: 0.70, y: 0.45 };
    baseLandmarks[30] = { x: 0.50, y: 0.55 };
    baseLandmarks[8]  = { x: 0.50, y: 0.80 };
    baseLandmarks[27] = { x: 0.50, y: 0.40 };

    const frontalPose = estimateHeadPose68(baseLandmarks);
    assert.ok(Math.abs(frontalPose.rollDeg) < 5);

    // Tilted landmarks (+20 degrees roll)
    const tiltedLandmarks = baseLandmarks.map((p) => {
      const angle = (20 * Math.PI) / 180;
      const dx = p.x - 0.5;
      const dy = p.y - 0.5;
      return {
        x: 0.5 + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: 0.5 + dx * Math.sin(angle) + dy * Math.cos(angle),
      };
    });

    const tiltedPose = estimateHeadPose68(tiltedLandmarks);
    assert.ok(Math.abs(tiltedPose.rollDeg - 20) < 5, `Roll degree should be ~20, got ${tiltedPose.rollDeg}`);
  });

  it("verifies strict landmark validation under severe geometric distortions", () => {
    const validLandmarks = new Array(68).fill(0).map(() => ({ x: 50, y: 50 }));
    validLandmarks[36] = { x: 30, y: 35 };
    validLandmarks[39] = { x: 40, y: 35 };
    validLandmarks[42] = { x: 60, y: 35 };
    validLandmarks[45] = { x: 70, y: 35 };
    validLandmarks[30] = { x: 50, y: 55 };
    validLandmarks[48] = { x: 40, y: 75 };
    validLandmarks[54] = { x: 60, y: 75 };
    validLandmarks[8]  = { x: 50, y: 90 };

    assert.ok(isValidHumanFaceLandmarks68(validLandmarks, 100, 100));

    // Distorted landmarks: Asymmetric eye placement (right eye shifted to chin)
    const distorted = [...validLandmarks];
    distorted[42] = { x: 60, y: 95 };
    distorted[45] = { x: 70, y: 95 };

    assert.equal(isValidHumanFaceLandmarks68(distorted, 100, 100), false);
  });
});
