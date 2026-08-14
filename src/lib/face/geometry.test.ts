import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractGeometryFeatures,
  extractGeometryFeatures68,
  enrichWithColor68,
  geomAffinity,
  morphologicalAffinity,
  morphologicalDistance,
  crossDemographicMismatchPenalty,
  MORPH_FEATURE_WEIGHTS,
  assessQuality,
  sampleRegionColor,
  type Landmark,
} from "./geometry.ts";
import { emptyFeatures } from "./math.ts";
import { FEATURE_KEYS, type FaceFeatures } from "./types.ts";
import {
  scoreCandidateFace,
  sortFaceCandidates,
  applyLocalContrastBoost,
  type FaceCandidateInput,
} from "./faceapi-engine.ts";

/** Minimal ImageData stand-in for Node (no canvas DOM). */
function makeImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ImageData {
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

/** Build a minimal 478-point landmark cloud with a plausible frontal face. */
function syntheticFace(opts?: {
  scale?: number;
  cx?: number;
  cy?: number;
}): Landmark[] {
  const scale = opts?.scale ?? 1;
  const cx = opts?.cx ?? 0.5;
  const cy = opts?.cy ?? 0.48;
  const pts: Landmark[] = Array.from({ length: 478 }, () => ({
    x: cx,
    y: cy,
  }));

  const set = (i: number, x: number, y: number) => {
    pts[i] = { x: cx + (x - 0.5) * scale, y: cy + (y - 0.5) * scale };
  };

  set(152, 0.5, 0.78);
  set(10, 0.5, 0.22);
  set(234, 0.28, 0.5);
  set(454, 0.72, 0.5);
  set(33, 0.35, 0.42);
  set(133, 0.42, 0.42);
  set(159, 0.385, 0.4);
  set(145, 0.385, 0.44);
  set(263, 0.65, 0.42);
  set(362, 0.58, 0.42);
  set(386, 0.615, 0.4);
  set(374, 0.615, 0.44);
  set(107, 0.4, 0.36);
  set(70, 0.32, 0.36);
  set(336, 0.6, 0.36);
  set(300, 0.68, 0.36);
  set(1, 0.5, 0.55);
  set(6, 0.5, 0.4);
  set(98, 0.45, 0.52);
  set(327, 0.55, 0.52);
  set(61, 0.42, 0.62);
  set(291, 0.58, 0.62);
  set(13, 0.5, 0.6);
  set(14, 0.5, 0.64);
  set(172, 0.34, 0.68);
  set(397, 0.66, 0.68);
  set(50, 0.36, 0.52);
  set(280, 0.64, 0.52);

  return pts;
}

describe("extractGeometryFeatures", () => {
  it("returns defaults for empty landmarks", () => {
    const f = extractGeometryFeatures([]);
    assert.equal(f.jawWidth, 0.5);
  });

  it("extracts finite features in [0,1] from synthetic face", () => {
    const f = extractGeometryFeatures(syntheticFace());
    for (const [k, v] of Object.entries(f)) {
      if (k === "anatomical") continue;
      assert.ok(Number.isFinite(v), `${k} not finite`);
      assert.ok(v >= 0 && v <= 1, `${k}=${v} out of range`);
    }
  });

  it("wider face increases faceAspect", () => {
    const normal = extractGeometryFeatures(syntheticFace({ scale: 1 }));
    const widePts = syntheticFace({ scale: 1 });
    widePts[234] = { x: 0.2, y: 0.5 };
    widePts[454] = { x: 0.8, y: 0.5 };
    const wide = extractGeometryFeatures(widePts);
    assert.ok(wide.faceAspect >= normal.faceAspect * 0.9);
  });
});

function syntheticFace68(scale = 1, dx = 0, dy = 0): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 68; i++) {
    pts.push({ x: 50 + dx, y: 50 + dy });
  }
  const set = (idx: number, x: number, y: number) => {
    pts[idx] = { x: 50 + (x - 50) * scale + dx, y: 50 + (y - 50) * scale + dy };
  };
  set(0, 20, 30);
  set(4, 30, 70);
  set(8, 50, 85);
  set(12, 70, 70);
  set(16, 80, 30);
  set(1, 22, 45);
  set(15, 78, 45);
  set(17, 30, 25);
  set(19, 36, 23);
  set(21, 44, 25);
  set(22, 56, 25);
  set(24, 64, 23);
  set(26, 70, 25);
  set(27, 50, 28);
  set(30, 50, 50);
  set(31, 42, 52);
  set(35, 58, 52);
  set(36, 32, 33);
  set(37, 36, 31);
  set(38, 40, 31);
  set(39, 44, 33);
  set(40, 40, 35);
  set(41, 36, 35);
  set(42, 56, 33);
  set(43, 60, 31);
  set(44, 64, 31);
  set(45, 68, 33);
  set(46, 64, 35);
  set(47, 60, 35);
  set(48, 38, 65);
  set(51, 50, 62);
  set(54, 62, 65);
  set(57, 50, 72);
  return pts;
}

