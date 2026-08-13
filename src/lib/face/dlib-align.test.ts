import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dlibAlignBoxFromLandmarks,
  extractRegionToCanvas,
  createHorizontalFlipCanvas,
  FACENET_EMBED_SIZE,
} from "./faceapi-engine.ts";
import { createTestCanvas } from "./synthetic-fixtures.ts";

describe("Dlib FaceNet alignment helpers", () => {
  it("returns null when landmarks have no align()", () => {
    assert.equal(dlibAlignBoxFromLandmarks(null), null);
    assert.equal(dlibAlignBoxFromLandmarks({}), null);
    assert.equal(dlibAlignBoxFromLandmarks({ positions: [] }), null);
  });

  it("reads useDlibAlignment box from face-api landmarks.align()", () => {
    const landmarks = {
      align(_det: null, opts: { useDlibAlignment?: boolean }) {
        assert.equal(opts.useDlibAlignment, true);
        return { x: 40, y: 30, width: 120, height: 120 };
      },
    };
    const box = dlibAlignBoxFromLandmarks(landmarks);
    assert.deepEqual(box, { x: 40, y: 30, width: 120, height: 120 });
  });

  it("rejects tiny or non-finite align boxes", () => {
    assert.equal(
      dlibAlignBoxFromLandmarks({
        align: () => ({ x: 0, y: 0, width: 4, height: 4 }),
      }),
      null,
    );
    assert.equal(
      dlibAlignBoxFromLandmarks({
        align: () => ({ x: Number.NaN, y: 0, width: 80, height: 80 }),
      }),
      null,
    );
  });

  it("extracts an aligned region to FaceNet 150×150", () => {
    const src = createTestCanvas(320, 320) as HTMLCanvasElement;
    const ctx = src.getContext("2d");
    assert.ok(ctx);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(80, 60, 140, 140);
    const out = extractRegionToCanvas(
      src,
      { x: 80, y: 60, width: 140, height: 140 },
      320,
      320,
    );
    assert.equal(out.width, FACENET_EMBED_SIZE);
    assert.equal(out.height, FACENET_EMBED_SIZE);
    const sample = out.getContext("2d")!.getImageData(75, 75, 1, 1).data;
    assert.ok(sample[1]! > 200, "aligned crop should keep the green patch");
  });

  it("TTA flip of a 150 embed canvas stays 150×150 and mirrors content", () => {
    const src = createTestCanvas(150, 150) as HTMLCanvasElement;
    const ctx = src.getContext("2d");
    assert.ok(ctx);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 20, 20);
    const flip = createHorizontalFlipCanvas(src);
    assert.equal(flip.width, 150);
    assert.equal(flip.height, 150);
    const tr = flip.getContext("2d")!.getImageData(140, 5, 1, 1).data;
    assert.ok(tr[0]! > 200, "red marker must move to the top-right");
  });
});
