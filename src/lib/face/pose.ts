/**
 * 3D Head Pose Estimation (Yaw, Pitch, Roll) from 68-point facial landmarks.
 */

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
  const absYawRad = (Math.abs(pose.yawDeg) * Math.PI) / 180;
  const factor = Math.max(0.2, Math.cos(absYawRad));
  return Math.round(baseWeight * factor * 1000) / 1000;
}