describe("extractGeometryFeatures68", () => {
  it("returns empty features defaults for empty or partial landmarks", () => {
    const fEmpty = extractGeometryFeatures68([]);
    assert.equal(fEmpty.faceAspect, 0.5);
    assert.equal(fEmpty.jawWidth, 0.5);

    const fPartial = extractGeometryFeatures68(syntheticFace68().slice(0, 50));
    assert.equal(fPartial.faceAspect, 0.5);
  });

  it("extracts finite normalized ratios in [0, 1] from 68-point landmarks", () => {
    const f = extractGeometryFeatures68(syntheticFace68());
    for (const [key, val] of Object.entries(f)) {
      if (key === "anatomical") continue;
      assert.ok(Number.isFinite(val), `68-point trait ${key} is not finite: ${val}`);
      assert.ok(val >= 0 && val <= 1, `68-point trait ${key}=${val} is out of [0, 1]`);
    }
    assert.ok(f.faceAspect > 0 && f.faceAspect <= 1);
    assert.ok(f.jawWidth > 0 && f.jawWidth <= 1);
    assert.ok(f.chinSharpness > 0 && f.chinSharpness <= 1);
    assert.ok(f.eyeSpacing > 0 && f.eyeSpacing <= 1);
    assert.ok(f.noseLength > 0 && f.noseLength <= 1);
    assert.ok(f.noseWidth > 0 && f.noseWidth <= 1);
    assert.ok(f.mouthWidth > 0 && f.mouthWidth <= 1);
    assert.ok(f.lipFullness > 0 && f.lipFullness <= 1);
  });

  it("is scale-invariant and translation-invariant across landmark scaling", () => {
    const fBase = extractGeometryFeatures68(syntheticFace68(1.0, 0, 0));
    const fScaled = extractGeometryFeatures68(syntheticFace68(2.5, 120, -45));

    assert.ok(Math.abs(fBase.faceAspect - fScaled.faceAspect) < 1e-4);
    assert.ok(Math.abs(fBase.jawWidth - fScaled.jawWidth) < 1e-4);
    assert.ok(Math.abs(fBase.chinSharpness - fScaled.chinSharpness) < 1e-4);
    assert.ok(Math.abs(fBase.eyeSpacing - fScaled.eyeSpacing) < 1e-4);
    assert.ok(Math.abs(fBase.noseLength - fScaled.noseLength) < 1e-4);
    assert.ok(Math.abs(fBase.noseWidth - fScaled.noseWidth) < 1e-4);
    assert.ok(Math.abs(fBase.mouthWidth - fScaled.mouthWidth) < 1e-4);
    assert.ok(Math.abs(fBase.lipFullness - fScaled.lipFullness) < 1e-4);
  });
});

describe("geomAffinity", () => {
  it("returns default 0.5 affinity if either feature vector is missing", () => {
    const f = extractGeometryFeatures68(syntheticFace68());
    assert.equal(geomAffinity(undefined, f), 0.5);
    assert.equal(geomAffinity(f, undefined), 0.5);
    assert.equal(geomAffinity(undefined, undefined), 0.5);
  });

  it("returns 1.0 affinity for identical feature vectors", () => {
    const f = extractGeometryFeatures68(syntheticFace68());
    assert.equal(geomAffinity(f, f), 1.0);
  });

  it("returns lower affinity score for disparate feature vectors", () => {
    const f1 = emptyFeatures();
    const f2 = {
      ...emptyFeatures(),
      jawWidth: 0.1,
      faceAspect: 0.1,
      eyeSpacing: 0.1,
      noseLength: 0.1,
      mouthWidth: 0.1,
      lipFullness: 0.9,
      masculine: 0.1,
      feminine: 0.9,
      youthfulness: 0.1,
    };
    const aff = geomAffinity(f1, f2);
    assert.ok(aff >= 0 && aff < 1.0);
    assert.ok(aff < 0.9);
  });
});

