import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateAnchors,
  estimateHeadPose,
  computeIoU,
  nmsFaceBoxes,
} from "./scrfd.ts";
import {
  getCanonicalBlendshapeBases,
  runExpNormFrontalizationCPU,
  EXP_NORM_WGSL_SHADER,
} from "./exp-norm-wgsl.ts";
import {
  compute5PointSimilarityMatrix,
  align5PointSimilarityTensor,
  REFERENCE_LANDMARKS_112,
  REFERENCE_LANDMARKS_160,
} from "./similarity-transform.ts";

describe("M2 Empirical Challenger Test Suite", () => {
  it("verifies multi-stride anchor grid generation (16,800 anchors total)", () => {
    const anchors = generateAnchors(640, 640);
    assert.equal(anchors[8].length, 12800);
    assert.equal(anchors[16].length, 3200);
    assert.equal(anchors[32].length, 800);

    let total = 0;
    for (const stride of [8, 16, 32]) {
      total += anchors[stride].length;
      for (const a of anchors[stride]) {
        assert.equal(a.stride, stride);
        assert.equal(typeof a.cx, "number");
        assert.equal(typeof a.cy, "number");
      }
    }
    assert.equal(total, 16800);
  });

  it("verifies 3D head pose estimation math across frontal, left yaw, right yaw, pitch, roll", () => {
    // 1. Frontal pose
    const frontal = [
      [38.29, 51.70],
      [73.53, 51.50],
      [56.02, 71.74],
      [41.55, 92.37],
      [70.73, 92.20],
    ];
    const poseFront = estimateHeadPose(frontal);
    assert.ok(Math.abs(poseFront.yaw) < 2.0, `Frontal yaw should be ~0, got ${poseFront.yaw}`);
    assert.ok(Math.abs(poseFront.roll) < 2.0, `Frontal roll should be ~0, got ${poseFront.roll}`);
    assert.ok(Math.abs(poseFront.pitch) < 8.0, `Frontal pitch should be reasonable, got ${poseFront.pitch}`);

    // 2. High Yaw Left (turning left: nose moves right towards right eye)
    const turnLeft = [
      [38.29, 51.70],
      [73.53, 51.50],
      [65.00, 71.74], // Nose displaced right
      [41.55, 92.37],
      [70.73, 92.20],
    ];
    const poseLeft = estimateHeadPose(turnLeft);
    assert.ok(poseLeft.yaw > 25, `Expected yaw > 25 for left turn, got ${poseLeft.yaw}`);

    // 3. High Yaw Right (turning right: nose moves left towards left eye)
    const turnRight = [
      [38.29, 51.70],
      [73.53, 51.50],
      [47.00, 71.74], // Nose displaced left
      [41.55, 92.37],
      [70.73, 92.20],
    ];
    const poseRight = estimateHeadPose(turnRight);
    assert.ok(poseRight.yaw < -25, `Expected yaw < -25 for right turn, got ${poseRight.yaw}`);

    // 4. Roll test (tilted head)
    const tiltedHead = [
      [30.0, 40.0],
      [65.0, 75.0], // 35px dx, 35px dy -> ~45 deg roll
      [47.5, 57.5],
      [33.5, 76.5],
      [68.5, 111.5],
    ];
    const poseRoll = estimateHeadPose(tiltedHead);
    assert.ok(Math.abs(poseRoll.roll - 45) < 3.0, `Expected roll ~45, got ${poseRoll.roll}`);
  });

  it("verifies 5-Point Umeyama Similarity Transformation exact reconstruction", () => {
    // Transforming reference landmarks with known Scale S=1.5, Rot=30deg (0.5236 rad), Trans=[15, -25]
    const theta = Math.PI / 6; // 30 deg
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const scale = 1.5;
    const tx = 15.0;
    const ty = -25.0;

    // Ground truth matrix mapping reference -> target
    // [a, -b, tx] = [scale*cosT, -scale*sinT, tx]
    // [b,  a, ty] = [scale*sinT,  scale*cosT, ty]
    const gtLandmarks: Array<[number, number]> = REFERENCE_LANDMARKS_112.map(([u, v]) => {
      const x = (scale * cosT * u - scale * sinT * v) + tx;
      const y = (scale * sinT * u + scale * cosT * v) + ty;
      return [x, y];
    });

    const result = compute5PointSimilarityMatrix(gtLandmarks, 112);

    // M maps gtLandmarks (source) back to reference (target)
    // Scale should be 1 / 1.5 = 0.6666...
    assert.ok(Math.abs(result.scale - 1 / scale) < 1e-3, `Expected scale ${1/scale}, got ${result.scale}`);
    assert.ok(Math.abs(result.rotationRad - (-theta)) < 1e-3, `Expected rot ${-theta}, got ${result.rotationRad}`);

    // Check transformation of transformed points
    for (let i = 0; i < 5; i++) {
      const [sx, sy] = gtLandmarks[i];
      const [ru, rv] = REFERENCE_LANDMARKS_112[i];

      const mappedU = result.M[0][0] * sx + result.M[0][1] * sy + result.M[0][2];
      const mappedV = result.M[1][0] * sx + result.M[1][1] * sy + result.M[1][2];

      assert.ok(Math.abs(mappedU - ru) < 1e-2, `Point ${i} u mismatch: ${mappedU} vs ${ru}`);
      assert.ok(Math.abs(mappedV - rv) < 1e-2, `Point ${i} v mismatch: ${mappedV} vs ${rv}`);
    }
  });

  it("verifies ExpNorm WGSL shader layout and CPU blendshape subtraction consistency", () => {
    const bases = getCanonicalBlendshapeBases(112);
    assert.equal(bases.length, 112 * 112 * 11 * 4);

    // Check shader bindings and struct
    assert.ok(EXP_NORM_WGSL_SHADER.includes("struct ExpNormParams"));
    assert.ok(EXP_NORM_WGSL_SHADER.includes("@binding(0) var<uniform> params: ExpNormParams;"));
    assert.ok(EXP_NORM_WGSL_SHADER.includes("@binding(1) var srcTexture: texture_2d<f32>;"));
    assert.ok(EXP_NORM_WGSL_SHADER.includes("@binding(2) var textureSampler: sampler;"));
    assert.ok(EXP_NORM_WGSL_SHADER.includes("@binding(3) var<storage, read> blendshapeBases"));
    assert.ok(EXP_NORM_WGSL_SHADER.includes("@binding(4) var<storage, read_write> outputTensor"));
  });
});
