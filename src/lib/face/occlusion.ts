import { dist, mid } from "./math.ts";

export interface RegionalOcclusionConfidence {
  /** 1 = eyes unobstructed, 0 = glasses / uncertain canthi */
  eyeConf: number;
  /** 1 = jaw unobstructed, 0 = beard / uncertain gonion */
  jawConf: number;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Normalize angle difference into [-π, π]. */
function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * Landmark coordinate mode from max extent:
 * ≤1.5 → unit [0,1]; ≤100 → percent [0,100]; else image pixels.
 */
export function landmarkCoordMode(
  pts: Array<{ x: number; y: number }>,
): "unit" | "percent" | "pixel" {
  let maxC = 0;
  for (const p of pts) {
    if (p.x > maxC) maxC = p.x;
    if (p.y > maxC) maxC = p.y;
  }
  if (maxC <= 1.5) return "unit";
  if (maxC <= 100) return "percent";
  return "pixel";
}

function toPixel(
  p: { x: number; y: number },
  mode: "unit" | "percent" | "pixel",
  w: number,
  h: number,
): { x: number; y: number } {
  if (mode === "unit") return { x: p.x * (w - 1), y: p.y * (h - 1) };
  if (mode === "percent") return { x: (p.x / 100) * (w - 1), y: (p.y / 100) * (h - 1) };
  return { x: p.x, y: p.y };
}

function polyRoughness(pts: Array<{ x: number; y: number }>): number {
  if (pts.length < 3) return 0;
  let acc = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const n1 = Math.hypot(v1x, v1y) || 1;
    const n2 = Math.hypot(v2x, v2y) || 1;
    const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
    acc += 1 - Math.max(-1, Math.min(1, cos));
  }
  return acc / (pts.length - 2);
}

/**
 * Landmark-only regional confidence. Optional ImageData refines rim/texture energy.
 */
export function estimateRegionalOcclusion(
  landmarks68: Array<{ x: number; y: number }>,
  image?: { width: number; height: number; data: Uint8ClampedArray | Uint8Array } | null,
): RegionalOcclusionConfidence {
  if (!landmarks68 || landmarks68.length < 68) {
    return { eyeConf: 1, jawConf: 1 };
  }

  const lOuter = landmarks68[36]!;
  const lInner = landmarks68[39]!;
  const rInner = landmarks68[42]!;
  const rOuter = landmarks68[45]!;
  const iod = dist(lInner, rInner);
  const faceW = dist(landmarks68[0]!, landmarks68[16]!);
  const expectedIod = faceW * 0.22;
  const iodRatio = expectedIod > 1e-6 ? iod / expectedIod : 1;
  const iodPenalty = Math.abs(Math.log(Math.max(0.35, iodRatio))) / Math.log(2);

  // Eye fissure tilts relative to the inter-eye axis so shared head roll cancels.
  const leftC = mid(lOuter, lInner);
  const rightC = mid(rOuter, rInner);
  const axisAng = Math.atan2(rightC.y - leftC.y, rightC.x - leftC.x + 1e-6);
  // Left: outer → inner (left-to-right); right: inner → outer (left-to-right).
  const lFissure = Math.atan2(lInner.y - lOuter.y, lInner.x - lOuter.x + 1e-6);
  const rFissure = Math.atan2(rOuter.y - rInner.y, rOuter.x - rInner.x + 1e-6);
  const lRel = wrapAngle(lFissure - axisAng);
  const rRel = wrapAngle(rFissure - axisAng);
  const tiltAsym = Math.abs(lRel - rRel);
  // Residual asymmetry only (not absolute per-eye slope vs horizontal).
  const tiltTerm = 0.35 * tiltAsym;

  const eyePts = landmarks68.slice(36, 48);
  const eyeRough = polyRoughness(eyePts);

  let rimEnergy = 0;
  if (image && image.width > 8 && image.data.length >= image.width * image.height * 4) {
    // Luma excess vs cheeks cancels lashes / lid creases.
    // Chroma excess is what thin colored frames have and skin does not.
    const rimPts = eyeRimSamplePoints(landmarks68);
    const cheekPts = [
      mid(landmarks68[1]!, landmarks68[2]!),
      mid(landmarks68[2]!, landmarks68[3]!),
      mid(landmarks68[14]!, landmarks68[15]!),
      mid(landmarks68[13]!, landmarks68[14]!),
    ];
    const rim = sampleEdgeComponents(image, rimPts);
    const cheek = sampleEdgeComponents(image, cheekPts);
    const lumaExcess = Math.max(0, rim.luma - cheek.luma * 1.05);
    const chromaExcess = Math.max(0, rim.chroma - cheek.chroma * 0.45);
    rimEnergy = Math.min(1, 0.45 * lumaExcess + 1.15 * chromaExcess);
  }

  const eyeConf = clamp01(
    1 - 0.45 * iodPenalty - tiltTerm - 0.35 * eyeRough - 0.5 * rimEnergy,
  );

  const jaw = landmarks68.slice(0, 17);
  const jawRough = polyRoughness(jaw);
  const cheek = [landmarks68[1]!, landmarks68[2]!, landmarks68[14]!, landmarks68[15]!];
  const cheekRough = polyRoughness(cheek);
  const jawExcess = Math.max(0, jawRough - cheekRough * 1.15);

  let chinTexture = 0;
  if (image && image.width > 8) {
    const chin = landmarks68.slice(6, 11);
    chinTexture = sampleEdgeEnergy(image, chin);
  }

  const jawConf = clamp01(1 - 0.9 * jawExcess - 0.35 * chinTexture);

  return { eyeConf, jawConf };
}