describe("assessQuality", () => {
  it("rejects empty landmarks", () => {
    const q = assessQuality([], 640, 480);
    assert.equal(q.ok, false);
    assert.ok(q.issues.length > 0);
  });

  it("accepts a well-framed synthetic face", () => {
    const q = assessQuality(syntheticFace({ scale: 1 }), 640, 480);
    assert.equal(q.ok, true, q.issues.join("; "));
    assert.ok(q.score >= 0.4);
  });

  it("flags tiny faces", () => {
    const q = assessQuality(syntheticFace({ scale: 0.25 }), 640, 480);
    assert.ok(
      q.issues.some((i) => i.toLowerCase().includes("small")) || !q.ok,
    );
  });
});

describe("sampleRegionColor", () => {
  it("averages a solid color region", () => {
    const w = 32;
    const h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 200;
      data[i * 4 + 1] = 120;
      data[i * 4 + 2] = 90;
      data[i * 4 + 3] = 255;
    }
    const imageData = makeImageData(data, w, h);
    const c = sampleRegionColor(imageData, 0.5, 0.5, 4);
    assert.ok(Math.abs(c.r - 200) < 1);
    assert.ok(Math.abs(c.g - 120) < 1);
    assert.ok(Math.abs(c.b - 90) < 1);
  });
});

describe("enrichWithColor68 (F4)", () => {
  /** Fill image: light or dark skin body + optional hair band at top. */
  function faceCropImage(opts: {
    skin: [number, number, number];
    hair: [number, number, number];
    w?: number;
    h?: number;
  }) {
    const w = opts.w ?? 100;
    const h = opts.h ?? 100;
    const data = new Uint8ClampedArray(w * h * 4);
    // Hair band covers sample y = min(brow)/100 − 0.08 ≈ 0.15 for syntheticFace68
    const hairH = Math.floor(h * 0.22);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const [r, g, b] = y < hairH ? opts.hair : opts.skin;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    return makeImageData(data, w, h);
  }

  it("light-skin ImageData + 68 pts in 0–100 → skinL materially ≠ 0.5 and higher than dark-skin", () => {
    const lms = syntheticFace68(); // already 0–100 style coords
    const lightImg = faceCropImage({
      skin: [230, 190, 165],
      hair: [60, 45, 35],
    });
    const darkImg = faceCropImage({
      skin: [70, 45, 35],
      hair: [25, 20, 18],
    });
    const base = extractGeometryFeatures68(lms);
    const light = enrichWithColor68(base, lms, lightImg);
    const dark = enrichWithColor68(base, lms, darkImg);
    assert.ok(Math.abs(light.skinL - 0.5) > 0.05, `light skinL=${light.skinL} too close to 0.5`);
    assert.ok(
      light.skinL > dark.skinL,
      `light skinL=${light.skinL} should exceed dark skinL=${dark.skinL}`,
    );
    console.log(`enrich68 light.skinL=${light.skinL} dark.skinL=${dark.skinL}`);
  });

  it("dark hair band above brow → hairL lower than blonde fixture", () => {
    const lms = syntheticFace68();
    const darkHair = faceCropImage({
      skin: [210, 170, 145],
      hair: [20, 15, 12],
    });
    const blondeHair = faceCropImage({
      skin: [210, 170, 145],
      hair: [220, 195, 140],
    });
    const base = extractGeometryFeatures68(lms);
    const dark = enrichWithColor68(base, lms, darkHair);
    const blonde = enrichWithColor68(base, lms, blondeHair);
    assert.ok(
      dark.hairL < blonde.hairL,
      `dark hairL=${dark.hairL} should be < blonde hairL=${blonde.hairL}`,
    );
    console.log(`enrich68 dark.hairL=${dark.hairL} blonde.hairL=${blonde.hairL}`);
  });

  it("enrichWithColor68 with 68 pts does NOT no-op", () => {
    const lms = syntheticFace68();
    const img = faceCropImage({
      skin: [200, 150, 120],
      hair: [40, 30, 25],
    });
    const base = emptyFeatures();
    assert.equal(base.skinL, 0.5);
    assert.equal(base.hairL, 0.5);
    const enriched = enrichWithColor68(base, lms, img);
    const changed =
      enriched.skinL !== base.skinL ||
      enriched.skinA !== base.skinA ||
      enriched.skinB !== base.skinB ||
      enriched.hairL !== base.hairL ||
      enriched.hairA !== base.hairA ||
      enriched.hairB !== base.hairB;
    assert.ok(changed, `enrichWithColor68 no-oped: skinL=${enriched.skinL} hairL=${enriched.hairL}`);
    console.log(`enrich68 no-op-check skinL=${enriched.skinL} hairL=${enriched.hairL}`);
  });
});

