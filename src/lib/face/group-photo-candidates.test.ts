import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidateFace, sortFaceCandidates } from "./faceapi-engine";
import { generateMultiFaceCanvas } from "./synthetic-fixtures";
import { analyzeFaceSource } from "./pipeline";

describe("R2 Multi-Person & Group Photo Candidate Precision Unit Suite", () => {
  test("scoreCandidateFace uses diagonal normalization to prevent massive off-center penalties", () => {
    const highRes = { width: 3000, height: 2000 };

    const centerBox = { x: 1350, y: 850, width: 300, height: 300 };
    const offCenterBox = { x: 200, y: 850, width: 300, height: 300 };

    const centerScore = scoreCandidateFace(centerBox, 0.90, highRes);
    const offCenterScore = scoreCandidateFace(offCenterBox, 0.90, highRes);

    assert.ok(centerScore > 0, "Center score should be positive");
    assert.ok(offCenterScore > 0, "Off-center score should be positive");

    // The score ratio (center / offCenter) should be reasonable (< 2.5x), not 150x
    const ratio = centerScore / offCenterScore;
    assert.ok(ratio < 2.5, `Off-center penalty was too extreme: ratio ${ratio} >= 2.5`);
  });

  test("sortFaceCandidates correctly ranks multi-person face boxes", () => {
    const imgSize = { width: 1200, height: 800 };
    const candidates = [
      { id: "left-small", box: { x: 100, y: 300, width: 80, height: 80 }, confidence: 0.85 },
      { id: "center-main", box: { x: 500, y: 250, width: 200, height: 200 }, confidence: 0.95 },
      { id: "right-medium", box: { x: 900, y: 300, width: 120, height: 120 }, confidence: 0.88 },
    ];

    const sorted = sortFaceCandidates(candidates, imgSize);

    assert.equal(sorted.length, 3);
    assert.equal(sorted[0]!.id, "center-main", "Main center face should rank 1st");
    assert.equal(sorted[0]!.isPrimary, true, "Rank 1 candidate must have isPrimary === true");
    assert.equal(sorted[1]!.isPrimary, false, "Rank 2 candidate must have isPrimary === false");
  });

  test("pipeline processes multi-face synthetic canvas without throwing", async () => {
    const groupCanvas = generateMultiFaceCanvas(1200, 800);
    const result = await analyzeFaceSource(groupCanvas as any);

    assert.ok(result, "Pipeline should return a result object");
    assert.ok(Array.isArray(result.matches), "Matches should be an array");
  });
});
