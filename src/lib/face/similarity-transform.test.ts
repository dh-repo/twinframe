import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REFERENCE_LANDMARKS_112,
  REFERENCE_LANDMARKS_160,
  compute5PointSimilarityMatrix,
} from "./similarity-transform.ts";

describe("5-Point Umeyama Similarity Transformation Unit Suite", () => {
  it("defines correct InsightFace canonical reference landmarks for 112x112 and 160x160", () => {
    assert.equal(REFERENCE_LANDMARKS_112.length, 5);
    assert.equal(REFERENCE_LANDMARKS_160.length, 5);

    // Left eye ~ (38.29, 51.70), Right eye ~ (73.53, 51.50)
    assert.equal(Math.round(REFERENCE_LANDMARKS_112[0][0]), 38);
    assert.equal(Math.round(REFERENCE_LANDMARKS_112[1][0]), 74);

    // Scaling ratio 160 / 112 ~ 1.42857
    const ratio = 160 / 112;
    assert.equal(
      Math.abs(REFERENCE_LANDMARKS_160[0][0] - REFERENCE_LANDMARKS_112[0][0] * ratio) < 0.01,
      true
    );
  });

  it("recovers identity transformation matrix when source matches reference landmarks", () => {
    const { M, invM, scale, rotationRad } = compute5PointSimilarityMatrix(
      REFERENCE_LANDMARKS_112 as any,
      112
    );

    assert.equal(Math.abs(scale - 1.0) < 1e-4, true, `Expected scale ~1, got ${scale}`);
    assert.equal(Math.abs(rotationRad) < 1e-4, true, `Expected rot ~0, got ${rotationRad}`);

    // Check M ~ [[1, 0, 0], [0, 1, 0]]
    assert.equal(Math.abs(M[0][0] - 1.0) < 1e-4, true);
    assert.equal(Math.abs(M[0][1]) < 1e-4, true);
    assert.equal(Math.abs(M[0][2]) < 1e-4, true);
    assert.equal(Math.abs(M[1][0]) < 1e-4, true);
    assert.equal(Math.abs(M[1][1] - 1.0) < 1e-4, true);
    assert.equal(Math.abs(M[1][2]) < 1e-4, true);
  });

  it("recovers translation and scale when source landmarks are offset and scaled", () => {
    // Offset source by (+20, +30) and scale by 2.0
    const scaledOffsetLandmarks = REFERENCE_LANDMARKS_112.map(([x, y]) => [
      x * 2.0 + 20.0,
      y * 2.0 + 30.0,
    ]);

    const { scale, invM } = compute5PointSimilarityMatrix(scaledOffsetLandmarks, 112);

    assert.equal(Math.abs(scale - 0.5) < 1e-3, true, `Expected scale ~0.5, got ${scale}`);
    assert.equal(invM.length, 2);
  });

  it("handles degenerate / collinear landmark inputs safely without throwing or NaNs", () => {
    const degenerate = [
      [10, 10],
      [20, 10],
      [30, 10],
      [40, 10],
      [50, 10],
    ];

    const { M, invM } = compute5PointSimilarityMatrix(degenerate, 112);

    assert.equal(Number.isNaN(M[0][0]), false);
    assert.equal(Number.isNaN(invM[0][0]), false);
  });
});