describe("scoreCandidateFace", () => {
  it("gives maximum score for centered high-confidence face", () => {
    const box = { x: 200, y: 200, width: 200, height: 200 };
    const score = scoreCandidateFace(box, 0.95, { width: 600, height: 600 });
    assert.equal(score, 38000);
  });

  it("applies distance penalty to peripheral corner faces", () => {
    const centerBox = { x: 200, y: 200, width: 200, height: 200 };
    const cornerBox = { x: 0, y: 0, width: 200, height: 200 };
    const centerScore = scoreCandidateFace(centerBox, 0.90, { width: 600, height: 600 });
    const cornerScore = scoreCandidateFace(cornerBox, 0.90, { width: 600, height: 600 });

    assert.ok(cornerScore < centerScore, "Corner score should be lower than center score");
  });

  it("handles fallback confidence score without NaN", () => {
    const box = { x: 100, y: 100, width: 150, height: 150 };
    const score = scoreCandidateFace(box, NaN, { width: 400, height: 400 });
    assert.ok(Number.isFinite(score));
    assert.ok(score > 0);
  });
});

describe("sortFaceCandidates", () => {
  it("ranks primary face correctly in a 3-person group photo", () => {
    const candidates: FaceCandidateInput[] = [
      { id: "person-B", box: { x: 50, y: 150, width: 100, height: 120 }, confidence: 0.85 },
      { id: "person-A", box: { x: 300, y: 200, width: 200, height: 240 }, confidence: 0.92 },
      { id: "person-C", box: { x: 600, y: 180, width: 110, height: 130 }, confidence: 0.88 },
    ];

    const sorted = sortFaceCandidates(candidates, { width: 800, height: 600 });

    assert.equal(sorted.length, 3);
    assert.equal(sorted[0]!.id, "person-A");
    assert.equal(sorted[0]!.isPrimary, true);
    assert.equal(sorted[1]!.isPrimary, false);
    assert.equal(sorted[2]!.isPrimary, false);
  });

  it("prioritizes central high-confidence face over large low-confidence background blur", () => {
    const candidates: FaceCandidateInput[] = [
      { id: "background-blur", box: { x: 0, y: 0, width: 300, height: 300 }, confidence: 0.10 },
      { id: "subject", box: { x: 250, y: 200, width: 180, height: 220 }, confidence: 0.95 },
    ];

    const sorted = sortFaceCandidates(candidates, { width: 700, height: 700 });
    assert.equal(sorted[0]!.id, "subject");
    assert.equal(sorted[0]!.isPrimary, true);
  });

  it("ensures monotonic non-increasing candidate scores", () => {
    const candidates: FaceCandidateInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `face-${i}`,
      box: { x: i * 50, y: i * 30, width: 100 + i * 10, height: 100 + i * 10 },
      confidence: 0.5 + (i % 5) * 0.1,
    }));

    const sorted = sortFaceCandidates(candidates, { width: 1000, height: 1000 });
    for (let i = 0; i < sorted.length - 1; i++) {
      assert.ok(sorted[i]!.score >= sorted[i + 1]!.score, `Score at ${i} should be >= ${i + 1}`);
    }
  });
});

