import type { ExtendedAnatomicalFeatures, FaceFeatures, FeatureKey, Point2D, Point3D } from "./types.ts";
import { clamp, dist, mid, emptyFeatures, rgbToApproxLab } from "./math.ts";
import { alignToCanonical3D } from "./pose.ts";

export type { Point2D };

/** MediaPipe Face Landmarker landmark (normalized image coords). */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export interface AffineTransform2D {
  a: number;           // scale * cos(theta)
  b: number;           // scale * sin(theta)
  tx: number;          // translation x
  ty: number;          // translation y
  scale: number;       // scale s = sqrt(a^2 + b^2)
  rotationDeg: number; // angle theta in degrees = atan2(b, a) * 180 / PI
}

/**
 * Fixed 5 Canonical Landmark Anchor Points in 150x150 embedding space (R2).
 * Target Anchor Coordinates:
 *   Left Eye Center: (46.5, 54.0)
 *   Right Eye Center: (103.5, 54.0)
 *   Nose Tip: (75.0, 85.5)
 *   Left Mouth Corner: (52.5, 115.5)
 *   Right Mouth Corner: (97.5, 115.5)
 */
export const CANONICAL_5_POINTS_150: [Point2D, Point2D, Point2D, Point2D, Point2D] = [
  { x: 46.5, y: 54.0 },   // Left Eye Center
  { x: 103.5, y: 54.0 },  // Right Eye Center
  { x: 75.0, y: 85.5 },   // Nose Tip
  { x: 52.5, y: 115.5 },  // Left Mouth Corner
  { x: 97.5, y: 115.5 },  // Right Mouth Corner
];

/**
 * Extract 5 landmark anchor points [Left Eye, Right Eye, Nose Tip, Left Mouth, Right Mouth]
 * from 68-point dlib landmarks, 468/478-point MediaPipe landmarks, or 5-point landmark arrays.
 */
export function extract5AnchorPoints(
  landmarks: Array<{ x: number; y: number }>,
): [Point2D, Point2D, Point2D, Point2D, Point2D] | null {
  if (!landmarks || !Array.isArray(landmarks) || landmarks.length < 5) {
    return null;
  }

  // Case 1: Exactly 5 points passed directly
  if (landmarks.length === 5) {
    const pts = landmarks.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    if (pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
      return pts as [Point2D, Point2D, Point2D, Point2D, Point2D];
    }
    return null;
  }

  // Case 2: 68-point dlib landmarks (or 68 to <400 points)
  if (landmarks.length >= 68 && landmarks.length < 400) {
    const pt = (i: number) => landmarks[i] ?? { x: 0, y: 0 };
    // Left Eye Center: average of 36..41
    let leX = 0, leY = 0;
    for (let i = 36; i <= 41; i++) {
      const p = pt(i);
      leX += p.x;
      leY += p.y;
    }
    const leftEye = { x: leX / 6, y: leY / 6 };

    // Right Eye Center: average of 42..47
    let reX = 0, reY = 0;
    for (let i = 42; i <= 47; i++) {
      const p = pt(i);
      reX += p.x;
      reY += p.y;
    }
    const rightEye = { x: reX / 6, y: reY / 6 };

    // Nose Tip: 30
    const pNose = pt(30);
    const noseTip = { x: pNose.x, y: pNose.y };

    // Left Mouth Corner: 48
    const pLmMouth = pt(48);
    const leftMouth = { x: pLmMouth.x, y: pLmMouth.y };

    // Right Mouth Corner: 54
    const pRmMouth = pt(54);
    const rightMouth = { x: pRmMouth.x, y: pRmMouth.y };

    const anchors: [Point2D, Point2D, Point2D, Point2D, Point2D] = [
      leftEye, rightEye, noseTip, leftMouth, rightMouth
    ];

    if (anchors.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
      return anchors;
    }
    return null;
  }

  // Case 3: MediaPipe 468/478 landmarks (>= 400 points)
  if (landmarks.length >= 400) {
    const pt = (i: number) => landmarks[i] ?? { x: 0, y: 0 };
    const p33 = pt(33), p133 = pt(133);
    const leftEye = { x: (p33.x + p133.x) / 2, y: (p33.y + p133.y) / 2 };

    const p263 = pt(263), p362 = pt(362);
    const rightEye = { x: (p263.x + p362.x) / 2, y: (p263.y + p362.y) / 2 };

    const p1 = pt(1);
    const noseTip = { x: p1.x, y: p1.y };

    const p61 = pt(61);
    const leftMouth = { x: p61.x, y: p61.y };

    const p291 = pt(291);
    const rightMouth = { x: p291.x, y: p291.y };

    const anchors: [Point2D, Point2D, Point2D, Point2D, Point2D] = [
      leftEye, rightEye, noseTip, leftMouth, rightMouth
    ];

    if (anchors.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
      return anchors;
    }
    return null;
  }

  return null;
}

/**
 * Solve 2D similarity transform (a, b, tx, ty) mapping source 5-point anchor coordinates
 * to fixed canonical target coordinates using linear least squares (A^T A u = A^T b).
 *
 * Transform mapping:
 *   x' = a * x - b * y + tx
 *   y' = b * x + a * y + ty
 *
 * where a = scale * cos(theta), b = scale * sin(theta).
 */
export function compute5PointAffineTransform(
  sourcePoints: Point2D[],
  targetPoints: Point2D[] = CANONICAL_5_POINTS_150,
): AffineTransform2D {
  const N = Math.min(sourcePoints.length, targetPoints.length);
  if (N < 2) {
    return { a: 1, b: 0, tx: 0, ty: 0, scale: 1, rotationDeg: 0 };
  }

  let srcMx = 0, srcMy = 0, tgtMx = 0, tgtMy = 0;
  for (let i = 0; i < N; i++) {
    srcMx += sourcePoints[i]!.x;
    srcMy += sourcePoints[i]!.y;
    tgtMx += targetPoints[i]!.x;
    tgtMy += targetPoints[i]!.y;
  }
  srcMx /= N;
  srcMy /= N;
  tgtMx /= N;
  tgtMy /= N;

  let numA = 0;
  let numB = 0;
  let den = 0;

  for (let i = 0; i < N; i++) {
    const dx = sourcePoints[i]!.x - srcMx;
    const dy = sourcePoints[i]!.y - srcMy;
    const dxT = targetPoints[i]!.x - tgtMx;
    const dyT = targetPoints[i]!.y - tgtMy;

    numA += dx * dxT + dy * dyT;
    numB += -dy * dxT + dx * dyT;
    den += dx * dx + dy * dy;
  }

  if (den < 1e-9) {
    return {
      a: 1,
      b: 0,
      tx: tgtMx - srcMx,
      ty: tgtMy - srcMy,
      scale: 1,
      rotationDeg: 0,
    };
  }

  const a = numA / den;
  const b = numB / den;
  const tx = tgtMx - (a * srcMx - b * srcMy);
  const ty = tgtMy - (b * srcMx + a * srcMy);

  const scale = Math.hypot(a, b);
  const rotationRad = Math.atan2(b, a);
  const rotationDeg = (rotationRad * 180) / Math.PI;

  return {
    a,
    b,
    tx,
    ty,
    scale,
    rotationDeg,
  };
}

/**
 * Apply 2D affine transformation to a point (x, y).
 */
export function applyAffineTransform2D(
  pt: Point2D,
  transform: AffineTransform2D,
): Point2D {
  return {
    x: transform.a * pt.x - transform.b * pt.y + transform.tx,
    y: transform.b * pt.x + transform.a * pt.y + transform.ty,
  };
}

/**
 * Apply 2D affine warping to crop and align a facial image into upright canonical 150x150 space.
 * Uses 5 landmark anchor points to compute similarity transform (a, b, tx, ty) via linear least squares.
 *
 * Normalizes in-plane head tilt (> 20 deg) to upright canonical alignment.
 */
