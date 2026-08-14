/**
 * 3D Head Pose Estimation (Yaw, Pitch, Roll) & 3D Canonical Alignment.
 */

import type {
  Point2D,
  Point3D,
  Vector3D,
  Matrix3x3,
  CanonicalAlignmentResult,
} from "./types.ts";

export interface HeadPose {
  yawDeg: number;   // Left-right rotation (-90 to +90 degrees)
  pitchDeg: number; // Up-down tilt (-90 to +90 degrees)
  rollDeg: number;  // Side-to-side tilt (-90 to +90 degrees)
  poseScore: number;// Frontal alignment score in [0, 1] (1 = perfectly frontal)
}

interface Pt {
  x: number;
  y: number;
}

function midPt(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distPt(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Estimate 3D head pose from 68-point landmark array.
 * Works with normalized coordinates in [0, 1].
 */
export function estimateHeadPose68(landmarks: Pt[]): HeadPose {
  if (!landmarks || landmarks.length < 68) {
    return { yawDeg: 0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 };
  }

  const lEye = midPt(landmarks[36]!, landmarks[39]!);
  const rEye = midPt(landmarks[42]!, landmarks[45]!);
  const noseTip = landmarks[30]!;
  const chin = landmarks[8]!;
  const noseBridge = landmarks[27]!;

  if (
    !lEye || !Number.isFinite(lEye.x) || !Number.isFinite(lEye.y) ||
    !rEye || !Number.isFinite(rEye.x) || !Number.isFinite(rEye.y) ||
    !noseTip || !Number.isFinite(noseTip.x) || !Number.isFinite(noseTip.y) ||
    !chin || !Number.isFinite(chin.x) || !Number.isFinite(chin.y) ||
    !noseBridge || !Number.isFinite(noseBridge.x) || !Number.isFinite(noseBridge.y)
  ) {
    return { yawDeg: 0, pitchDeg: 0, rollDeg: 0, poseScore: 1.0 };
  }

  // 1. Roll angle: tilt of line connecting left and right eyes
  const dxEye = rEye.x - lEye.x;
  const dyEye = rEye.y - lEye.y;
  const rollRad = Math.atan2(dyEye, dxEye);
  const rollDeg = (rollRad * 180) / Math.PI;

  // 2. Yaw angle: asymmetry of nose tip relative to eye center
  const eyeCenter = midPt(lEye, rEye);
  const interOcularDist = Math.max(distPt(lEye, rEye), 1e-6);

  // Vector perpendicular to eye line
  const eyeVectorX = dxEye / interOcularDist;
  const eyeVectorY = dyEye / interOcularDist;

  // Projection of (noseTip - eyeCenter) onto eye line gives horizontal asymmetry
  const noseVectorX = noseTip.x - eyeCenter.x;
  const noseVectorY = noseTip.y - eyeCenter.y;
  const horizontalOffset = noseVectorX * eyeVectorX + noseVectorY * eyeVectorY;

  // Normalized yaw estimate
  const yawRatio = horizontalOffset / (interOcularDist * 0.5);
  const yawDeg = Math.min(85, Math.max(-85, yawRatio * 45));

  // 3. Pitch angle: vertical ratio of (noseBridge to noseTip) vs (noseTip to chin)
  const noseLen = distPt(noseBridge, noseTip);
  const lowerFaceLen = Math.max(distPt(noseTip, chin), 1e-6);
  const pitchRatio = noseLen / lowerFaceLen;
  // Expected frontal ratio is approx 0.52
  const pitchDeg = Math.min(60, Math.max(-60, (pitchRatio - 0.52) * 90));

  // 4. Pose score: 1.0 = perfectly frontal, decays with rotation
  const yawCost = Math.abs(yawDeg) / 45;
  const pitchCost = Math.abs(pitchDeg) / 40;
  const rollCost = Math.abs(rollDeg) / 30;
  const totalCost = Math.hypot(yawCost, pitchCost, rollCost);
  const poseScore = Math.max(0.1, Math.min(1.0, Math.exp(-totalCost * 0.8)));

  return {
    yawDeg: Math.round(yawDeg * 10) / 10,
    pitchDeg: Math.round(pitchDeg * 10) / 10,
    rollDeg: Math.round(rollDeg * 10) / 10,
    poseScore: Math.round(poseScore * 100) / 100,
  };
}

/**
 * Calculate dynamic landmark weight given head pose score.
 * Dampens landmark geometry influence when head is turned >15 degrees.
 */
export function getPoseAdaptiveLandmarkWeight(pose: HeadPose, baseWeight = 0.10): number {
  const yaw = pose && Number.isFinite(pose.yawDeg) ? pose.yawDeg : 0;
  const absYawRad = (Math.abs(yaw) * Math.PI) / 180;
  const factor = Math.max(0.2, Math.cos(absYawRad));
  return Math.round(baseWeight * factor * 1000) / 1000;
}

/**
 * Safely parse visibility mask element into a valid weight in [0, 1].
 * Handles boolean (true -> 1.0, false -> 0.0), numeric weights, undefined, null, NaN, Infinity.
 */
export function parseVisWeight(v: boolean | number | undefined | null): number {
  if (v === true) return 1.0;
  if (v === false) return 0.0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0.0;
    return Math.max(0.0, Math.min(1.0, v));
  }
  if (v === undefined || v === null) return 1.0;
  return 1.0;
}

/**
 * Standard 3D Mean Canonical Reference Face Mesh (68 landmarks).
 * Normalized millimeter coordinates centered at inter-ocular midpoint origin (0, 0, 0).
 */
export const CANONICAL_FACE_3D: Point3D[] = [
  // Jaw contour (0..16)
  { x: -72.0, y: -12.0, z: -32.0 },
  { x: -70.0, y: -24.0, z: -30.0 },
  { x: -68.0, y: -36.0, z: -28.0 },
  { x: -65.0, y: -48.0, z: -25.0 },
  { x: -60.0, y: -56.0, z: -38.0 },
  { x: -50.0, y: -66.0, z: -25.0 },
  { x: -36.0, y: -74.0, z: -18.0 },
  { x: -19.0, y: -78.0, z: -12.0 },
  { x: 0.0,   y: -80.0, z: -8.0  },
  { x: 19.0,  y: -78.0, z: -12.0 },
  { x: 36.0,  y: -74.0, z: -18.0 },
  { x: 50.0,  y: -66.0, z: -25.0 },
  { x: 60.0,  y: -56.0, z: -38.0 },
  { x: 65.0,  y: -48.0, z: -25.0 },
  { x: 68.0,  y: -36.0, z: -28.0 },
  { x: 70.0,  y: -24.0, z: -30.0 },
  { x: 72.0,  y: -12.0, z: -32.0 },

  // Eyebrows (17..26)
  { x: -48.0, y: 22.0,  z: -10.0 },
  { x: -40.0, y: 26.0,  z: -8.0  },
  { x: -30.0, y: 27.0,  z: -6.0  },
  { x: -20.0, y: 25.0,  z: -5.0  },
  { x: -10.0, y: 22.0,  z: -4.0  },
  { x: 10.0,  y: 22.0,  z: -4.0  },
  { x: 20.0,  y: 25.0,  z: -5.0  },
  { x: 30.0,  y: 27.0,  z: -6.0  },
  { x: 40.0,  y: 26.0,  z: -8.0  },
  { x: 48.0,  y: 22.0,  z: -10.0 },

  // Nose (27..35)
  { x: 0.0,   y: 12.0,  z: -2.0  },
  { x: 0.0,   y: 4.0,   z: 4.0   },
  { x: 0.0,   y: -5.0,  z: 14.0  },
  { x: 0.0,   y: -14.0, z: 24.0  },
  { x: -16.0, y: -22.0, z: 8.0   },
  { x: -8.0,  y: -24.0, z: 12.0  },
  { x: 0.0,   y: -24.0, z: 10.0  },
  { x: 8.0,   y: -24.0, z: 12.0  },
  { x: 16.0,  y: -22.0, z: 8.0   },

  // Left eye (36..41)
  { x: -45.0, y: 0.0,   z: -8.0  },
  { x: -38.0, y: 6.0,   z: -6.0  },
  { x: -24.0, y: 6.0,   z: -6.0  },
  { x: -15.0, y: 0.0,   z: -4.0  },
  { x: -24.0, y: -5.0,  z: -6.0  },
  { x: -38.0, y: -5.0,  z: -6.0  },

  // Right eye (42..47)
  { x: 15.0,  y: 0.0,   z: -4.0  },
  { x: 24.0,  y: 6.0,   z: -6.0  },
  { x: 38.0,  y: 6.0,   z: -6.0  },
  { x: 45.0,  y: 0.0,   z: -8.0  },
  { x: 38.0,  y: -5.0,  z: -6.0  },
  { x: 24.0,  y: -5.0,  z: -6.0  },

  // Mouth outer (48..59)
  { x: -26.0, y: -44.0, z: 4.0   },
  { x: -18.0, y: -38.0, z: 9.0   },
  { x: -9.0,  y: -36.0, z: 11.0  },
  { x: 0.0,   y: -38.0, z: 12.0  },
  { x: 9.0,   y: -36.0, z: 11.0  },
  { x: 18.0,  y: -38.0, z: 9.0   },
  { x: 26.0,  y: -44.0, z: 4.0   },
  { x: 18.0,  y: -52.0, z: 8.0   },
  { x: 9.0,   y: -54.0, z: 9.0   },
  { x: 0.0,   y: -50.0, z: 10.0  },
  { x: -9.0,  y: -54.0, z: 9.0   },
  { x: -18.0, y: -52.0, z: 8.0   },

  // Mouth inner (60..67)
  { x: -20.0, y: -44.0, z: 5.0   },
  { x: -9.0,  y: -40.0, z: 10.0  },
  { x: 0.0,   y: -40.0, z: 11.0  },
  { x: 9.0,   y: -40.0, z: 10.0  },
  { x: 20.0,  y: -44.0, z: 5.0   },
  { x: 9.0,   y: -48.0, z: 9.0   },
  { x: 0.0,   y: -46.0, z: 9.5   },
  { x: -9.0,  y: -48.0, z: 9.0   },
];

export const LANDMARK_MAP_68_TO_CANONICAL: number[] = Array.from(
  { length: 68 },
  (_, i) => i,
);

export const LANDMARK_MAP_MEDIAPIPE_TO_CANONICAL: Record<number, number> = {
  152: 8,  // chin
  10:  27, // forehead top -> sellion
  234: 0,  // left cheek outer
  454: 16, // right cheek outer
  33:  36, // left eye outer
  133: 39, // left eye inner
  159: 37, // left eye top
  145: 41, // left eye bottom
  263: 45, // right eye outer
  362: 42, // right eye inner
  386: 44, // right eye top
  374: 46, // right eye bottom
  107: 21, // left brow inner
  70:  17, // left brow outer
  336: 22, // right brow inner
  300: 26, // right brow outer
  1:   30, // nose tip
  6:   27, // nose bridge
  98:  31, // left alar
  327: 35, // right alar
  61:  48, // mouth left
  291: 54, // mouth right
  13:  51, // upper lip
  14:  57, // lower lip
  172: 4,  // jaw left
  397: 12, // jaw right
};

interface SVDResult3x3 {
  U: [[number, number, number], [number, number, number], [number, number, number]];
  S: [number, number, number];
  V: [[number, number, number], [number, number, number], [number, number, number]];
}

function svd3x3(H: [[number, number, number], [number, number, number], [number, number, number]]): SVDResult3x3 {
  const A: [[number, number, number], [number, number, number], [number, number, number]] = [
    [H[0][0], H[0][1], H[0][2]],
    [H[1][0], H[1][1], H[1][2]],
    [H[2][0], H[2][1], H[2][2]],
  ];

  const V: [[number, number, number], [number, number, number], [number, number, number]] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  const MAX_ITER = 15;
  const EPS = 1e-15;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;
    const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2]];

    for (const [p, q] of pairs) {
      let alpha = 0, beta = 0, gamma = 0;
      for (let r = 0; r < 3; r++) {
        alpha += A[r][p] * A[r][p];
        beta += A[r][q] * A[r][q];
        gamma += A[r][p] * A[r][q];
      }

      if (Math.abs(gamma) < EPS * Math.sqrt(alpha * beta + EPS)) {
        continue;
      }

      changed = true;
      const zeta = (beta - alpha) / (2 * gamma);
      const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;

      for (let r = 0; r < 3; r++) {
        const ap = A[r][p];
        const aq = A[r][q];
        A[r][p] = c * ap - s * aq;
        A[r][q] = s * ap + c * aq;

        const vp = V[r][p];
        const vq = V[r][q];
        V[r][p] = c * vp - s * vq;
        V[r][q] = s * vp + c * vq;
      }
    }

    if (!changed) break;
  }

  const singularValues: [number, number, number] = [0, 0, 0];
  const U: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let j = 0; j < 3; j++) {
    let normSq = 0;
    for (let r = 0; r < 3; r++) {
      normSq += A[r][j] * A[r][j];
    }
    const sigma = Math.sqrt(normSq);
    singularValues[j] = sigma;

    if (sigma > 1e-12) {
      for (let r = 0; r < 3; r++) {
        U[r][j] = A[r][j] / sigma;
      }
    }
  }

  // Gram-Schmidt column completion for U to ensure orthonormality and det(U) = +1.0
  let u0Norm = Math.hypot(U[0][0], U[1][0], U[2][0]);
  if (u0Norm > 1e-12) {
    U[0][0] /= u0Norm;
    U[1][0] /= u0Norm;
    U[2][0] /= u0Norm;
  } else {
    U[0][0] = 1; U[1][0] = 0; U[2][0] = 0;
  }

  let u1Norm = Math.hypot(U[0][1], U[1][1], U[2][1]);
  if (u1Norm > 1e-12) {
    const dot01 = U[0][0] * U[0][1] + U[1][0] * U[1][1] + U[2][0] * U[2][1];
    U[0][1] -= dot01 * U[0][0];
    U[1][1] -= dot01 * U[1][0];
    U[2][1] -= dot01 * U[2][0];
    u1Norm = Math.hypot(U[0][1], U[1][1], U[2][1]);
  }
  if (u1Norm > 1e-12) {
    U[0][1] /= u1Norm;
    U[1][1] /= u1Norm;
    U[2][1] /= u1Norm;
  } else {
    const vx = Math.abs(U[0][0]) < 0.8 ? 1 : 0;
    const vy = Math.abs(U[0][0]) < 0.8 ? 0 : 1;
    const vz = 0;
    const dot0v = U[0][0] * vx + U[1][0] * vy + U[2][0] * vz;
    const rx = vx - dot0v * U[0][0];
    const ry = vy - dot0v * U[1][0];
    const rz = vz - dot0v * U[2][0];
    const rNorm = Math.hypot(rx, ry, rz);
    U[0][1] = rx / rNorm;
    U[1][1] = ry / rNorm;
    U[2][1] = rz / rNorm;
  }

  U[0][2] = U[1][0] * U[2][1] - U[2][0] * U[1][1];
  U[1][2] = U[2][0] * U[0][1] - U[0][0] * U[2][1];
  U[2][2] = U[0][0] * U[1][1] - U[1][0] * U[0][1];

  const u2Norm = Math.hypot(U[0][2], U[1][2], U[2][2]);
  if (u2Norm > 1e-12) {
    U[0][2] /= u2Norm;
    U[1][2] /= u2Norm;
    U[2][2] /= u2Norm;
  } else {
    U[0][2] = 0; U[1][2] = 0; U[2][2] = 1;
  }

  return { U, S: singularValues, V };
}