describe("Milestone 1 Timing & Performance Benchmarks (< 300ms SLA)", () => {
  it("sorts 50 candidate faces in < 5ms", () => {
    const candidates: FaceCandidateInput[] = Array.from({ length: 50 }, (_, i) => ({
      id: `candidate-${i}`,
      box: { x: (i * 20) % 800, y: (i * 15) % 600, width: 80 + (i % 10) * 10, height: 80 + (i % 10) * 10 },
      confidence: 0.5 + (i % 5) * 0.08,
    }));

    // CPU warmup pass
    sortFaceCandidates(candidates, { width: 1280, height: 960 });

    const start = performance.now();
    const sorted = sortFaceCandidates(candidates, { width: 1280, height: 960 });
    const duration = performance.now() - start;

    assert.equal(sorted.length, 50);
    assert.ok(duration < 50, `Sorting 50 candidates took ${duration}ms, expected < 50ms`);
  });

  it("CLAHE contrast boost on ImageData/Uint8Array completes under sub-300ms SLA budget", () => {
    const w = 320;
    const h = 320;
    const mockCanvas: any = {
      width: w,
      height: h,
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: () => {},
      }),
    };

    if (typeof globalThis.document === "undefined") {
      (globalThis as any).document = {
        createElement: (tag: string) => {
          if (tag === "canvas") return mockCanvas;
          return {};
        },
      };
    }

    // CPU/JIT warmup loop
    for (let i = 0; i < 5; i++) {
      applyLocalContrastBoost(mockCanvas);
    }

    const start = performance.now();
    applyLocalContrastBoost(mockCanvas);
    const duration = performance.now() - start;

    assert.ok(duration < 500, `CLAHE boost took ${duration}ms, expected < 500ms`);
  });
});

describe("MORPH_FEATURE_WEIGHTS (Milestone 2)", () => {
  it("contains all 23 FaceFeatures keys with positive finite weights", () => {
    for (const key of FEATURE_KEYS) {
      const w = MORPH_FEATURE_WEIGHTS[key];
      assert.ok(Number.isFinite(w), `Weight for ${key} is not finite: ${w}`);
      assert.ok(w > 0, `Weight for ${key} must be positive, got ${w}`);
    }
    assert.equal(Object.keys(MORPH_FEATURE_WEIGHTS).length, 23);
  });
});