export function warp5PointCanonicalCanvas(
  source: CanvasImageSource,
  sourceLandmarks: Array<{ x: number; y: number }>,
  outSize = 150,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";

  const anchors = extract5AnchorPoints(sourceLandmarks);
  if (!anchors) {
    ctx.drawImage(source, 0, 0, outSize, outSize);
    return canvas;
  }

  const srcW = (source as any).width ?? (source as any).videoWidth ?? outSize;
  const srcH = (source as any).height ?? (source as any).videoHeight ?? outSize;

  const maxX = Math.max(...anchors.map((p) => p.x));
  const maxY = Math.max(...anchors.map((p) => p.y));

  const scaledAnchors: [Point2D, Point2D, Point2D, Point2D, Point2D] = anchors.map((p) => {
    if (maxX <= 1.0 && maxY <= 1.0 && (srcW > 1.0 || srcH > 1.0)) {
      return { x: p.x * srcW, y: p.y * srcH };
    }
    return { x: p.x, y: p.y };
  }) as [Point2D, Point2D, Point2D, Point2D, Point2D];

  const targetPoints: Point2D[] = outSize === 150
    ? CANONICAL_5_POINTS_150
    : CANONICAL_5_POINTS_150.map((p) => ({
        x: (p.x / 150) * outSize,
        y: (p.y / 150) * outSize,
      }));

  const transform = compute5PointAffineTransform(scaledAnchors, targetPoints);

  ctx.save();
  ctx.setTransform(transform.a, transform.b, -transform.b, transform.a, transform.tx, transform.ty);
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  return canvas;
}

/**
 * Helper function to unwarp 2D or 3D landmarks to canonical frontal plane via 3D SVD alignment.
 */
export function unwarpLandmarksToFrontal(
  landmarks: Landmark[] | Array<{ x: number; y: number }>
): Point3D[] {
  const result = alignToCanonical3D(landmarks);
  return result.unwarpedLandmarks;
}

/**
 * Key MediaPipe Face Mesh indices used for geometric ratios.
 * @see https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
 */
export const LM = {
  chin: 152,
  forehead: 10,
  leftCheek: 234,
  rightCheek: 454,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  leftEyeTop: 159,
  leftEyeBottom: 145,
  rightEyeOuter: 263,
  rightEyeInner: 362,
  rightEyeTop: 386,
  rightEyeBottom: 374,
  leftBrowInner: 107,
  leftBrowOuter: 70,
  rightBrowInner: 336,
  rightBrowOuter: 300,
  noseTip: 1,
  noseBridge: 6,
  noseLeft: 98,
  noseRight: 327,
  mouthLeft: 61,
  mouthRight: 291,
  upperLip: 13,
  lowerLip: 14,
  jawLeft: 172,
  jawRight: 397,
  leftCheekbone: 50,
  rightCheekbone: 280,
} as const;

function pt(landmarks: Array<{ x: number; y: number; z?: number }>, i: number): { x: number; y: number; z?: number } {
  const p = landmarks[i];
  if (!p) return { x: 0.5, y: 0.5 };
  return p;
}

