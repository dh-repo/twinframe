/**
 * Legacy geometry-only ranker — kept for unit tests & fallback.
 * Production matching uses FaceNet descriptors via match.ts rankByDescriptor.
 */
import { CELEBRITIES } from "../celebrities/database.ts";
import { initials } from "../celebrities/types.ts";
import type {
  FaceFeatures,
  CelebrityMatch,
  TraitInsight,
  FeatureKey,
} from "./types.ts";
import { FEATURE_KEYS, FEATURE_WEIGHTS } from "./types.ts";
import {
  ensembleScore,
  calibrateMatchPercents,
  traitSimilarity,
  clamp,
} from "./math.ts";

const TRAIT_LABELS: Partial<Record<FeatureKey, string>> = {
  faceAspect: "Face proportions",
  jawWidth: "Jawline",
  chinSharpness: "Chin shape",
  eyeSpacing: "Eye spacing",
  eyeOpenness: "Eye openness",
  eyeSlant: "Eye shape",
  noseLength: "Nose length",
  noseWidth: "Nose width",
  mouthWidth: "Mouth width",
  lipFullness: "Lip fullness",
  cheekboneProminence: "Cheekbones",
  faceRoundness: "Face shape",
  skinL: "Skin tone",
  hairL: "Hair tone",
  youthfulness: "Youthful look",
};

const EXPLAIN_KEYS: FeatureKey[] = [
  "jawWidth",
  "cheekboneProminence",
  "eyeSpacing",
  "eyeOpenness",
  "noseLength",
  "lipFullness",
  "faceRoundness",
  "faceAspect",
  "skinL",
  "youthfulness",
];

function buildTraitInsights(
  user: FaceFeatures,
  celeb: FaceFeatures,
  limit = 4,
): TraitInsight[] {
  const ranked = EXPLAIN_KEYS.map((key) => {
    const sim = traitSimilarity(user[key], celeb[key]);
    return {
      trait: key,
      userValue: user[key],
      celebValue: celeb[key],
      similarity: sim,
      label: TRAIT_LABELS[key] ?? key,
    };
  }).sort((a, b) => b.similarity - a.similarity);
  return ranked.slice(0, limit);
}

function presentationAffinity(user: FaceFeatures, celeb: FaceFeatures): number {
  const diff = Math.abs(user.masculine - celeb.masculine);
  return clamp(1 - diff * 1.15);
}

export function rankCelebrities(
  user: FaceFeatures,
  topK = 5,
  gallery = CELEBRITIES,
): CelebrityMatch[] {
  const scored = gallery.map((celeb) => {
    const base = ensembleScore(user, celeb.features);
    const affinity = presentationAffinity(user, celeb.features);
    const skinSim = traitSimilarity(user.skinL, celeb.features.skinL);
    const raw = clamp(base * (0.72 + 0.22 * affinity + 0.06 * skinSim));
    return { celeb, raw };
  });

  scored.sort((a, b) => b.raw - a.raw);
  const top = scored.slice(0, Math.max(topK, 8));
  const percents = calibrateMatchPercents(top.map((t) => t.raw));

  return top.slice(0, topK).map((t, i) => ({
    celebrityId: t.celeb.id,
    name: t.celeb.name,
    knownFor: t.celeb.knownFor,
    matchPercent: percents[i] ?? 0,
    rawScore: t.raw,
    traits: buildTraitInsights(user, t.celeb.features),
    accentHue: t.celeb.accentHue,
    initials: initials(t.celeb.name),
    tags: t.celeb.tags,
    gender: t.celeb.tags?.includes("female") ? "female" : t.celeb.tags?.includes("male") ? "male" : undefined,
  }));
}

export function getFeatureWeights(): Record<FeatureKey, number> {
  return { ...FEATURE_WEIGHTS };
}

export function getFeatureKeys(): FeatureKey[] {
  return [...FEATURE_KEYS];
}
