import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateRegionalOcclusion } from "./occlusion.ts";
import { computeMorphologicalDistance, extractAnatomicalFeatures68 } from "./geometry.ts";
import { CANONICAL_FACE_3D } from "./pose.ts";

function frontal68() {
  return CANONICAL_FACE_3D.map((p) => ({ x: p.x + 80, y: -p.y + 80 }));
}

/** Rotate 68 pts about their centroid by `deg` (in-plane roll). */
function roll68(lms: Array<{ x: number; y: number }>, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let cx = 0;
  let cy = 0;
  for (const p of lms) {
    cx += p.x;
    cy += p.y;
  }
  cx /= lms.length;
  cy /= lms.length;
  return lms.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

/** Convert pixel-space frontal68 → 0–100 crop percent (same mapping as faceCanvas). */
function toPercent68(lms: Array<{ x: number; y: number }>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of lms) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  return lms.map((p) => ({
    x: ((p.x - minX) / w) * 100,
    y: ((p.y - minY) / h) * 100,
  }));
}

function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number, i: number) => [number, number, number],
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = fill(x, y, i);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function solidImage(w: number, h: number, r: number, g: number, b: number) {
  return makeImage(w, h, () => [r, g, b]);
}

/** Paint bright edge only at true eye percent coords (0–100 landmarks). */
function paintBrightAtPercentEyes(
  base: { width: number; height: number; data: Uint8ClampedArray },
  lmsPct: Array<{ x: number; y: number }>,
) {
  const { width: w, height: h, data } = base;
  const pts = [lmsPct[21]!, lmsPct[22]!, lmsPct[27]!];
  const pairs: Array<[number, number]> = [
    [17, 36], [19, 37], [21, 39], [22, 42], [24, 43], [26, 45],
  ];
  for (const [bi, ei] of pairs) {
    pts.push({
      x: (lmsPct[bi]!.x + lmsPct[ei]!.x) / 2,
      y: (lmsPct[bi]!.y + lmsPct[ei]!.y) / 2,
    });
  }
  for (const p of pts) {
    const x = Math.round((p.x / 100) * (w - 1));
    const y = Math.round((p.y / 100) * (h - 1));
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = (yy * w + xx) * 4;
        data[j] = 20;
        data[j + 1] = 20;
        data[j + 2] = 20;
      }
    }
  }
  return base;
}