/**
 * Sample the brow–eye strip (where spectacle rims sit), not lid landmarks
 * 36–47 (lashes / crease — those false-positive clean faces).
 */
function eyeRimSamplePoints(
  landmarks68: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  const samples: Array<{ x: number; y: number }> = [];
  const pairs: Array<[number, number]> = [
    [17, 36],
    [18, 37],
    [19, 37],
    [20, 38],
    [21, 39],
    [22, 42],
    [23, 43],
    [24, 43],
    [25, 44],
    [26, 45],
  ];
  for (const [bi, ei] of pairs) {
    const b = landmarks68[bi]!;
    const e = landmarks68[ei]!;
    samples.push(mid(b, e));
    samples.push({
      x: b.x * 0.55 + e.x * 0.45,
      y: b.y * 0.55 + e.y * 0.45,
    });
  }
  // Nose-bridge crossing (typical frame bar).
  samples.push(mid(landmarks68[21]!, landmarks68[22]!));
  samples.push(mid(landmarks68[27]!, landmarks68[21]!));
  samples.push(mid(landmarks68[27]!, landmarks68[22]!));
  return samples;
}

function sampleEdgeComponents(
  image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  pts: Array<{ x: number; y: number }>,
): { luma: number; chroma: number } {
  const { width: w, height: h, data } = image;
  if (pts.length === 0) return { luma: 0, chroma: 0 };
  const mode = landmarkCoordMode(pts);

  const lumAt = (x: number, y: number): number => {
    const i = (y * w + x) * 4;
    return 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
  };
  const chromaAt = (x: number, y: number): number => {
    const i = (y * w + x) * 4;
    const R = data[i] ?? 0;
    const G = data[i + 1] ?? 0;
    const B = data[i + 2] ?? 0;
    return Math.abs(R - G) + Math.abs(G - B);
  };

  let lumaAcc = 0;
  let chromaAcc = 0;
  let n = 0;
  const ring: Array<[number, number]> = [
    [-3, 0],
    [3, 0],
    [0, -3],
    [0, 3],
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
  ];

  for (const p of pts) {
    const px = toPixel(p, mode, w, h);
    const x = Math.round(px.x);
    const y = Math.round(px.y);
    if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) continue;

    const c = lumAt(x, y);
    const grad =
      Math.abs(c - lumAt(x + 1, y)) +
      Math.abs(c - lumAt(x - 1, y)) +
      Math.abs(c - lumAt(x, y + 1)) +
      Math.abs(c - lumAt(x, y - 1)) +
      0.5 *
        (Math.abs(c - lumAt(x + 2, y)) +
          Math.abs(c - lumAt(x - 2, y)) +
          Math.abs(c - lumAt(x, y + 2)) +
          Math.abs(c - lumAt(x, y - 2)));

    const ch = chromaAt(x, y);
    const chromaGrad =
      Math.abs(ch - chromaAt(x + 1, y)) +
      Math.abs(ch - chromaAt(x - 1, y)) +
      Math.abs(ch - chromaAt(x, y + 1)) +
      Math.abs(ch - chromaAt(x, y - 1));

    let ringLum = 0;
    let ringCh = 0;
    for (const [dx, dy] of ring) {
      ringLum += lumAt(x + dx, y + dy);
      ringCh += chromaAt(x + dx, y + dy);
    }
    ringLum /= ring.length;
    ringCh /= ring.length;

    lumaAcc += grad + 1.35 * Math.abs(c - ringLum);
    chromaAcc += 0.45 * chromaGrad + 0.9 * Math.abs(ch - ringCh);
    n++;
  }
  if (n === 0) return { luma: 0, chroma: 0 };
  return {
    luma: Math.min(1, lumaAcc / n / 100),
    chroma: Math.min(1, chromaAcc / n / 100),
  };
}

function sampleEdgeEnergy(
  image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  pts: Array<{ x: number; y: number }>,
): number {
  const c = sampleEdgeComponents(image, pts);
  return Math.min(1, c.luma + c.chroma);
}
