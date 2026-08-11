/** Normalized facial feature vector used for matching (0–1 scale unless noted). */
export interface FaceFeatures {
  faceAspect: number;
  jawWidth: number;
  chinSharpness: number;
  foreheadHeight: number;
  eyeSpacing: number;
  eyeOpenness: number;
  eyeSlant: number;
  browHeight: number;
  noseLength: number;
  noseWidth: number;
  mouthWidth: number;
  lipFullness: number;
  cheekboneProminence: number;
  faceRoundness: number;
  skinL: number;
  skinA: number;
  skinB: number;
  hairL: number;
  hairA: number;
  hairB: number;
  masculine: number;
  feminine: number;
  youthfulness: number;
}

export type FeatureKey = keyof FaceFeatures;

export const FEATURE_KEYS: FeatureKey[] = [
  "faceAspect",
  "jawWidth",
  "chinSharpness",
  "foreheadHeight",
  "eyeSpacing",
  "eyeOpenness",
  "eyeSlant",
  "browHeight",
  "noseLength",
  "noseWidth",
  "mouthWidth",
  "lipFullness",
  "cheekboneProminence",
  "faceRoundness",
  "skinL",
  "skinA",
  "skinB",
  "hairL",
  "hairA",
  "hairB",
  "masculine",
  "feminine",
  "youthfulness",
];

export const FEATURE_WEIGHTS: Record<FeatureKey, number> = {
  faceAspect: 1.4,
  jawWidth: 1.5,
  chinSharpness: 1.1,
  foreheadHeight: 0.9,
  eyeSpacing: 1.3,
  eyeOpenness: 0.8,
  eyeSlant: 1.2,
  browHeight: 0.7,
  noseLength: 1.2,
  noseWidth: 1.1,
  mouthWidth: 1.0,
  lipFullness: 1.0,
  cheekboneProminence: 1.3,
  faceRoundness: 1.2,
  skinL: 1.6,
  skinA: 1.4,
  skinB: 1.4,
  hairL: 0.9,
  hairA: 0.7,
  hairB: 0.7,
  masculine: 1.8,
  feminine: 1.8,
  youthfulness: 1.0,
};

export interface FaceQuality {
  ok: boolean;
  score: number;
  faceCoverage: number;
  centered: number;
  issues: string[];
}

export interface TraitInsight {
  trait: string;
  userValue: number;
  celebValue: number;
  similarity: number;
  label: string;
}

export interface CelebrityMatch {
  celebrityId: string;
  name: string;
  knownFor: string;
  matchPercent: number;
  rawScore: number;
  traits: TraitInsight[];
  accentHue: number;
  initials: string;
  tags: string[];
  photoUrl?: string;
  distance?: number;
}

export interface MatchResult {
  features: FaceFeatures | null;
  quality: FaceQuality;
  matches: CelebrityMatch[];
  analyzedAt: number;
  engineVersion: string;
  facePreviewUrl?: string;
  estimatedAge?: number;
  estimatedGender?: string;
}

export const ENGINE_VERSION = "2.1.0";