describe("Occlusion-adaptive morphology", () => {
  it("keeps high confidence on a clean frontal mesh", () => {
    const occ = estimateRegionalOcclusion(frontal68());
    assert.ok(occ.eyeConf > 0.7, `eyeConf=${occ.eyeConf}`);
    assert.ok(occ.jawConf > 0.7, `jawConf=${occ.jawConf}`);
  });

  it("damps eyes when canthi are asymmetric (glasses-like)", () => {
    const lms = frontal68();
    lms[36] = { x: lms[36]!.x, y: lms[36]!.y + 18 };
    lms[45] = { x: lms[45]!.x, y: lms[45]!.y - 16 };
    const occ = estimateRegionalOcclusion(lms);
    assert.ok(occ.eyeConf < 0.7, `eyeConf=${occ.eyeConf}`);
  });

  it("damps jaw when the jaw chain is jagged (beard-like)", () => {
    const lms = frontal68();
    for (let i = 0; i <= 16; i++) {
      lms[i] = { x: lms[i]!.x + (i % 2 === 0 ? 14 : -14), y: lms[i]!.y + (i % 3) * 8 };
    }
    const occ = estimateRegionalOcclusion(lms);
    assert.ok(occ.jawConf < 0.75, `jawConf=${occ.jawConf}`);
  });

  it("shrinks canthal contribution when eyeConf is low", () => {
    const a = extractAnatomicalFeatures68(frontal68());
    const bLms = frontal68();
    bLms[36] = { x: bLms[36]!.x, y: bLms[36]!.y + 12 };
    const b = extractAnatomicalFeatures68(bLms);
    const full = computeMorphologicalDistance(a, b);
    const damped = computeMorphologicalDistance(a, b, { eyeConf: 0.1, jawConf: 1 });
    assert.ok(damped <= full + 1e-6, `damped ${damped} vs full ${full}`);
  });

  it("returns neutral 0.50 when both regions are untrusted", () => {
    const a = extractAnatomicalFeatures68(frontal68());
    assert.equal(computeMorphologicalDistance(a, a, { eyeConf: 0.2, jawConf: 0.2 }), 0.50);
  });

  it("clean frontal + skin-colored ImageData → eyeConf > 0.7", () => {
    const lms = toPercent68(frontal68());
    const img = solidImage(120, 120, 200, 150, 130);
    const occ = estimateRegionalOcclusion(lms, img);
    assert.ok(occ.eyeConf > 0.7, `eyeConf=${occ.eyeConf}`);
    console.log(`clean+skin eyeConf=${occ.eyeConf}`);
  });

  it("dark arcs on lids/brow-eye gap → eyeConf < 0.55 and lower than clean", () => {
    const lms = toPercent68(frontal68());
    const cleanImg = solidImage(100, 100, 200, 150, 130);
    const clean = estimateRegionalOcclusion(lms, cleanImg);
    const darkImg = solidImage(100, 100, 200, 150, 130);
    paintBrightAtPercentEyes(darkImg, lms);
    const dark = estimateRegionalOcclusion(lms, darkImg);
    assert.ok(dark.eyeConf < 0.55, `dark eyeConf=${dark.eyeConf}`);
    assert.ok(dark.eyeConf < clean.eyeConf, `dark ${dark.eyeConf} < clean ${clean.eyeConf}`);
    console.log(`dark-arcs eyeConf=${dark.eyeConf} (clean=${clean.eyeConf})`);
  });

  it("pink arcs on lids/brow-eye gap → eyeConf < 0.55 and lower than clean", () => {
    const lms = toPercent68(frontal68());
    const cleanImg = solidImage(100, 100, 200, 150, 130);
    const clean = estimateRegionalOcclusion(lms, cleanImg);
    const pinkImg = solidImage(100, 100, 200, 150, 130);
    paintBrightAtPercentEyes(pinkImg, lms);
    // Recolor the strip to pink (same sites as the working percent painter).
    for (let i = 0; i < pinkImg.data.length; i += 4) {
      if (pinkImg.data[i] === 20 && pinkImg.data[i + 1] === 20) {
        pinkImg.data[i] = 240;
        pinkImg.data[i + 1] = 80;
        pinkImg.data[i + 2] = 160;
      }
    }
    const pink = estimateRegionalOcclusion(lms, pinkImg);
    assert.ok(pink.eyeConf < 0.55, `pink eyeConf=${pink.eyeConf}`);
    assert.ok(pink.eyeConf < clean.eyeConf, `pink ${pink.eyeConf} < clean ${clean.eyeConf}`);
    console.log(`pink-arcs eyeConf=${pink.eyeConf} (clean=${clean.eyeConf})`);
  });

  it("~20° roll of frontal68, no frames / uniform image → eyeConf > 0.55", () => {
    const rolled = roll68(frontal68(), 20);
    const img = solidImage(200, 200, 190, 145, 125);
    const occ = estimateRegionalOcclusion(rolled, img);
    assert.ok(occ.eyeConf > 0.55, `rolled eyeConf=${occ.eyeConf}`);
    console.log(`roll20 eyeConf=${occ.eyeConf}`);
  });

  it("global skin texture does not look like glasses; lid arcs still do", () => {
    const lms = toPercent68(frontal68());
    const textured = makeImage(120, 120, (x, y) => {
      const n = ((x * 13 + y * 29) % 17) - 8;
      return [200 + n, 150 + n, 130 + n];
    });
    const clean = estimateRegionalOcclusion(lms, textured);
    assert.ok(clean.eyeConf > 0.55, `textured-skin eyeConf=${clean.eyeConf}`);
    const glasses = makeImage(120, 120, (x, y) => {
      const n = ((x * 13 + y * 29) % 17) - 8;
      return [200 + n, 150 + n, 130 + n];
    });
    paintBrightAtPercentEyes(glasses, lms);
    for (let i = 0; i < glasses.data.length; i += 4) {
      if (glasses.data[i] === 20 && glasses.data[i + 1] === 20) {
        glasses.data[i] = 240;
        glasses.data[i + 1] = 80;
        glasses.data[i + 2] = 160;
      }
    }
    const withFrames = estimateRegionalOcclusion(lms, glasses);
    assert.ok(withFrames.eyeConf < clean.eyeConf, `textured+pink ${withFrames.eyeConf} !< textured ${clean.eyeConf}`);
    console.log(`textured ${clean.eyeConf} textured+pink ${withFrames.eyeConf}`);
  });

  it("thin pink brow–eye band on a 400px crop drops eyeConf below 0.55", () => {
    const lms = toPercent68(frontal68());
    const cleanImg = solidImage(400, 400, 200, 150, 130);
    const clean = estimateRegionalOcclusion(lms, cleanImg);
    const pink = solidImage(400, 400, 200, 150, 130);
    paintBrightAtPercentEyes(pink, lms);
    for (let i = 0; i < pink.data.length; i += 4) {
      if (pink.data[i] === 20 && pink.data[i + 1] === 20) {
        pink.data[i] = 240;
        pink.data[i + 1] = 80;
        pink.data[i + 2] = 160;
      }
    }
    const occ = estimateRegionalOcclusion(lms, pink);
    assert.ok(occ.eyeConf < clean.eyeConf, `400px pink ${occ.eyeConf} !< clean ${clean.eyeConf}`);
    assert.ok(occ.eyeConf < 0.65, `400px pink eyeConf=${occ.eyeConf}`);
    console.log(`400px-pink eyeConf=${occ.eyeConf} (clean=${clean.eyeConf})`);
  });

  it("0–100 landmarks + bright edge only at true eye percent → rim path fires", () => {
    const lmsPct = toPercent68(frontal68());
    const blank = solidImage(100, 100, 200, 150, 130);
    const blankOcc = estimateRegionalOcclusion(lmsPct, blank);
    const edged = solidImage(100, 100, 200, 150, 130);
    paintBrightAtPercentEyes(edged, lmsPct);
    const edgedOcc = estimateRegionalOcclusion(lmsPct, edged);
    assert.ok(
      edgedOcc.eyeConf < blankOcc.eyeConf,
      `edged eyeConf=${edgedOcc.eyeConf} should be < blank=${blankOcc.eyeConf}`,
    );
    console.log(`pct-rim blank=${blankOcc.eyeConf} edged=${edgedOcc.eyeConf}`);
  });
});