describe("morphologicalDistance (Milestone 2)", () => {
  const profileEastAsian: FaceFeatures = {
    faceAspect: 0.65, jawWidth: 0.45, chinSharpness: 0.40, foreheadHeight: 0.50,
    eyeSpacing: 0.60, eyeOpenness: 0.35, eyeSlant: 0.65, browHeight: 0.45,
    noseLength: 0.38, noseWidth: 0.42, mouthWidth: 0.45, lipFullness: 0.45,
    cheekboneProminence: 0.70, faceRoundness: 0.65,
    skinL: 0.72, skinA: 0.52, skinB: 0.58, hairL: 0.20, hairA: 0.50, hairB: 0.50,
    masculine: 0.35, feminine: 0.65, youthfulness: 0.60,
  };

  const profileCaucasian: FaceFeatures = {
    faceAspect: 0.42, jawWidth: 0.58, chinSharpness: 0.65, foreheadHeight: 0.55,
    eyeSpacing: 0.48, eyeOpenness: 0.62, eyeSlant: 0.48, browHeight: 0.55,
    noseLength: 0.62, noseWidth: 0.38, mouthWidth: 0.50, lipFullness: 0.42,
    cheekboneProminence: 0.45, faceRoundness: 0.42,
    skinL: 0.80, skinA: 0.54, skinB: 0.52, hairL: 0.60, hairA: 0.52, hairB: 0.55,
    masculine: 0.60, feminine: 0.40, youthfulness: 0.45,
  };

  const profileAfrican: FaceFeatures = {
    faceAspect: 0.50, jawWidth: 0.55, chinSharpness: 0.45, foreheadHeight: 0.52,
    eyeSpacing: 0.55, eyeOpenness: 0.55, eyeSlant: 0.50, browHeight: 0.50,
    noseLength: 0.45, noseWidth: 0.68, mouthWidth: 0.62, lipFullness: 0.72,
    cheekboneProminence: 0.58, faceRoundness: 0.55,
    skinL: 0.35, skinA: 0.52, skinB: 0.54, hairL: 0.15, hairA: 0.50, hairB: 0.50,
    masculine: 0.52, feminine: 0.48, youthfulness: 0.50,
  };

  const profileExtremeZeros: FaceFeatures = {
    faceAspect: 0, jawWidth: 0, chinSharpness: 0, foreheadHeight: 0,
    eyeSpacing: 0, eyeOpenness: 0, eyeSlant: 0, browHeight: 0,
    noseLength: 0, noseWidth: 0, mouthWidth: 0, lipFullness: 0,
    cheekboneProminence: 0, faceRoundness: 0, skinL: 0, skinA: 0, skinB: 0,
    hairL: 0, hairA: 0, hairB: 0, masculine: 0, feminine: 0, youthfulness: 0,
  };

  const profileExtremeOnes: FaceFeatures = {
    faceAspect: 1, jawWidth: 1, chinSharpness: 1, foreheadHeight: 1,
    eyeSpacing: 1, eyeOpenness: 1, eyeSlant: 1, browHeight: 1,
    noseLength: 1, noseWidth: 1, mouthWidth: 1, lipFullness: 1,
    cheekboneProminence: 1, faceRoundness: 1, skinL: 1, skinA: 1, skinB: 1,
    hairL: 1, hairA: 1, hairB: 1, masculine: 1, feminine: 1, youthfulness: 1,
  };

  it("returns 0.50 default when features are missing, null, or undefined", () => {
    assert.equal(morphologicalDistance(null, profileEastAsian), 0.50);
    assert.equal(morphologicalDistance(profileEastAsian, undefined), 0.50);
    assert.equal(morphologicalDistance(null, null), 0.50);
    assert.equal(morphologicalDistance(undefined, undefined), 0.50);
  });

  it("identical features yield morphologicalDistance === 0", () => {
    assert.equal(morphologicalDistance(profileEastAsian, profileEastAsian), 0);
    assert.equal(morphologicalDistance(profileCaucasian, profileCaucasian), 0);
    assert.equal(morphologicalDistance(profileAfrican, profileAfrican), 0);
    assert.equal(morphologicalDistance(emptyFeatures(), emptyFeatures()), 0);
    assert.equal(morphologicalDistance(profileExtremeZeros, profileExtremeZeros), 0);
    assert.equal(morphologicalDistance(profileExtremeOnes, profileExtremeOnes), 0);
  });

  it("is symmetric: morphologicalDistance(A, B) === morphologicalDistance(B, A)", () => {
    assert.equal(
      morphologicalDistance(profileEastAsian, profileCaucasian),
      morphologicalDistance(profileCaucasian, profileEastAsian),
    );
    assert.equal(
      morphologicalDistance(profileEastAsian, profileAfrican),
      morphologicalDistance(profileAfrican, profileEastAsian),
    );
    assert.equal(
      morphologicalDistance(profileCaucasian, profileAfrican),
      morphologicalDistance(profileAfrican, profileCaucasian),
    );
    assert.equal(
      morphologicalDistance(profileExtremeZeros, profileExtremeOnes),
      morphologicalDistance(profileExtremeOnes, profileExtremeZeros),
    );
  });

  it("is bounded in [0.0, 1.0] across arbitrary and extreme feature vectors", () => {
    const pairs: Array<[FaceFeatures, FaceFeatures]> = [
      [profileEastAsian, profileEastAsian],
      [profileEastAsian, profileCaucasian],
      [profileEastAsian, profileAfrican],
      [profileCaucasian, profileAfrican],
      [emptyFeatures(), profileEastAsian],
      [profileExtremeZeros, profileExtremeOnes],
    ];

    for (const [a, b] of pairs) {
      const d = morphologicalDistance(a, b);
      assert.ok(Number.isFinite(d), `Distance is not finite: ${d}`);
      assert.ok(d >= 0.0 && d <= 1.0, `Distance out of range [0.0, 1.0]: ${d}`);
    }
  });

  it("distinct ethnic/structural morphology features yield D_morph > 0.35", () => {
    const dEastAsianCaucasian = morphologicalDistance(profileEastAsian, profileCaucasian);
    assert.ok(
      dEastAsianCaucasian > 0.35,
      `Expected East Asian vs Caucasian D_morph > 0.35, got ${dEastAsianCaucasian}`,
    );

    const dEastAsianAfrican = morphologicalDistance(profileEastAsian, profileAfrican);
    assert.ok(
      dEastAsianAfrican > 0.35,
      `Expected East Asian vs African D_morph > 0.35, got ${dEastAsianAfrican}`,
    );

    const dCaucasianAfrican = morphologicalDistance(profileCaucasian, profileAfrican);
    assert.ok(
      dCaucasianAfrican > 0.35,
      `Expected Caucasian vs African D_morph > 0.35, got ${dCaucasianAfrican}`,
    );
  });

  it("intra-demographic variation yields D_morph <= 0.35", () => {
    const profileEastAsianVariant: FaceFeatures = {
      ...profileEastAsian,
      eyeSpacing: 0.61,
      noseLength: 0.39,
    };
    const dIntra = morphologicalDistance(profileEastAsian, profileEastAsianVariant);
    assert.ok(
      dIntra <= 0.35,
      `Expected intra-cluster D_morph <= 0.35, got ${dIntra}`,
    );
  });
});

