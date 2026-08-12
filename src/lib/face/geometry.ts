import type { FaceFeatures } from "./types.ts";
import { clamp, dist, mid, emptyFeatures, rgbToApproxLab, ensembleScore } from "./math.ts";

/** MediaPipe Face Landmarker landmark (normalized image coords). */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
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

function pt(landmarks: Landmark[], i: number): Landmark {
  const p = landmarks[i];
  if (!p) return { x: 0.5, y: 0.5 };
  return p;
}

/**
 * Extract a normalized FaceFeatures vector from MediaPipe face landmarks.
 * All ratios are scale-invariant (relative to inter-ocular or face height).
 */
export function extractGeometryFeatures(landmarks: Landmark[]): FaceFeatures {
  const f = emptyFeatures();
  if (landmarks.length < 400) return f;

  const chin = pt(landmarks, LM.chin);
  const forehead = pt(landmarks, LM.forehead);
  const leftCheek = pt(landmarks, LM.leftCheek);
  const rightCheek = pt(landmarks, LM.rightCheek);

  const faceH = Math.max(dist(forehead, chin), 1e-6);
  const faceW = Math.max(dist(leftCheek, rightCheek), 1e-6);

  f.faceAspect = clamp(faceW / faceH / 1.35);

  const jawW = dist(pt(landmarks, LM.jawLeft), pt(landmarks, LM.jawRight));
  f.jawWidth = clamp(jawW / faceW);

  const jawMid = mid(pt(landmarks, LM.jawLeft), pt(landmarks, LM.jawRight));
  const chinDrop = dist(jawMid, chin) / faceH;
  f.chinSharpness = clamp(chinDrop / 0.28);

  const browMid = mid(
    pt(landmarks, LM.leftBrowInner),
    pt(landmarks, LM.rightBrowInner),
  );
  f.foreheadHeight = clamp(dist(forehead, browMid) / faceH / 0.35);

  const lOuter = pt(landmarks, LM.leftEyeOuter);
  const lInner = pt(landmarks, LM.leftEyeInner);
  const rOuter = pt(landmarks, LM.rightEyeOuter);
  const rInner = pt(landmarks, LM.rightEyeInner);
  const leftEyeC = mid(lOuter, lInner);
  const rightEyeC = mid(rOuter, rInner);
  const iod = Math.max(dist(leftEyeC, rightEyeC), 1e-6);

  f.eyeSpacing = clamp(iod / faceW / 0.55);

  const leftOpen = dist(
    pt(landmarks, LM.leftEyeTop),
    pt(landmarks, LM.leftEyeBottom),
  );
  const rightOpen = dist(
    pt(landmarks, LM.rightEyeTop),
    pt(landmarks, LM.rightEyeBottom),
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
    pt(landmarks, LM.leftBrowInner),
    pt(landmarks, LM.leftBrowOuter),
  );
  const rightBrow = mid(
    pt(landmarks, LM.rightBrowInner),
    pt(landmarks, LM.rightBrowOuter),
  );
  const browH =
    (dist(leftBrow, leftEyeC) + dist(rightBrow, rightEyeC)) / 2 / faceH;
  f.browHeight = clamp(browH / 0.12);

  const noseTip = pt(landmarks, LM.noseTip);
  const noseBridge = pt(landmarks, LM.noseBridge);
  f.noseLength = clamp(dist(noseBridge, noseTip) / faceH / 0.28);
  f.noseWidth = clamp(
    dist(pt(landmarks, LM.noseLeft), pt(landmarks, LM.noseRight)) /
      faceW /
      0.28,
  );

  const mouthL = pt(landmarks, LM.mouthLeft);
  const mouthR = pt(landmarks, LM.mouthRight);
  f.mouthWidth = clamp(dist(mouthL, mouthR) / faceW / 0.45);
  const lipGap = dist(pt(landmarks, LM.upperLip), pt(landmarks, LM.lowerLip));
  f.lipFullness = clamp(lipGap / faceH / 0.08);

  const cheekSpan = dist(
    pt(landmarks, LM.leftCheekbone),
    pt(landmarks, LM.rightCheekbone),
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

  return f;
}

function pt68(
  landmarks: Array<{ x: number; y: number }>,
  i: number,
): { x: number; y: number } {
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

  const chin = pt68(landmarks, 8);
  const leftCheek = pt68(landmarks, 0);
  const rightCheek = pt68(landmarks, 16);
  const browMid = mid(pt68(landmarks, 21), pt68(landmarks, 22));

  const faceW = Math.max(dist(leftCheek, rightCheek), 1e-6);
  const faceH = Math.max(dist(browMid, chin) * 1.35, 1e-6);

  f.faceAspect = clamp(faceW / faceH / 1.35);

  const jawW = dist(pt68(landmarks, 4), pt68(landmarks, 12));
  f.jawWidth = clamp(jawW / faceW);

  const jawMid = mid(pt68(landmarks, 4), pt68(landmarks, 12));
  const chinDrop = dist(jawMid, chin) / faceH;
  f.chinSharpness = clamp(chinDrop / 0.28);

  const noseBridge = pt68(landmarks, 27);
  f.foreheadHeight = clamp(dist(noseBridge, browMid) / faceH / 0.35);

  const lOuter = pt68(landmarks, 36);
  const lInner = pt68(landmarks, 39);
  const rInner = pt68(landmarks, 42);
  const rOuter = pt68(landmarks, 45);
  const leftEyeC = mid(lOuter, lInner);
  const rightEyeC = mid(rOuter, rInner);
  const iod = Math.max(dist(leftEyeC, rightEyeC), 1e-6);

  f.eyeSpacing = clamp(iod / faceW / 0.55);

  const lTop = mid(pt68(landmarks, 37), pt68(landmarks, 38));
  const lBottom = mid(pt68(landmarks, 40), pt68(landmarks, 41));
  const rTop = mid(pt68(landmarks, 43), pt68(landmarks, 44));
  const rBottom = mid(pt68(landmarks, 46), pt68(landmarks, 47));

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

  const leftBrow = mid(pt68(landmarks, 17), pt68(landmarks, 21));
  const rightBrow = mid(pt68(landmarks, 22), pt68(landmarks, 26));
  const browH =
    (dist(leftBrow, leftEyeC) + dist(rightBrow, rightEyeC)) / 2 / faceH;
  f.browHeight = clamp(browH / 0.12);

  const noseTip = pt68(landmarks, 30);
  f.noseLength = clamp(dist(noseBridge, noseTip) / faceH / 0.28);
  f.noseWidth = clamp(
    dist(pt68(landmarks, 31), pt68(landmarks, 35)) / faceW / 0.28,
  );

  const mouthL = pt68(landmarks, 48);
  const mouthR = pt68(landmarks, 54);
  f.mouthWidth = clamp(dist(mouthL, mouthR) / faceW / 0.45);
  const lipGap = dist(pt68(landmarks, 51), pt68(landmarks, 57));
  f.lipFullness = clamp(lipGap / faceH / 0.08);

  const cheekSpan = dist(pt68(landmarks, 1), pt68(landmarks, 15));
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

  return f;
}

/**
 * Calculate landmark geometric affinity score between user and celebrity face features.
 * Returns normalized score in [0, 1]. Returns 0.5 if either feature vector is missing.
 */
export function geomAffinity(
  userFeatures?: FaceFeatures,
  celebFeatures?: FaceFeatures,
): number {
  if (!userFeatures || !celebFeatures) return 0.5;
  return ensembleScore(userFeatures, celebFeatures);
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