function det3x3(M: [[number, number, number], [number, number, number], [number, number, number]]): number {
  return (
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  );
}

/**
 * Align 2D or 3D facial landmarks to 3D Canonical Reference Face Mesh via SVD Kabsch Generalized Procrustes Analysis.
 * Performs landmark unwarping mapping observed points back to frontal canonical plane.
 */
export function alignToCanonical3D(
  landmarks: Point2D[] | Point3D[],
  visibilityMask?: boolean[]
): CanonicalAlignmentResult {
  const N = landmarks ? landmarks.length : 0;
  if (!landmarks || N === 0) {
    return {
      rotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      translation: [0, 0, 0],
      scale: 1.0,
      unwarpedLandmarks: [],
      residualError: Infinity,
      isOccludedMask: [],
    };
  }

  const P_obs: Point3D[] = [];
  const Q_ref: Point3D[] = [];
  const weights: number[] = [];
  const isOccludedMask: boolean[] = new Array(N).fill(false);

  let hasExplicitZ = false;

  if (N >= 400) {
    for (const [mpIdxStr, canonIdx] of Object.entries(LANDMARK_MAP_MEDIAPIPE_TO_CANONICAL)) {
      const mpIdx = Number(mpIdxStr);
      const lm = landmarks[mpIdx];
      const q = CANONICAL_FACE_3D[canonIdx];
      if (lm && q) {
        const rawVis = visibilityMask ? visibilityMask[mpIdx] : undefined;
        const w = parseVisWeight(rawVis);
        const zVal = ("z" in lm && typeof lm.z === "number" && Number.isFinite(lm.z)) ? lm.z : 0.0;
        if (zVal !== 0.0) hasExplicitZ = true;

        if (
          Number.isFinite(lm.x) &&
          Number.isFinite(lm.y) &&
          Number.isFinite(zVal) &&
          Number.isFinite(q.x) &&
          Number.isFinite(q.y) &&
          Number.isFinite(q.z)
        ) {
          P_obs.push({ x: lm.x, y: lm.y, z: zVal });
          Q_ref.push(q);
          weights.push(w);
        }
      }
    }
  } else if (N >= 68) {
    for (let i = 0; i < 68; i++) {
      const lm = landmarks[i];
      const q = CANONICAL_FACE_3D[i];
      if (lm && q) {
        const rawVis = visibilityMask ? visibilityMask[i] : undefined;
        const w = parseVisWeight(rawVis);
        const zVal = ("z" in lm && typeof lm.z === "number" && Number.isFinite(lm.z)) ? lm.z : 0.0;
        if (zVal !== 0.0) hasExplicitZ = true;

        if (
          Number.isFinite(lm.x) &&
          Number.isFinite(lm.y) &&
          Number.isFinite(zVal) &&
          Number.isFinite(q.x) &&
          Number.isFinite(q.y) &&
          Number.isFinite(q.z)
        ) {
          P_obs.push({ x: lm.x, y: lm.y, z: zVal });
          Q_ref.push(q);
          weights.push(w);
        }
      }
    }
  } else {
    for (let i = 0; i < N; i++) {
      const lm = landmarks[i];
      const q = CANONICAL_FACE_3D[i % CANONICAL_FACE_3D.length]!;
      if (lm && q) {
        const rawVis = visibilityMask ? visibilityMask[i] : undefined;
        const w = parseVisWeight(rawVis);
        const zVal = ("z" in lm && typeof lm.z === "number" && Number.isFinite(lm.z)) ? lm.z : 0.0;
        if (zVal !== 0.0) hasExplicitZ = true;

        if (
          Number.isFinite(lm.x) &&
          Number.isFinite(lm.y) &&
          Number.isFinite(zVal) &&
          Number.isFinite(q.x) &&
          Number.isFinite(q.y) &&
          Number.isFinite(q.z)
        ) {
          P_obs.push({ x: lm.x, y: lm.y, z: zVal });
          Q_ref.push(q);
          weights.push(w);
        }
      }
    }
  }

  for (let i = 0; i < N; i++) {
    const lm = landmarks[i];
    const rawVis = visibilityMask ? visibilityMask[i] : undefined;
    const w = parseVisWeight(rawVis);

    const hasValidCoords = Boolean(
      lm &&
      typeof lm.x === "number" && Number.isFinite(lm.x) &&
      typeof lm.y === "number" && Number.isFinite(lm.y) &&
      (!("z" in lm) || lm.z === undefined || (typeof lm.z === "number" && Number.isFinite(lm.z)))
    );

    isOccludedMask[i] = w <= 0.01 || !hasValidCoords;
  }

  let W_total = 0;
  for (const w of weights) {
    W_total += w;
  }

  if (W_total < 3) {
    const fallbackUnwarped: Point3D[] = landmarks.map((lm, i) => {
      const canonRef = CANONICAL_FACE_3D[i % CANONICAL_FACE_3D.length]!;
      const validX = lm && typeof lm.x === "number" && Number.isFinite(lm.x);
      const validY = lm && typeof lm.y === "number" && Number.isFinite(lm.y);
      const validZ = lm && "z" in lm && typeof lm.z === "number" && Number.isFinite(lm.z);
      return {
        x: validX ? lm.x : canonRef.x,
        y: validY ? lm.y : canonRef.y,
        z: validZ ? (lm as Point3D).z : canonRef.z,
      };
    });

    return {
      rotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      translation: [0, 0, 0],
      scale: 1.0,
      unwarpedLandmarks: fallbackUnwarped,
      residualError: Infinity,
      isOccludedMask,
    };
  }

  let R: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  let T: Vector3D = [0, 0, 0];
  let s = 1.0;

  const maxPasses = !hasExplicitZ ? 2 : 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    let meanPx = 0, meanPy = 0, meanPz = 0;
    let meanQx = 0, meanQy = 0, meanQz = 0;

    for (let k = 0; k < P_obs.length; k++) {
      const w = weights[k]!;
      if (w <= 0) continue;
      const p = P_obs[k]!;
      const q = Q_ref[k]!;
      meanPx += w * p.x;
      meanPy += w * p.y;
      meanPz += w * p.z;
      meanQx += w * q.x;
      meanQy += w * q.y;
      meanQz += w * q.z;
    }

    meanPx /= W_total;
    meanPy /= W_total;
    meanPz /= W_total;
    meanQx /= W_total;
    meanQy /= W_total;
    meanQz /= W_total;

    const H: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];

    let varQ = 0;

    for (let k = 0; k < P_obs.length; k++) {
      const w = weights[k]!;
      if (w <= 0) continue;

      const px = P_obs[k]!.x - meanPx;
      const py = P_obs[k]!.y - meanPy;
      const pz = P_obs[k]!.z - meanPz;

      const qx = Q_ref[k]!.x - meanQx;
      const qy = Q_ref[k]!.y - meanQy;
      const qz = Q_ref[k]!.z - meanQz;

      varQ += w * (qx * qx + qy * qy + qz * qz);

      H[0][0] += w * px * qx;
      H[0][1] += w * px * qy;
      H[0][2] += w * px * qz;

      H[1][0] += w * py * qx;
      H[1][1] += w * py * qy;
      H[1][2] += w * py * qz;

      H[2][0] += w * pz * qx;
      H[2][1] += w * pz * qy;
      H[2][2] += w * pz * qz;
    }

    const { U, S, V } = svd3x3(H);

    const detU = det3x3(U);
    const detV = det3x3(V);
    const d = Math.sign(detU * detV) < 0 ? -1 : 1;

    // Correct Kabsch rotation R = U * diag(1, 1, d) * V^T
    R = [
      [
        U[0][0] * V[0][0] + U[0][1] * V[0][1] + d * U[0][2] * V[0][2],
        U[0][0] * V[1][0] + U[0][1] * V[1][1] + d * U[0][2] * V[1][2],
        U[0][0] * V[2][0] + U[0][1] * V[2][1] + d * U[0][2] * V[2][2],
      ],
      [
        U[1][0] * V[0][0] + U[1][1] * V[0][1] + d * U[1][2] * V[0][2],
        U[1][0] * V[1][0] + U[1][1] * V[1][1] + d * U[1][2] * V[1][2],
        U[1][0] * V[2][0] + U[1][1] * V[2][1] + d * U[1][2] * V[2][2],
      ],
      [
        U[2][0] * V[0][0] + U[2][1] * V[0][1] + d * U[2][2] * V[0][2],
        U[2][0] * V[1][0] + U[2][1] * V[1][1] + d * U[2][2] * V[1][2],
        U[2][0] * V[2][0] + U[2][1] * V[2][1] + d * U[2][2] * V[2][2],
      ],
    ];

    s = 1.0;
    if (varQ > 1e-9) {
      s = (S[0] + S[1] + d * S[2]) / varQ;
    }
    if (!Number.isFinite(s) || s < 1e-6) {
      s = 1.0;
    }

    const sR_meanQ0 = s * (R[0][0] * meanQx + R[0][1] * meanQy + R[0][2] * meanQz);
    const sR_meanQ1 = s * (R[1][0] * meanQx + R[1][1] * meanQy + R[1][2] * meanQz);
    const sR_meanQ2 = s * (R[2][0] * meanQx + R[2][1] * meanQy + R[2][2] * meanQz);

    T = [
      meanPx - sR_meanQ0,
      meanPy - sR_meanQ1,
      meanPz - sR_meanQ2,
    ];

    if (pass === 0 && !hasExplicitZ) {
      for (let k = 0; k < P_obs.length; k++) {
        const q = Q_ref[k]!;
        const predZ = s * (R[2][0] * q.x + R[2][1] * q.y + R[2][2] * q.z) + T[2];
        P_obs[k]!.z = predZ;
      }
    }
  }

  // Canonical Frontal Plane Inverse Unwarping P_canonical = (1 / s) * R^T * (P_observed - T)
  const invS = 1.0 / s;
  const unwarpedLandmarks: Point3D[] = new Array(N);

  for (let i = 0; i < N; i++) {
    const lm = landmarks[i];
    const canonFallback = CANONICAL_FACE_3D[i % CANONICAL_FACE_3D.length]!;

    const validX = lm && typeof lm.x === "number" && Number.isFinite(lm.x);
    const validY = lm && typeof lm.y === "number" && Number.isFinite(lm.y);
    const validZ = lm && "z" in lm && typeof lm.z === "number" && Number.isFinite(lm.z);

    if (!validX || !validY) {
      unwarpedLandmarks[i] = { ...canonFallback };
      continue;
    }

    const px = lm.x;
    const py = lm.y;
    const pz = validZ ? (lm as Point3D).z : 0.0;

    const dx = px - T[0];
    const dy = py - T[1];
    const dz = pz - T[2];

    const unwarpedX = invS * (R[0][0] * dx + R[1][0] * dy + R[2][0] * dz);
    const unwarpedY = invS * (R[0][1] * dx + R[1][1] * dy + R[2][1] * dz);
    const unwarpedZ = invS * (R[0][2] * dx + R[1][2] * dy + R[2][2] * dz);

    if (
      Number.isFinite(unwarpedX) &&
      Number.isFinite(unwarpedY) &&
      Number.isFinite(unwarpedZ)
    ) {
      unwarpedLandmarks[i] = { x: unwarpedX, y: unwarpedY, z: unwarpedZ };
    } else {
      unwarpedLandmarks[i] = { ...canonFallback };
    }
  }

  let sqErrSum = 0;
  for (let k = 0; k < P_obs.length; k++) {
    const w = weights[k]!;
    if (w <= 0) continue;

    const q = Q_ref[k]!;
    const p = P_obs[k]!;

    const predX = s * (R[0][0] * q.x + R[0][1] * q.y + R[0][2] * q.z) + T[0];
    const predY = s * (R[1][0] * q.x + R[1][1] * q.y + R[1][2] * q.z) + T[1];
    const predZ = s * (R[2][0] * q.x + R[2][1] * q.y + R[2][2] * q.z) + T[2];

    const errX = p.x - predX;
    const errY = p.y - predY;
    const errZ = p.z - predZ;

    sqErrSum += w * (errX * errX + errY * errY + errZ * errZ);
  }

  const residualError = W_total > 0 ? Math.sqrt(sqErrSum / W_total) : 0.0;

  return {
    rotation: R,
    translation: T,
    scale: s,
    unwarpedLandmarks,
    residualError: Number.isFinite(residualError) ? residualError : 0.0,
    isOccludedMask,
  };
}
