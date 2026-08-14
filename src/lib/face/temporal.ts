import { l2Normalize } from "./embeddings.ts";
import { ensureAnatomicalFeatures } from "./geometry.ts";
import type { ExtendedAnatomicalFeatures, FaceFeatures } from "./types.ts";
import type { HeadPose } from "./pose.ts";

export const TEMPORAL_ALPHA = 0.35;
export const MIN_GOOD_FRAMES = 3;
export const MIN_FRAME_CONFIDENCE = 0.35;

export interface FrameSample {
  descriptor: ArrayLike<number>;
  features?: FaceFeatures | null;
  headPose?: HeadPose;
  confidence: number;
}

function asF32(v: ArrayLike<number>): Float32Array {
  return v instanceof Float32Array ? v : Float32Array.from(v);
}

/** EMA on the unit sphere: mix then L2-normalize. First sample copies. */
export function emaUnitVector(
  prev: Float32Array | null,
  next: ArrayLike<number>,
  alpha = TEMPORAL_ALPHA,
): Float32Array {
  const n = asF32(next);
  if (!prev || prev.length !== n.length) return l2Normalize(n);
  const a = Math.max(0, Math.min(1, alpha));
  const mixed = new Float32Array(n.length);
  for (let i = 0; i < n.length; i++) {
    mixed[i] = a * (n[i] ?? 0) + (1 - a) * (prev[i] ?? 0);
  }
  return l2Normalize(mixed);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** EMA clinical ratios; facial thirds are re-normalized to sum to 1. */
export function emaAnatomical(
  prev: ExtendedAnatomicalFeatures | null,
  next: ExtendedAnatomicalFeatures,
  alpha = TEMPORAL_ALPHA,
): ExtendedAnatomicalFeatures {
  if (!prev) return { ...next, lateralFifthsRatios: [...next.lateralFifthsRatios] };
  const a = Math.max(0, Math.min(1, alpha));
  const upperThirdRatio = lerp(prev.upperThirdRatio, next.upperThirdRatio, a);
  const middleThirdRatio = lerp(prev.middleThirdRatio, next.middleThirdRatio, a);
  const lowerThirdRatio = lerp(prev.lowerThirdRatio, next.lowerThirdRatio, a);
  const thirdSum = upperThirdRatio + middleThirdRatio + lowerThirdRatio;
  const inv = thirdSum > 1e-6 ? 1 / thirdSum : 1;
  const fifths = next.lateralFifthsRatios.map((v, i) =>
    lerp(prev.lateralFifthsRatios[i] ?? 0.2, v, a),
  );
  return {
    upperThirdRatio: upperThirdRatio * inv,
    middleThirdRatio: middleThirdRatio * inv,
    lowerThirdRatio: lowerThirdRatio * inv,
    lateralFifthsRatios: fifths,
    interCanthalDistance: lerp(prev.interCanthalDistance, next.interCanthalDistance, a),
    canthalTiltAngleDeg: lerp(prev.canthalTiltAngleDeg, next.canthalTiltAngleDeg, a),
    nasalIndex: lerp(prev.nasalIndex, next.nasalIndex, a),
    bigonialToBizygomaticRatio: lerp(prev.bigonialToBizygomaticRatio, next.bigonialToBizygomaticRatio, a),
    gonialJawlineAngleDeg: lerp(prev.gonialJawlineAngleDeg, next.gonialJawlineAngleDeg, a),
    lipVermilionHeightRatio: lerp(prev.lipVermilionHeightRatio, next.lipVermilionHeightRatio, a),
    philtrumDepth: lerp(prev.philtrumDepth, next.philtrumDepth, a),
  };
}

export interface FrameConsensus {
  descriptor: Float32Array;
  features: FaceFeatures;
  headPose?: HeadPose;
  frameCount: number;
  usedFallback: boolean;
}

/**
 * Rolling EMA over a burst of detections. Drops low-confidence frames.
 * Fewer than MIN_GOOD_FRAMES → last good frame only (usedFallback).
 */
export function consensusFromFrames(
  frames: FrameSample[],
  opts?: { alpha?: number; minConfidence?: number; minGood?: number },
): FrameConsensus | null {
  const alpha = opts?.alpha ?? TEMPORAL_ALPHA;
  const minConf = opts?.minConfidence ?? MIN_FRAME_CONFIDENCE;
  const minGood = opts?.minGood ?? MIN_GOOD_FRAMES;
  const good = frames.filter((f) => f && f.confidence >= minConf && f.descriptor && f.descriptor.length > 0);
  if (good.length === 0) return null;

  const usable = good.length >= minGood ? good : good.slice(-1);
  let desc: Float32Array | null = null;
  let anat: ExtendedAnatomicalFeatures | null = null;
  let pose = usable[usable.length - 1]!.headPose;
  let lastFeat: FaceFeatures | undefined;

  for (const f of usable) {
    desc = emaUnitVector(desc, f.descriptor, alpha);
    const nextAnat = f.features
      ? (f.features.anatomical ?? ensureAnatomicalFeatures(f.features))
      : null;
    if (nextAnat) anat = emaAnatomical(anat, nextAnat, alpha);
    if (f.headPose) pose = f.headPose;
    if (f.features) lastFeat = f.features;
  }

  const features: FaceFeatures = lastFeat ? { ...lastFeat } : {
    faceAspect: 0.5, jawWidth: 0.5, chinSharpness: 0.5, foreheadHeight: 0.5,
    eyeSpacing: 0.5, eyeOpenness: 0.5, eyeSlant: 0.5, browHeight: 0.5,
    noseLength: 0.5, noseWidth: 0.5, mouthWidth: 0.5, lipFullness: 0.5,
    cheekboneProminence: 0.5, faceRoundness: 0.5,
    skinL: 0.5, skinA: 0.5, skinB: 0.5, hairL: 0.5, hairA: 0.5, hairB: 0.5,
    masculine: 0.5, feminine: 0.5, youthfulness: 0.5,
  };
  if (anat) features.anatomical = anat;

  return {
    descriptor: desc!,
    features,
    headPose: pose,
    frameCount: usable.length,
    usedFallback: good.length < minGood,
  };
}