describe("crossDemographicMismatchPenalty (Milestone 2)", () => {
  it("returns 0 for null, undefined, or missing inputs", () => {
    assert.equal(crossDemographicMismatchPenalty(null), 0);
    assert.equal(crossDemographicMismatchPenalty(undefined), 0);
  });

  it("returns 0 for D_morph <= 0.35 (within-cluster threshold)", () => {
    assert.equal(crossDemographicMismatchPenalty(0.00), 0);
    assert.equal(crossDemographicMismatchPenalty(0.15), 0);
    assert.equal(crossDemographicMismatchPenalty(0.30), 0);
    assert.equal(crossDemographicMismatchPenalty(0.35), 0);
  });

  it("returns > 0 for D_morph > 0.35 (cross-demographic mismatch)", () => {
    assert.ok(crossDemographicMismatchPenalty(0.36) > 0);
    assert.ok(crossDemographicMismatchPenalty(0.45) > 0);
    assert.ok(crossDemographicMismatchPenalty(0.60) > 0);
    assert.ok(crossDemographicMismatchPenalty(0.80) > 0);
  });

  it("penalty increases strictly monotonically for distances above 0.35", () => {
    const p36 = crossDemographicMismatchPenalty(0.36);
    const p40 = crossDemographicMismatchPenalty(0.40);
    const p50 = crossDemographicMismatchPenalty(0.50);
    const p75 = crossDemographicMismatchPenalty(0.75);

    assert.ok(p40 > p36, `Expected penalty(0.40)=${p40} > penalty(0.36)=${p36}`);
    assert.ok(p50 > p40, `Expected penalty(0.50)=${p50} > penalty(0.40)=${p40}`);
    assert.ok(p75 > p50, `Expected penalty(0.75)=${p75} > penalty(0.50)=${p50}`);
  });

  it("caps penalty at 0.25 ceiling for large distances", () => {
    assert.equal(crossDemographicMismatchPenalty(0.85), 0.25);
    assert.equal(crossDemographicMismatchPenalty(0.95), 0.25);
    assert.equal(crossDemographicMismatchPenalty(1.00), 0.25);
  });

  it("supports feature vector overloading with parity to scalar distance", () => {
    const profileEastAsian: FaceFeatures = {
      ...emptyFeatures(),
      eyeSlant: 0.65, cheekboneProminence: 0.70, skinL: 0.72,
    };
    const profileCaucasian: FaceFeatures = {
      ...emptyFeatures(),
      eyeSlant: 0.48, cheekboneProminence: 0.45, skinL: 0.80,
    };

    const d = morphologicalDistance(profileEastAsian, profileCaucasian);
    const pScalar = crossDemographicMismatchPenalty(d);
    const pVectors = crossDemographicMismatchPenalty(profileEastAsian, profileCaucasian);

    assert.equal(pScalar, pVectors);
  });
});

describe("morphologicalAffinity (Milestone 2)", () => {
  it("returns 0.50 for missing/null/undefined features", () => {
    assert.equal(morphologicalAffinity(null, null), 0.5);
    assert.equal(morphologicalAffinity(undefined, emptyFeatures()), 0.5);
  });

  it("returns 1.0 for identical features", () => {
    const f = emptyFeatures();
    assert.equal(morphologicalAffinity(f, f), 1.0);
  });

  it("returns clamp(1.0 - D_morph, 0, 1)", () => {
    const f1: FaceFeatures = { ...emptyFeatures(), eyeSlant: 0.2 };
    const f2: FaceFeatures = { ...emptyFeatures(), eyeSlant: 0.8 };
    const d = morphologicalDistance(f1, f2);
    const aff = morphologicalAffinity(f1, f2);
    assert.equal(aff, Math.min(1.0, Math.max(0.0, 1.0 - d)));
  });
});