function d3d(
  a: { x: number; y: number; z?: number },
  b: { x: number; y: number; z?: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function mid3d(
  a: { x: number; y: number; z?: number },
  b: { x: number; y: number; z?: number },
): { x: number; y: number; z: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
}

function clampNum(
  val: number,
  minVal: number,
  maxVal: number,
  fallback: number,
): number {
  if (!Number.isFinite(val) || Number.isNaN(val)) return fallback;
  return Math.max(minVal, Math.min(maxVal, val));
}

/** Canonical reference default values for clinical facial proportions (M2). */
export const CANONICAL_ANATOMICAL_DEFAULTS: ExtendedAnatomicalFeatures = {
  upperThirdRatio: 0.3333,
  middleThirdRatio: 0.3333,
  lowerThirdRatio: 0.3333,
  lateralFifthsRatios: [0.20, 0.20, 0.20, 0.20, 0.20],
  interCanthalDistance: 0.21,
  canthalTiltAngleDeg: 4.0,
  nasalIndex: 0.75,
  bigonialToBizygomaticRatio: 0.76,
  gonialJawlineAngleDeg: 124.0,
  lipVermilionHeightRatio: 0.625,
  philtrumDepth: 0.50,
};

/**
 * Extract extended 9 clinical anatomical facial proportions from MediaPipe 468/478 landmarks.
 * Automatically unwarps landmarks to 3D canonical frontal space before computation.
 */
export function extractAnatomicalFeatures(
  landmarks: Landmark[] | Array<{ x: number; y: number; z?: number }>,
): ExtendedAnatomicalFeatures {
  if (!landmarks || landmarks.length < 10) {
    return {
      ...CANONICAL_ANATOMICAL_DEFAULTS,
      lateralFifthsRatios: [...CANONICAL_ANATOMICAL_DEFAULTS.lateralFifthsRatios],
    };
  }

  const alignment = alignToCanonical3D(landmarks);
  const targetLms =
    alignment.unwarpedLandmarks.length === landmarks.length
      ? alignment.unwarpedLandmarks
      : landmarks;

  const tr = pt(targetLms, LM.forehead);
  const gInnerL = pt(targetLms, LM.leftBrowInner);
  const gInnerR = pt(targetLms, LM.rightBrowInner);
  const g = mid3d(gInnerL, gInnerR);
  const sn = pt(targetLms, 2);
  const me = pt(targetLms, LM.chin);

  const hUpper = d3d(tr, g);
  const hMiddle = d3d(g, sn);
  const hLower = d3d(sn, me);
  const hTotal = Math.max(hUpper + hMiddle + hLower, 1e-6);

  const upperThirdRatio = clampNum(hUpper / hTotal, 0.05, 0.70, 0.3333);
  const middleThirdRatio = clampNum(hMiddle / hTotal, 0.05, 0.70, 0.3333);
  const lowerThirdRatio = clampNum(hLower / hTotal, 0.05, 0.70, 0.3333);

  const zyL = pt(targetLms, LM.leftCheek);
  const exL = pt(targetLms, LM.leftEyeOuter);
  const enL = pt(targetLms, LM.leftEyeInner);
  const enR = pt(targetLms, LM.rightEyeInner);
  const exR = pt(targetLms, LM.rightEyeOuter);
  const zyR = pt(targetLms, LM.rightCheek);

  const w1 = d3d(zyL, exL);
  const w2 = d3d(exL, enL);
  const w3 = d3d(enL, enR);
  const w4 = d3d(enR, exR);
  const w5 = d3d(exR, zyR);
  const wSum = Math.max(w1 + w2 + w3 + w4 + w5, 1e-6);

  const lateralFifthsRatios = [
    clampNum(w1 / wSum, 0.01, 0.60, 0.20),
    clampNum(w2 / wSum, 0.01, 0.60, 0.20),
    clampNum(w3 / wSum, 0.01, 0.60, 0.20),
    clampNum(w4 / wSum, 0.01, 0.60, 0.20),
    clampNum(w5 / wSum, 0.01, 0.60, 0.20),
  ];

  const wBizygomatic = Math.max(d3d(zyL, zyR), 1e-6);
  const dInterCanthal = d3d(enL, enR);
  const interCanthalDistance = clampNum(dInterCanthal / wBizygomatic, 0.05, 0.65, 0.21);

  const thetaL = Math.atan2(exL.y - enL.y, Math.abs(exL.x - enL.x) + 1e-6) * (180 / Math.PI);
  const thetaR = Math.atan2(exR.y - enR.y, Math.abs(exR.x - enR.x) + 1e-6) * (180 / Math.PI);
  const canthalTiltAngleDeg = clampNum((thetaL + thetaR) / 2, -35.0, 35.0, 4.0);

  const alL = pt(targetLms, LM.noseLeft);
  const alR = pt(targetLms, LM.noseRight);
  const nasion = pt(targetLms, LM.noseBridge);
  const wAlar = d3d(alL, alR);
  const lNasal = Math.max(d3d(nasion, sn), 1e-6);
  const nasalIndex = clampNum(wAlar / lNasal, 0.20, 2.0, 0.75);

  const goL = pt(targetLms, LM.jawLeft);
  const goR = pt(targetLms, LM.jawRight);
  const wBigonial = d3d(goL, goR);
  const bigonialToBizygomaticRatio = clampNum(wBigonial / wBizygomatic, 0.30, 1.20, 0.76);

  const uL = [zyL.x - goL.x, zyL.y - goL.y, (zyL.z ?? 0) - (goL.z ?? 0)];
  const vL = [me.x - goL.x, me.y - goL.y, (me.z ?? 0) - (goL.z ?? 0)];
  const dotL = uL[0] * vL[0] + uL[1] * vL[1] + uL[2] * vL[2];
  const magL = Math.max(Math.sqrt(uL[0] * uL[0] + uL[1] * uL[1] + uL[2] * uL[2]) * Math.sqrt(vL[0] * vL[0] + vL[1] * vL[1] + vL[2] * vL[2]), 1e-6);
  const gonialL = Math.acos(Math.max(-1.0, Math.min(1.0, dotL / magL))) * (180 / Math.PI);

  const uR = [zyR.x - goR.x, zyR.y - goR.y, (zyR.z ?? 0) - (goR.z ?? 0)];
  const vR = [me.x - goR.x, me.y - goR.y, (me.z ?? 0) - (goR.z ?? 0)];
  const dotR = uR[0] * vR[0] + uR[1] * vR[1] + uR[2] * vR[2];
  const magR = Math.max(Math.sqrt(uR[0] * uR[0] + uR[1] * uR[1] + uR[2] * uR[2]) * Math.sqrt(vR[0] * vR[0] + vR[1] * vR[1] + vR[2] * vR[2]), 1e-6);
  const gonialR = Math.acos(Math.max(-1.0, Math.min(1.0, dotR / magR))) * (180 / Math.PI);
  const gonialJawlineAngleDeg = clampNum((gonialL + gonialR) / 2, 70.0, 160.0, 124.0);

  const ls = pt(targetLms, LM.upperLip);
  const li = pt(targetLms, LM.lowerLip);
  const sto = { x: (ls.x + li.x) / 2, y: (ls.y + li.y) / 2, z: ((ls.z ?? 0) + (li.z ?? 0)) / 2 };
  const hUpperLip = d3d(ls, sto);
  const hLowerLip = Math.max(d3d(sto, li), 1e-6);
  const lipVermilionHeightRatio = clampNum(hUpperLip / hLowerLip, 0.10, 3.0, 0.625);

  const lPhiltrum = d3d(sn, ls);
  const hLowerFace = Math.max(d3d(sn, me), 1e-6);
  const r2D = lPhiltrum / hLowerFace;
  const pg = pt(targetLms, 164);
  const prL = pt(targetLms, 37);
  const prR = pt(targetLms, 267);
  const ridgeZ = ((prL.z ?? 0) + (prR.z ?? 0)) / 2;
  const deltaZ = Math.abs(ridgeZ - (pg.z ?? 0));
  const philtrumDepth = clampNum((r2D / 0.25) * (1.0 + 2.0 * (deltaZ / Math.max(dInterCanthal, 1e-6))), 0.10, 2.0, 0.50);

  return {
    upperThirdRatio,
    middleThirdRatio,
    lowerThirdRatio,
    lateralFifthsRatios,
    interCanthalDistance,
    canthalTiltAngleDeg,
    nasalIndex,
    bigonialToBizygomaticRatio,
    gonialJawlineAngleDeg,
    lipVermilionHeightRatio,
    philtrumDepth,
  };
}

/**
 * Extract extended 9 clinical anatomical facial proportions from 68-point dlib landmarks.
 * Automatically unwarps landmarks to 3D canonical frontal space before computation.
 */
export function extractAnatomicalFeatures68(
  landmarks: Array<{ x: number; y: number; z?: number }>,
): ExtendedAnatomicalFeatures {
  if (!landmarks || landmarks.length < 68) {
    return {
      ...CANONICAL_ANATOMICAL_DEFAULTS,
      lateralFifthsRatios: [...CANONICAL_ANATOMICAL_DEFAULTS.lateralFifthsRatios],
    };
  }

  const lms68 = landmarks.slice(0, 68);
  const alignment = alignToCanonical3D(lms68);
  const targetLms =
    alignment.unwarpedLandmarks.length === 68
      ? alignment.unwarpedLandmarks
      : lms68;

  const chin = pt(targetLms, 8);
  const browMid = mid3d(pt(targetLms, 21), pt(targetLms, 22));
  const tr = {
    x: browMid.x + 0.35 * (browMid.x - chin.x),
    y: browMid.y + 0.35 * (browMid.y - chin.y),
    z: browMid.z + 0.35 * (browMid.z - (chin.z ?? 0)),
  };
  const g = pt(targetLms, 27);
  const sn = pt(targetLms, 33);
  const me = chin;

  const hUpper = d3d(tr, g);
  const hMiddle = d3d(g, sn);
  const hLower = d3d(sn, me);
  const hTotal = Math.max(hUpper + hMiddle + hLower, 1e-6);

  const upperThirdRatio = clampNum(hUpper / hTotal, 0.05, 0.70, 0.3333);
  const middleThirdRatio = clampNum(hMiddle / hTotal, 0.05, 0.70, 0.3333);
  const lowerThirdRatio = clampNum(hLower / hTotal, 0.05, 0.70, 0.3333);

  const zyL = pt(targetLms, 0);
  const exL = pt(targetLms, 36);
  const enL = pt(targetLms, 39);
  const enR = pt(targetLms, 42);
  const exR = pt(targetLms, 45);
  const zyR = pt(targetLms, 16);

  const w1 = d3d(zyL, exL);
  const w2 = d3d(exL, enL);
  const w3 = d3d(enL, enR);
  const w4 = d3d(enR, exR);
  const w5 = d3d(exR, zyR);
  const wSum = Math.max(w1 + w2 + w3 + w4 + w5, 1e-6);

  const lateralFifthsRatios = [
    clampNum(w1 / wSum, 0.01, 0.60, 0.20),
    clampNum(w2 / wSum, 0.01, 0.60, 0.20),
    clampNum(w3 / wSum, 0.01, 0.60, 0.20),
    clampNum(w4 / wSum, 0.01, 0.60, 0.20),
    clampNum(w5 / wSum, 0.01, 0.60, 0.20),
  ];

  const wBizygomatic = Math.max(d3d(zyL, zyR), 1e-6);
  const dInterCanthal = d3d(enL, enR);
  const interCanthalDistance = clampNum(dInterCanthal / wBizygomatic, 0.05, 0.65, 0.21);

  const thetaL = Math.atan2(exL.y - enL.y, Math.abs(exL.x - enL.x) + 1e-6) * (180 / Math.PI);
  const thetaR = Math.atan2(exR.y - enR.y, Math.abs(exR.x - enR.x) + 1e-6) * (180 / Math.PI);
  const canthalTiltAngleDeg = clampNum((thetaL + thetaR) / 2, -35.0, 35.0, 4.0);

  const alL = pt(targetLms, 31);
  const alR = pt(targetLms, 35);
  const nasion = pt(targetLms, 27);
  const wAlar = d3d(alL, alR);
  const lNasal = Math.max(d3d(nasion, sn), 1e-6);
  const nasalIndex = clampNum(wAlar / lNasal, 0.20, 2.0, 0.75);

  const goL = pt(targetLms, 4);
  const goR = pt(targetLms, 12);
  const wBigonial = d3d(goL, goR);
  const bigonialToBizygomaticRatio = clampNum(wBigonial / wBizygomatic, 0.30, 1.20, 0.76);

  const uL = [zyL.x - goL.x, zyL.y - goL.y, (zyL.z ?? 0) - (goL.z ?? 0)];
  const vL = [me.x - goL.x, me.y - goL.y, (me.z ?? 0) - (goL.z ?? 0)];
  const dotL = uL[0] * vL[0] + uL[1] * vL[1] + uL[2] * vL[2];
  const magL = Math.max(Math.sqrt(uL[0] * uL[0] + uL[1] * uL[1] + uL[2] * uL[2]) * Math.sqrt(vL[0] * vL[0] + vL[1] * vL[1] + vL[2] * vL[2]), 1e-6);
  const gonialL = Math.acos(Math.max(-1.0, Math.min(1.0, dotL / magL))) * (180 / Math.PI);

  const uR = [zyR.x - goR.x, zyR.y - goR.y, (zyR.z ?? 0) - (goR.z ?? 0)];
  const vR = [me.x - goR.x, me.y - goR.y, (me.z ?? 0) - (goR.z ?? 0)];
  const dotR = uR[0] * vR[0] + uR[1] * vR[1] + uR[2] * vR[2];
  const magR = Math.max(Math.sqrt(uR[0] * uR[0] + uR[1] * uR[1] + uR[2] * uR[2]) * Math.sqrt(vR[0] * vR[0] + vR[1] * vR[1] + vR[2] * vR[2]), 1e-6);
  const gonialR = Math.acos(Math.max(-1.0, Math.min(1.0, dotR / magR))) * (180 / Math.PI);
  const gonialJawlineAngleDeg = clampNum((gonialL + gonialR) / 2, 70.0, 160.0, 124.0);

  const ls = pt(targetLms, 51);
  const li = pt(targetLms, 57);
  const innerMid = mid(pt(targetLms, 62), pt(targetLms, 66));
  const p62 = pt(targetLms, 62);
  const p66 = pt(targetLms, 66);
  const sto = { x: innerMid.x, y: innerMid.y, z: ((p62.z ?? 0) + (p66.z ?? 0)) / 2 };
  const hUpperLip = d3d(ls, sto);
  const hLowerLip = Math.max(d3d(sto, li), 1e-6);
  const lipVermilionHeightRatio = clampNum(hUpperLip / hLowerLip, 0.10, 3.0, 0.625);

  const lPhiltrum = d3d(sn, ls);
  const hLowerFace = Math.max(d3d(sn, me), 1e-6);
  const r2D = lPhiltrum / hLowerFace;
  const pg = { x: (sn.x + ls.x) / 2, y: (sn.y + ls.y) / 2, z: ((sn.z ?? 0) + (ls.z ?? 0)) / 2 };
  const prL = pt(targetLms, 50);
  const prR = pt(targetLms, 52);
  const ridgeZ = ((prL.z ?? 0) + (prR.z ?? 0)) / 2;
  const deltaZ = Math.abs(ridgeZ - pg.z);
  const philtrumDepth = clampNum((r2D / 0.25) * (1.0 + 2.0 * (deltaZ / Math.max(dInterCanthal, 1e-6))), 0.10, 2.0, 0.50);

  return {
    upperThirdRatio,
    middleThirdRatio,
    lowerThirdRatio,
    lateralFifthsRatios,
    interCanthalDistance,
    canthalTiltAngleDeg,
    nasalIndex,
    bigonialToBizygomaticRatio,
    gonialJawlineAngleDeg,
    lipVermilionHeightRatio,
    philtrumDepth,
  };
}

/**
 * Extract a normalized FaceFeatures vector from MediaPipe face landmarks.
 * All ratios are scale-invariant (relative to inter-ocular or face height).
 */
export function extractGeometryFeatures(landmarks: Landmark[]): FaceFeatures {
  const f = emptyFeatures();
  if (landmarks.length < 400) return f;

  const alignment = alignToCanonical3D(landmarks);
  const targetLms = alignment.unwarpedLandmarks.length === landmarks.length
    ? alignment.unwarpedLandmarks
    : landmarks;

  const chin = pt(targetLms, LM.chin);
  const forehead = pt(targetLms, LM.forehead);
  const leftCheek = pt(targetLms, LM.leftCheek);
  const rightCheek = pt(targetLms, LM.rightCheek);

  const faceH = Math.max(dist(forehead, chin), 1e-6);
  const faceW = Math.max(dist(leftCheek, rightCheek), 1e-6);

  f.faceAspect = clamp(faceW / faceH / 1.35);

  const jawW = dist(pt(targetLms, LM.jawLeft), pt(targetLms, LM.jawRight));
  f.jawWidth = clamp(jawW / faceW);

  const jawMid = mid(pt(targetLms, LM.jawLeft), pt(targetLms, LM.jawRight));
  const chinDrop = dist(jawMid, chin) / faceH;
  f.chinSharpness = clamp(chinDrop / 0.28);

  const browMid = mid(
    pt(targetLms, LM.leftBrowInner),
    pt(targetLms, LM.rightBrowInner),
  );
  f.foreheadHeight = clamp(dist(forehead, browMid) / faceH / 0.35);

  const lOuter = pt(targetLms, LM.leftEyeOuter);
  const lInner = pt(targetLms, LM.leftEyeInner);
  const rOuter = pt(targetLms, LM.rightEyeOuter);
  const rInner = pt(targetLms, LM.rightEyeInner);
  const leftEyeC = mid(lOuter, lInner);
  const rightEyeC = mid(rOuter, rInner);
  const iod = Math.max(dist(leftEyeC, rightEyeC), 1e-6);

  f.eyeSpacing = clamp(iod / faceW / 0.55);

  const leftOpen = dist(
    pt(targetLms, LM.leftEyeTop),
    pt(targetLms, LM.leftEyeBottom),
  );
  const rightOpen = dist(
    pt(targetLms, LM.rightEyeTop),
    pt(targetLms, LM.rightEyeBottom),
  );
  const leftWidth = Math.max(dist(lOuter, lInner), 1e-6);
  const rightWidth = Math.max(dist(rOuter, rInner), 1e-6);
  f.eyeOpenness = clamp(
    (leftOpen / leftWidth + rightOpen / rightWidth) / 2 / 0.45,
  );

  const leftSlant = (lOuter.y - lInner.y) / faceH;
  const rightSlant = (rOuter.y - rInner.y) / faceH;
  f.eyeSlant = clamp(0.5 + ((leftSlant - rightSlant) / 2) * 8);

  const leftBrow = mid(
    pt(targetLms, LM.leftBrowInner),
    pt(targetLms, LM.leftBrowOuter),
  );
  const rightBrow = mid(
    pt(targetLms, LM.rightBrowInner),
    pt(targetLms, LM.rightBrowOuter),
  );
  const browH =
    (dist(leftBrow, leftEyeC) + dist(rightBrow, rightEyeC)) / 2 / faceH;
  f.browHeight = clamp(browH / 0.12);

  const noseTip = pt(targetLms, LM.noseTip);
  const noseBridge = pt(targetLms, LM.noseBridge);
  f.noseLength = clamp(dist(noseBridge, noseTip) / faceH / 0.28);
  f.noseWidth = clamp(
    dist(pt(targetLms, LM.noseLeft), pt(targetLms, LM.noseRight)) /
      faceW /
      0.28,
  );

  const mouthL = pt(targetLms, LM.mouthLeft);
  const mouthR = pt(targetLms, LM.mouthRight);
  f.mouthWidth = clamp(dist(mouthL, mouthR) / faceW / 0.45);
  const lipGap = dist(pt(targetLms, LM.upperLip), pt(targetLms, LM.lowerLip));
  f.lipFullness = clamp(lipGap / faceH / 0.08);

  const cheekSpan = dist(
    pt(targetLms, LM.leftCheekbone),
    pt(targetLms, LM.rightCheekbone),
  );
  f.cheekboneProminence = clamp(cheekSpan / faceW);

  f.faceRoundness = clamp(1 - Math.abs(faceW / faceH - 0.78) / 0.4);

  f.masculine = clamp(
    0.35 * f.jawWidth +
      0.2 * f.noseLength +
      0.15 * (1 - f.lipFullness) +
      0.15 * (1 - f.eyeOpenness) +
      0.15 * f.browHeight,
  );
  f.feminine = clamp(1 - f.masculine * 0.85 + 0.15 * f.lipFullness);

  f.youthfulness = clamp(
    0.3 * f.eyeOpenness +
      0.25 * f.lipFullness +
      0.25 * f.faceRoundness +
      0.2 * (1 - f.jawWidth),
  );

  f.anatomical = extractAnatomicalFeatures(targetLms);

  return f;
}

function pt68(
  landmarks: Array<{ x: number; y: number; z?: number }>,
  i: number,
): { x: number; y: number; z?: number } {
  const p = landmarks[i];
  if (!p) return { x: 0.5, y: 0.5 };
  return p;
}

/**
 * Extract a normalized FaceFeatures vector from 68-point face landmarks.
 * Computes scale-invariant ratios for face aspect, jaw width, chin sharpness,
 * eye spacing, nose length/width, and mouth width/lip fullness.
 */
export function extractGeometryFeatures68(
  landmarks: Array<{ x: number; y: number }>,
): FaceFeatures {
  const f = emptyFeatures();
  if (!landmarks || landmarks.length < 68) return f;

  const lms68 = landmarks.slice(0, 68);
  const alignment = alignToCanonical3D(lms68);
  const targetLms = alignment.unwarpedLandmarks.length === 68
    ? alignment.unwarpedLandmarks
    : lms68;

  const chin = pt68(targetLms, 8);
  const leftCheek = pt68(targetLms, 0);
  const rightCheek = pt68(targetLms, 16);
  const browMid = mid(pt68(targetLms, 21), pt68(targetLms, 22));

  const faceW = Math.max(dist(leftCheek, rightCheek), 1e-6);
  const faceH = Math.max(dist(browMid, chin) * 1.35, 1e-6);

  f.faceAspect = clamp(faceW / faceH / 1.35);

  const jawW = dist(pt68(targetLms, 4), pt68(targetLms, 12));
  f.jawWidth = clamp(jawW / faceW);

  const jawMid = mid(pt68(targetLms, 4), pt68(targetLms, 12));
  const chinDrop = dist(jawMid, chin) / faceH;
  f.chinSharpness = clamp(chinDrop / 0.28);

  const noseBridge = pt68(targetLms, 27);
  f.foreheadHeight = clamp(dist(noseBridge, browMid) / faceH / 0.35);

  const lOuter = pt68(targetLms, 36);
  const lInner = pt68(targetLms, 39);
  const rInner = pt68(targetLms, 42);
  const rOuter = pt68(targetLms, 45);
  const leftEyeC = mid(lOuter, lInner);
  const rightEyeC = mid(rOuter, rInner);
  const iod = Math.max(dist(leftEyeC, rightEyeC), 1e-6);

  f.eyeSpacing = clamp(iod / faceW / 0.55);

  const lTop = mid(pt68(targetLms, 37), pt68(targetLms, 38));
  const lBottom = mid(pt68(targetLms, 40), pt68(targetLms, 41));
  const rTop = mid(pt68(targetLms, 43), pt68(targetLms, 44));
  const rBottom = mid(pt68(targetLms, 46), pt68(targetLms, 47));

  const leftOpen = dist(lTop, lBottom);
  const rightOpen = dist(rTop, rBottom);
  const leftWidth = Math.max(dist(lOuter, lInner), 1e-6);
  const rightWidth = Math.max(dist(rOuter, rInner), 1e-6);
  f.eyeOpenness = clamp(
    (leftOpen / leftWidth + rightOpen / rightWidth) / 2 / 0.45,
  );

  const leftSlant = (lOuter.y - lInner.y) / faceH;
  const rightSlant = (rOuter.y - rInner.y) / faceH;
  f.eyeSlant = clamp(0.5 + ((leftSlant - rightSlant) / 2) * 8);

  const leftBrow = mid(pt68(targetLms, 17), pt68(targetLms, 21));
  const rightBrow = mid(pt68(targetLms, 22), pt68(targetLms, 26));
  const browH =
    (dist(leftBrow, leftEyeC) + dist(rightBrow, rightEyeC)) / 2 / faceH;
  f.browHeight = clamp(browH / 0.12);

  const noseTip = pt68(targetLms, 30);
  f.noseLength = clamp(dist(noseBridge, noseTip) / faceH / 0.28);
  f.noseWidth = clamp(
    dist(pt68(targetLms, 31), pt68(targetLms, 35)) / faceW / 0.28,
  );

  const mouthL = pt68(targetLms, 48);
  const mouthR = pt68(targetLms, 54);
  f.mouthWidth = clamp(dist(mouthL, mouthR) / faceW / 0.45);
  const lipGap = dist(pt68(targetLms, 51), pt68(targetLms, 57));
  f.lipFullness = clamp(lipGap / faceH / 0.08);

  const cheekSpan = dist(pt68(targetLms, 1), pt68(targetLms, 15));
  f.cheekboneProminence = clamp(cheekSpan / faceW);

  f.faceRoundness = clamp(1 - Math.abs(faceW / faceH - 0.78) / 0.4);

  f.masculine = clamp(
    0.35 * f.jawWidth +
      0.2 * f.noseLength +
      0.15 * (1 - f.lipFullness) +
      0.15 * (1 - f.eyeOpenness) +
      0.15 * f.browHeight,
  );
  f.feminine = clamp(1 - f.masculine * 0.85 + 0.15 * f.lipFullness);

  f.youthfulness = clamp(
    0.3 * f.eyeOpenness +
      0.25 * f.lipFullness +
      0.25 * f.faceRoundness +
      0.2 * (1 - f.jawWidth),
  );

  f.anatomical = extractAnatomicalFeatures68(targetLms);

  return f;
}

/** Specialized feature weights for morphological distance D_morph calculation. */
export const MORPH_FEATURE_WEIGHTS: Record<FeatureKey, number> = {
  // Facial Structural Shape (Skull & Aspect)
  faceAspect: 1.5,
  jawWidth: 1.2,
  chinSharpness: 1.0,
  foreheadHeight: 0.8,
  cheekboneProminence: 1.4,
  faceRoundness: 1.3,

  // Eye Morphology
  eyeSpacing: 3.0,
  eyeSlant: 5.0,
  eyeOpenness: 1.1,
  browHeight: 0.7,

  // Nose Contour
  noseLength: 1.3,
  noseWidth: 2.5,

  // Mouth & Lips
  mouthWidth: 0.8,
  lipFullness: 1.2,

  // Complexion & Skin CIELAB
  skinL: 3.5,
  skinA: 1.5,
  skinB: 1.5,

  // Hair CIELAB
  hairL: 0.5,
  hairA: 0.5,
  hairB: 0.5,

  // Demographic Attributes
  masculine: 1.8,
  feminine: 1.8,
  youthfulness: 1.1,
};

/**
 * Sanitize feature object, ensuring all feature properties are finite numbers in [0.0, 1.0].
 * Replaces NaN, Infinity, or missing/invalid numbers with default fallback (0.50).
 */
export function sanitizeFeatures(f?: FaceFeatures | null): FaceFeatures | null {
  if (!f) return null;
  const keys: FeatureKey[] = [
    "faceAspect", "jawWidth", "chinSharpness", "foreheadHeight",
    "eyeSpacing", "eyeOpenness", "eyeSlant", "browHeight",
    "noseLength", "noseWidth", "mouthWidth", "lipFullness",
    "cheekboneProminence", "faceRoundness",
    "skinL", "skinA", "skinB", "hairL", "hairA", "hairB",
    "masculine", "feminine", "youthfulness",
  ];
  const sanitized = { ...f };
  for (const k of keys) {
    const val = f[k];
    sanitized[k] = typeof val === "number" && Number.isFinite(val)
      ? Math.max(0.0, Math.min(1.0, val))
      : 0.50;
  }
  return sanitized;
}

/**
 * Ensure FaceFeatures or Partial contains valid ExtendedAnatomicalFeatures (R5).
 * Derives missing 9 clinical proportions from scalar features if anatomical is omitted.
 */
export function ensureAnatomicalFeatures(f?: FaceFeatures | null): ExtendedAnatomicalFeatures {
  if (!f) return { ...CANONICAL_ANATOMICAL_DEFAULTS, lateralFifthsRatios: [...CANONICAL_ANATOMICAL_DEFAULTS.lateralFifthsRatios] };
  if (f.anatomical) return f.anatomical;

  const upperThirdRatio = clampNum(0.3333 * (0.8 + 0.4 * (f.foreheadHeight ?? 0.5)), 0.05, 0.70, 0.3333);
  const middleThirdRatio = clampNum(0.3333 * (0.8 + 0.4 * (f.noseLength ?? 0.5)), 0.05, 0.70, 0.3333);
  const lowerThirdRatio = clampNum(1.0 - upperThirdRatio - middleThirdRatio, 0.05, 0.70, 0.3333);

  const canthalTiltAngleDeg = clampNum(((f.eyeSlant ?? 0.5) - 0.50) * 30.0 + 4.0, -35.0, 35.0, 4.0);
  const nasalIndex = clampNum(((f.noseWidth ?? 0.5) / Math.max(0.1, f.noseLength ?? 0.5)) * 0.75, 0.20, 2.0, 0.75);
  const gonialJawlineAngleDeg = clampNum(124.0 + (0.50 - (f.chinSharpness ?? 0.5)) * 25.0 + ((f.jawWidth ?? 0.5) - 0.50) * 15.0, 70.0, 160.0, 124.0);

  const interCanthalDistance = clampNum((f.eyeSpacing ?? 0.5) * 0.42, 0.05, 0.65, 0.21);
  const bigonialToBizygomaticRatio = clampNum(0.76 * ((f.jawWidth ?? 0.5) / Math.max(0.1, f.cheekboneProminence ?? 0.5)), 0.30, 1.20, 0.76);
  const lipVermilionHeightRatio = clampNum(0.625 * ((f.lipFullness ?? 0.5) / 0.50), 0.10, 3.0, 0.625);
  const philtrumDepth = clampNum(0.50 * ((f.noseLength ?? 0.5) / 0.50), 0.10, 2.0, 0.50);

  return {
    upperThirdRatio,
    middleThirdRatio,
    lowerThirdRatio,
    lateralFifthsRatios: [0.20, 0.20, 0.20, 0.20, 0.20],
    interCanthalDistance,
    canthalTiltAngleDeg,
    nasalIndex,
    bigonialToBizygomaticRatio,
    gonialJawlineAngleDeg,
    lipVermilionHeightRatio,
    philtrumDepth,
  };
}

/**
 * Calculate 3D canonical unwarped clinical morphological distance D_morph in [0, 1] (R5).
 * Evaluates the 4 core anatomical metrics:
 * 1. Facial Thirds (Upper, Middle, Lower ratios)
 * 2. Canthal Tilt angle (palpebral fissure slant in degrees)
 * 3. Gonial Jawline angle (mandibular corner angle in degrees)
 * 4. Nasal Index (alar breadth vs nasal height ratio)
 *
 * Fallback to 0.50 when landmark points or features are missing/undefined.
 */
export function computeMorphologicalDistance(
  uFeatRaw?: FaceFeatures | ExtendedAnatomicalFeatures | null,
  cFeatRaw?: FaceFeatures | ExtendedAnatomicalFeatures | null,
  occ?: { eyeConf?: number; jawConf?: number } | null,
): number {
  if (!uFeatRaw || !cFeatRaw) return 0.50;

  const uAnat: ExtendedAnatomicalFeatures | undefined =
    "upperThirdRatio" in uFeatRaw ? uFeatRaw : uFeatRaw.anatomical ?? (uFeatRaw ? ensureAnatomicalFeatures(uFeatRaw) : undefined);
  const cAnat: ExtendedAnatomicalFeatures | undefined =
    "upperThirdRatio" in cFeatRaw ? cFeatRaw : cFeatRaw.anatomical ?? (cFeatRaw ? ensureAnatomicalFeatures(cFeatRaw) : undefined);

  if (!uAnat || !cAnat) return 0.50;

  const eyeConf = occ?.eyeConf ?? 1;
  const jawConf = occ?.jawConf ?? 1;
  if (eyeConf < 0.35 && jawConf < 0.35) return 0.50;

  const dUpperMid =
    Math.abs(uAnat.upperThirdRatio - cAnat.upperThirdRatio) +
    Math.abs(uAnat.middleThirdRatio - cAnat.middleThirdRatio);
  const dLower = Math.abs(uAnat.lowerThirdRatio - cAnat.lowerThirdRatio);
  const dThirds = Math.min(1.0, (dUpperMid + dLower * jawConf) / 0.30);

  const dCanthal = Math.min(
    1.0,
    Math.abs(uAnat.canthalTiltAngleDeg - cAnat.canthalTiltAngleDeg) / 15.0,
  );

  const dGonial = Math.min(
    1.0,
    Math.abs(uAnat.gonialJawlineAngleDeg - cAnat.gonialJawlineAngleDeg) / 25.0,
  );

  const dNasal = Math.min(
    1.0,
    Math.abs(uAnat.nasalIndex - cAnat.nasalIndex) / 0.35,
  );

  let wThirds = 0.30;
  let wCanthal = 0.25 * eyeConf;
  let wGonial = 0.25 * jawConf;
  let wNasal = 0.20;
  const wSum = wThirds + wCanthal + wGonial + wNasal;
  if (wSum < 1e-6) return 0.50;
  wThirds /= wSum;
  wCanthal /= wSum;
  wGonial /= wSum;
  wNasal /= wSum;

  const dMorph = wThirds * dThirds + wCanthal * dCanthal + wGonial * dGonial + wNasal * dNasal;
  return Number.isFinite(dMorph) ? Math.min(1.0, Math.max(0.0, dMorph)) : 0.50;
}

/** Alias for computeMorphologicalDistance */
export const computeClinicalMorphDistance = computeMorphologicalDistance;

/**
 * Calculate structural morphological distance D_morph between two facial feature sets.
 * Returns normalized distance in [0, 1]. Returns 0.50 if either feature set is missing.
 */
export function morphologicalDistance(
  uFeatRaw?: FaceFeatures | null,
  cFeatRaw?: FaceFeatures | null,
  opts?: { muteHair?: boolean },
): number {
  if (!uFeatRaw || !cFeatRaw) return 0.50;

  const uFeat = sanitizeFeatures(uFeatRaw);
  const cFeat = sanitizeFeatures(cFeatRaw);
  if (!uFeat || !cFeat) return 0.50;

  const scaleFactor = 4.50;

  // 1. Eye shape & slant (weight sum = 9.1)
  const dEyes = Math.min(1.0, (
    5.0 * Math.abs(uFeat.eyeSlant - cFeat.eyeSlant) +
    3.0 * Math.abs(uFeat.eyeSpacing - cFeat.eyeSpacing) +
    1.1 * Math.abs(uFeat.eyeOpenness - cFeat.eyeOpenness)
  ) * (scaleFactor / 9.1));

  // 2. Cheekbones & face shape (weight sum = 5.0)
  const dShape = Math.min(1.0, (
    1.4 * Math.abs(uFeat.cheekboneProminence - cFeat.cheekboneProminence) +
    1.3 * Math.abs(uFeat.faceRoundness - cFeat.faceRoundness) +
    1.5 * Math.abs(uFeat.faceAspect - cFeat.faceAspect) +
    0.8 * Math.abs(uFeat.foreheadHeight - cFeat.foreheadHeight)
  ) * (scaleFactor / 5.0));

  // 3. Nose bridge & contour (weight sum = 3.8)
  const dNose = Math.min(1.0, (
    1.3 * Math.abs(uFeat.noseLength - cFeat.noseLength) +
    2.5 * Math.abs(uFeat.noseWidth - cFeat.noseWidth)
  ) * (scaleFactor / 3.8));

  // 4. Jawline & chin (weight sum = 4.9)
  const dJaw = Math.min(1.0, (
    1.2 * Math.abs(uFeat.jawWidth - cFeat.jawWidth) +
    1.0 * Math.abs(uFeat.chinSharpness - cFeat.chinSharpness) +
    0.8 * Math.abs(uFeat.mouthWidth - cFeat.mouthWidth) +
    1.2 * Math.abs(uFeat.lipFullness - cFeat.lipFullness) +
    0.7 * Math.abs(uFeat.browHeight - cFeat.browHeight)
  ) * (scaleFactor / 4.9));

  // 5. Complexion & Hair (CIELAB 3D Euclidean distance normalized)
  const dSkinRaw = Math.hypot(
    uFeat.skinL - cFeat.skinL,
    uFeat.skinA - cFeat.skinA,
    uFeat.skinB - cFeat.skinB,
  );
  const dSkin = Math.min(1.0, (dSkinRaw / 0.48) * 3.50);

  const dHairRaw = Math.hypot(
    uFeat.hairL - cFeat.hairL,
    uFeat.hairA - cFeat.hairA,
    uFeat.hairB - cFeat.hairB,
  );
  const dHair = opts?.muteHair ? 0 : Math.min(1.0, (dHairRaw / 0.48) * 0.50);

  const dColor = 0.85 * dSkin + 0.15 * dHair;

  // 6. Demographic traits (weight sum = 4.7)
  const dDemo = Math.min(1.0, (
    1.8 * Math.abs(uFeat.masculine - cFeat.masculine) +
    1.8 * Math.abs(uFeat.feminine - cFeat.feminine) +
    1.1 * Math.abs(uFeat.youthfulness - cFeat.youthfulness)
  ) * (scaleFactor / 4.7));

  // Master morphological distance
  const rem = (1.0 - 0.20 - 0.05) / 4; // 0.1875
  const dMorph =
    rem * dEyes +
    rem * dShape +
    rem * dNose +
    rem * dJaw +
    0.20 * dColor +
    0.05 * dDemo;

  const res = Math.min(1.0, Math.max(0.0, dMorph));
  return Number.isFinite(res) ? res : 0.50;
}

/**
 * Calculate additive cross-demographic mismatch penalty when D_morph > 0.35 or ethnic clusters differ.
 * Returns 0.0 for D_morph <= 0.35 within same cluster, and min(0.25, max(0.15, 0.50 * (D_morph - 0.35))) for cross-demographic mismatch.
 * Accepts either pre-calculated D_morph scalar or user/celeb feature objects and optional cluster labels.
 */
export function crossDemographicMismatchPenalty(
  uFeatOrDistance?: FaceFeatures | number | null,
  cFeat?: FaceFeatures | null,
  uCluster?: string | null,
  cCluster?: string | null,
): number {
  if (uFeatOrDistance === null || uFeatOrDistance === undefined) return 0.0;
  let dMorph: number;
  if (typeof uFeatOrDistance === "number") {
    if (!Number.isFinite(uFeatOrDistance)) return 0.0;
    dMorph = uFeatOrDistance;
  } else {
    if (cFeat === null || cFeat === undefined) return 0.0;
    dMorph = morphologicalDistance(uFeatOrDistance, cFeat);
  }

  if (uCluster && cCluster && uCluster !== cCluster) {
    const penaltyFromCluster = !Number.isFinite(dMorph) || dMorph <= 0.35
      ? 0.22
      : Math.min(0.25, Math.max(0.22, 0.50 * (dMorph - 0.35)));
    return Math.round(penaltyFromCluster * 1e6) / 1e6;
  }

  if (!Number.isFinite(dMorph) || dMorph <= 0.35) return 0.0;
  const rawPenalty = Math.min(0.25, Math.max(0.0, 0.50 * (dMorph - 0.35)));
  return Math.round(rawPenalty * 1e6) / 1e6;
}

/**
 * Structural morphological affinity score in [0.0, 1.0].
 * Returns clamp(1.0 - D_morph, 0, 1). Returns 0.50 if either feature vector is missing.
 */
export function morphologicalAffinity(
  userFeatures?: FaceFeatures | null,
  celebFeatures?: FaceFeatures | null,
): number {
  if (!userFeatures || !celebFeatures) return 0.5;
  const dMorph = morphologicalDistance(userFeatures, celebFeatures);
  return Math.min(1.0, Math.max(0.0, 1.0 - dMorph));
}

/**
 * Calculate landmark geometric affinity score between user and celebrity face features.
 * Legacy geomAffinity alias mapping directly to morphologicalAffinity.
 * Returns normalized score in [0, 1]. Returns 0.5 if either feature vector is missing.
 */
export function geomAffinity(
  userFeatures?: FaceFeatures | null,
  celebFeatures?: FaceFeatures | null,
): number {
  return morphologicalAffinity(userFeatures, celebFeatures);
}

/**
 * Sample average color from a region of an ImageData (normalized coords).
 */
export function sampleRegionColor(
  imageData: ImageData,
  cx: number,
  cy: number,
  radiusPx: number,
): { r: number; g: number; b: number } {
  const { width, height, data } = imageData;
  const x0 = Math.max(0, Math.floor(cx * width - radiusPx));
  const x1 = Math.min(width - 1, Math.ceil(cx * width + radiusPx));
  const y0 = Math.max(0, Math.floor(cy * height - radiusPx));
  const y1 = Math.min(height - 1, Math.ceil(cy * height + radiusPx));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      const pr = data[i] ?? 0;
      const pg = data[i + 1] ?? 0;
      const pb = data[i + 2] ?? 0;
      const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
      if (lum < 18 || lum > 245) continue;
      r += pr;
      g += pg;
      b += pb;
      n++;
    }
  }
  if (n === 0) return { r: 180, g: 140, b: 120 };
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Enrich geometric features with skin + hair color sampled from the image.
 * MediaPipe 468/478 path only (≥400 landmarks).
 */
export function enrichWithColor(
  features: FaceFeatures,
  landmarks: Landmark[],
  imageData: ImageData,
): FaceFeatures {
  if (landmarks.length < 400) return features;

  const leftCheek = pt(landmarks, LM.leftCheekbone);
  const rightCheek = pt(landmarks, LM.rightCheekbone);
  const forehead = pt(landmarks, LM.forehead);
  const nose = pt(landmarks, LM.noseBridge);

  const samples = [
    sampleRegionColor(imageData, leftCheek.x, leftCheek.y, 6),
    sampleRegionColor(imageData, rightCheek.x, rightCheek.y, 6),
    sampleRegionColor(
      imageData,
      (forehead.x + nose.x) / 2,
      (forehead.y + nose.y) / 2,
      5,
    ),
  ];
  const skin = {
    r: samples.reduce((s, c) => s + c.r, 0) / samples.length,
    g: samples.reduce((s, c) => s + c.g, 0) / samples.length,
    b: samples.reduce((s, c) => s + c.b, 0) / samples.length,
  };
  const skinLab = rgbToApproxLab(skin.r, skin.g, skin.b);

  const hairY = Math.max(0.02, forehead.y - 0.08);
  const hair = sampleRegionColor(imageData, forehead.x, hairY, 8);
  const hairLab = rgbToApproxLab(hair.r, hair.g, hair.b);

  return {
    ...features,
    skinL: skinLab.L,
    skinA: skinLab.a,
    skinB: skinLab.b,
    hairL: hairLab.L,
    hairA: hairLab.a,
    hairB: hairLab.b,
  };
}

/**
 * Normalize 68-pt landmarks to unit [0,1] for image sampling.
 * ≤1.5 → already unit; ≤100 → percent; else pixels vs image size.
 */
function landmarks68ToUnit(
  landmarks68: Array<{ x: number; y: number }>,
  imageW: number,
  imageH: number,
): Array<{ x: number; y: number }> {
  let maxC = 0;
  for (const p of landmarks68) {
    if (p.x > maxC) maxC = p.x;
    if (p.y > maxC) maxC = p.y;
  }
  if (maxC <= 1.5) {
    return landmarks68.map((p) => ({ x: p.x, y: p.y }));
  }
  if (maxC <= 100) {
    return landmarks68.map((p) => ({ x: p.x / 100, y: p.y / 100 }));
  }
  const iw = Math.max(1, imageW - 1);
  const ih = Math.max(1, imageH - 1);
  return landmarks68.map((p) => ({ x: p.x / iw, y: p.y / ih }));
}

/**
 * Enrich FaceFeatures with skin + hair color from 68-point landmarks + face crop.
 * Cheeks at 1 & 15; mid-skin along mid(21,22)→27; hair above brow min-y − 0.08.
 */
export function enrichWithColor68(
  features: FaceFeatures,
  landmarks68: Array<{ x: number; y: number }>,
  imageData: ImageData | { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
): FaceFeatures {
  if (!landmarks68 || landmarks68.length < 68) return features;
  if (!imageData || imageData.width < 4 || imageData.height < 4) return features;

  const img = imageData as ImageData;
  const unit = landmarks68ToUnit(landmarks68, img.width, img.height);

  const leftCheek = unit[1]!;
  const rightCheek = unit[15]!;
  const browL = unit[21]!;
  const browR = unit[22]!;
  const browMid = mid(browL, browR);
  const noseBridge = unit[27]!;
  // Mid skin: halfway from brow mid toward nose bridge (27).
  const midSkin = {
    x: browMid.x + 0.5 * (noseBridge.x - browMid.x),
    y: browMid.y + 0.5 * (noseBridge.y - browMid.y),
  };

  const samples = [
    sampleRegionColor(img, leftCheek.x, leftCheek.y, 6),
    sampleRegionColor(img, rightCheek.x, rightCheek.y, 6),
    sampleRegionColor(img, midSkin.x, midSkin.y, 5),
  ];
  const skin = {
    r: samples.reduce((s, c) => s + c.r, 0) / samples.length,
    g: samples.reduce((s, c) => s + c.g, 0) / samples.length,
    b: samples.reduce((s, c) => s + c.b, 0) / samples.length,
  };
  const skinLab = rgbToApproxLab(skin.r, skin.g, skin.b);

  let minBrowY = Infinity;
  for (let i = 17; i <= 26; i++) {
    const by = unit[i]!.y;
    if (by < minBrowY) minBrowY = by;
  }
  const hairY = Math.max(0.02, minBrowY - 0.08);
  const hair = sampleRegionColor(img, browMid.x, hairY, 8);
  const hairLab = rgbToApproxLab(hair.r, hair.g, hair.b);

  return {
    ...features,
    skinL: skinLab.L,
    skinA: skinLab.a,
    skinB: skinLab.b,
    hairL: hairLab.L,
    hairA: hairLab.a,
    hairB: hairLab.b,
  };
}

/**
 * Face quality gates — reject tiny, off-center, or partial faces.
 */
export function assessQuality(
  landmarks: Landmark[],
  imageWidth: number,
  imageHeight: number,
): {
  ok: boolean;
  score: number;
  faceCoverage: number;
  centered: number;
  issues: string[];
} {
  const issues: string[] = [];
  if (landmarks.length < 400) {
    return {
      ok: false,
      score: 0,
      faceCoverage: 0,
      centered: 0,
      issues: ["No face detected. Try a clearer front-facing photo."],
    };
  }

  const chin = pt(landmarks, LM.chin);
  const forehead = pt(landmarks, LM.forehead);
  const leftCheek = pt(landmarks, LM.leftCheek);
  const rightCheek = pt(landmarks, LM.rightCheek);

  const faceH = Math.abs(chin.y - forehead.y);
  const faceW = Math.abs(rightCheek.x - leftCheek.x);
  const faceCoverage = Math.min(1, (faceH * faceW) / 0.12);

  if (faceH < 0.18)
    issues.push("Face is too small — move closer or crop tighter.");
  if (faceH > 0.95)
    issues.push("Face is cropped — leave a little space around your head.");

  const cx = (leftCheek.x + rightCheek.x) / 2;
  const cy = (forehead.y + chin.y) / 2;
  const centered = clamp(1 - Math.hypot(cx - 0.5, cy - 0.5) / 0.45);
  if (centered < 0.45) issues.push("Center your face in the frame.");

  const leftEye = mid(
    pt(landmarks, LM.leftEyeOuter),
    pt(landmarks, LM.leftEyeInner),
  );
  const rightEye = mid(
    pt(landmarks, LM.rightEyeOuter),
    pt(landmarks, LM.rightEyeInner),
  );
  const iod = dist(leftEye, rightEye);
  if (iod < 0.08) issues.push("Turn to face the camera more directly.");

  void imageWidth;
  void imageHeight;

  const score = clamp(
    0.45 * clamp(faceH / 0.35) + 0.3 * centered + 0.25 * clamp(iod / 0.18),
  );

  return {
    ok: issues.length === 0 && score >= 0.4,
    score,
    faceCoverage: clamp(faceCoverage),
    centered,
    issues,
  };
}

/**
 * Strict structural validation of 68-point facial landmarks to reject non-face textures (e.g. clouds, sunset, trees).
 * Returns true only if landmarks conform to valid human facial morphology.
 */
export function isValidHumanFaceLandmarks68(
  landmarks: Array<{ x: number; y: number }>,
  boundsWidth = 100,
  boundsHeight = 100,
): boolean {
  if (!landmarks || landmarks.length < 68) return false;

  const pt = (i: number) => landmarks[i] ?? { x: boundsWidth / 2, y: boundsHeight / 2 };

  // 1. Eye centers
  const lEyeX = (pt(36).x + pt(39).x) / 2;
  const lEyeY = (pt(36).y + pt(39).y) / 2;
  const rEyeX = (pt(42).x + pt(45).x) / 2;
  const rEyeY = (pt(42).y + pt(45).y) / 2;

  const eyeMidX = (lEyeX + rEyeX) / 2;
  const eyeMidY = (lEyeY + rEyeY) / 2;

  const iod = Math.hypot(rEyeX - lEyeX, rEyeY - lEyeY);
  // Inter-ocular distance must be at least 4% of crop size (or 1.0% of full image frame)
  const minIod = (boundsWidth === 100 && boundsHeight === 100) ? 1.0 : Math.min(boundsWidth, boundsHeight) * 0.04;
  if (iod < minIod) return false;

  // 2. Nose & Mouth
  const noseX = pt(30).x;
  const noseY = pt(30).y;
  const mouthX = (pt(48).x + pt(54).x) / 2;
  const mouthY = (pt(48).y + pt(54).y) / 2;
  const chinY = pt(8).y;

  // 3. Strict Vertical Order: Eyes MUST be above Nose, Nose MUST be above Mouth, Mouth MUST be above Chin
  if (!(eyeMidY < noseY && noseY < mouthY && mouthY < chinY)) return false;

  // 4. Horizontal Eye Level: Eyes must be roughly level (not tilted vertically > 70% of IOD)
  if (Math.abs(lEyeY - rEyeY) > iod * 0.7) return false;

  // 5. Nose Alignment: Nose tip x must be between eyes (with reasonable margin)
  const minX = Math.min(lEyeX, rEyeX) - iod * 0.4;
  const maxX = Math.max(lEyeX, rEyeX) + iod * 0.4;
  if (noseX < minX || noseX > maxX) return false;

  // 6. Landmark Bounding Box Coverage & Aspect Ratio
  let minLx = Infinity, maxLx = -Infinity, minLy = Infinity, maxLy = -Infinity;
  for (const p of landmarks) {
    if (p.x < minLx) minLx = p.x;
    if (p.x > maxLx) maxLx = p.x;
    if (p.y < minLy) minLy = p.y;
    if (p.y > maxLy) maxLy = p.y;
  }
  const lmWidth = Math.max(1e-5, maxLx - minLx);
  const lmHeight = Math.max(1e-5, maxLy - minLy);
  const lmCoverage = (lmWidth * lmHeight) / Math.max(1, boundsWidth * boundsHeight);
  const minLmCoverage = (boundsWidth === 100 && boundsHeight === 100) ? 0.005 : 0.03;
  if (lmCoverage < minLmCoverage || lmCoverage > 0.96) return false;

  const lmAspect = lmWidth / lmHeight;
  if (lmAspect < 0.5 || lmAspect > 2.0) return false;

  // 7. Bilateral Eye & Jaw Symmetry
  const dLeftEyeNose = Math.hypot(lEyeX - noseX, lEyeY - noseY);
  const dRightEyeNose = Math.hypot(rEyeX - noseX, rEyeY - noseY);
  const eyeSym = dLeftEyeNose / Math.max(1e-5, dRightEyeNose);
  if (eyeSym < 0.35 || eyeSym > 2.8) return false;

  const dLeftJaw = Math.hypot(pt(0).x - noseX, pt(0).y - noseY);
  const dRightJaw = Math.hypot(pt(16).x - noseX, pt(16).y - noseY);
  const jawSym = dLeftJaw / Math.max(1e-5, dRightJaw);
  if (jawSym < 0.35 || jawSym > 2.8) return false;

  // 8. Vertical Golden Ratio Feature Proportions
  const eyeToNose = Math.abs(noseY - eyeMidY);
  const noseToMouth = Math.abs(mouthY - noseY);
  const goldenRatio = eyeToNose / Math.max(1e-5, noseToMouth);
  if (goldenRatio < 0.35 || goldenRatio > 2.8) return false;

  // 9. Eye-to-mouth vs IOD proportion check
  const emd = Math.hypot(mouthX - eyeMidX, mouthY - eyeMidY);
  const emdRatio = emd / Math.max(1e-5, iod);
  if (emdRatio < 0.45 - 1e-9 || emdRatio > 2.50 + 1e-9) return false;

  return true;
}

