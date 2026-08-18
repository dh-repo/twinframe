import type { FaceFeatures, FeatureKey, TraitInsight } from "../face/types.ts";
import { FEATURE_KEYS, FEATURE_WEIGHTS } from "../face/types.ts";
import { traitSimilarity } from "../face/math.ts";
import { verdictSubtitle, type VerdictTier } from "../face/verdict.ts";

export type BlurbGender = "male" | "female" | "unknown";

export interface ComposeMatchBlurbInput {
  name: string;
  gender?: BlurbGender | string;
  tags?: readonly string[];
  celebFeatures?: Partial<FaceFeatures> | null;
  userFeatures?: Partial<FaceFeatures> | null;
  /** Distant twins must not sell celebrity traits as shared geometry. */
  verdict?: VerdictTier;
}

export interface PickedTrait {
  key: FeatureKey;
  phrase: string;
  similarity: number;
  distinctiveness: number;
}

export interface BreakdownRow {
  id: string;
  name: string;
  score: number;
  description: string;
}

/** Structural keys we are willing to name in a sentence. Color / gender stay out. */
const STRUCTURAL_KEYS: FeatureKey[] = [
  "eyeSpacing",
  "cheekboneProminence",
  "jawWidth",
  "chinSharpness",
  "faceAspect",
  "faceRoundness",
  "eyeOpenness",
  "eyeSlant",
  "browHeight",
  "foreheadHeight",
  "noseLength",
  "noseWidth",
  "mouthWidth",
  "lipFullness",
  "youthfulness",
];

const AGREEMENT_MIN = 0.78;
const DISTINCTIVE_MIN = 0.12;

const APPEARANCE_TAG_RE =
  /\b(jaw|jaws|eye|eyes|lip|lips|face|chin|nose|brow|brows|hair|cheek|cheeks|cheekbone|cheekbones|forehead|mouth|smile|angular|oval|round|square|youthful|boyish|soft|defined|sharp|warm|cool|blond|blonde|brunette|silver)\b/i;

const CAREER_TAG_RE =
  /\b(actor|actress|singer|rapper|model|host|comedian|athlete|oscar|grammy|emmy|winner|classic|icon|star|legend|hollywood|director|producer)\b/i;

export function pronounFromGender(
  gender?: BlurbGender | string,
): "his" | "her" | "their" {
  if (gender === "female" || gender === "male" || gender === "unknown") {
    return possessivePronoun(gender);
  }
  return "their";
}

function possessivePronoun(gender: BlurbGender): "his" | "her" | "their" {
  switch (gender) {
    case "female":
      return "her";
    case "male":
      return "his";
    case "unknown":
      return "their";
    default: {
      const _exhaustive: never = gender;
      return _exhaustive;
    }
  }
}

function readFeature(
  features: Partial<FaceFeatures> | null | undefined,
  key: FeatureKey,
): number | undefined {
  const value = features?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isSparse(features: Partial<FaceFeatures>): boolean {
  let present = 0;
  for (const key of FEATURE_KEYS) {
    if (readFeature(features, key) !== undefined) present += 1;
  }
  return present < 14;
}

function comparableKeys(
  a: Partial<FaceFeatures>,
  b?: Partial<FaceFeatures>,
): FeatureKey[] {
  const keys = STRUCTURAL_KEYS.filter((key) => {
    if (readFeature(a, key) === undefined) return false;
    if (b && readFeature(b, key) === undefined) return false;
    return true;
  });
  if (!b && isSparse(a)) return keys;
  if (b && (isSparse(a) || isSparse(b))) return keys;
  return keys;
}

function agreementPhrase(key: FeatureKey): string | null {
  switch (key) {
    case "eyeSpacing":
      return "eye spacing";
    case "cheekboneProminence":
      return "cheekbone structure";
    case "jawWidth":
      return "jawline";
    case "chinSharpness":
      return "chin shape";
    case "faceAspect":
      return "face proportions";
    case "faceRoundness":
      return "face shape";
    case "eyeOpenness":
      return "eye openness";
    case "eyeSlant":
      return "eye shape";
    case "browHeight":
      return "brow line";
    case "foreheadHeight":
      return "forehead";
    case "noseLength":
      return "nose length";
    case "noseWidth":
      return "nose width";
    case "mouthWidth":
      return "mouth width";
    case "lipFullness":
      return "lip fullness";
    case "youthfulness":
      return "youthful look";
    case "skinL":
    case "skinA":
    case "skinB":
    case "hairL":
    case "hairA":
    case "hairB":
    case "masculine":
    case "feminine":
      return null;
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

function distinctivePhrase(key: FeatureKey, value: number): string | null {
  const high = value >= 0.5;
  switch (key) {
    case "eyeSpacing":
      return high ? "wide-set eyes" : "close-set eyes";
    case "cheekboneProminence":
      return high ? "high cheekbones" : "soft cheekbones";
    case "jawWidth":
      return high ? "wide jaw" : "narrow jaw";
    case "chinSharpness":
      return high ? "sharp chin" : "soft chin";
    case "faceAspect":
      return high ? "long face" : "short face";
    case "faceRoundness":
      return high ? "round face" : "angular face";
    case "eyeOpenness":
      return high ? "wide-open eyes" : "hooded eyes";
    case "eyeSlant":
      return high ? "upturned eyes" : "downturned eyes";
    case "browHeight":
      return high ? "high brows" : "low brows";
    case "foreheadHeight":
      return high ? "high forehead" : "low forehead";
    case "noseLength":
      return high ? "long nose" : "short nose";
    case "noseWidth":
      return high ? "wide nose" : "narrow nose";
    case "mouthWidth":
      return high ? "wide mouth" : "narrow mouth";
    case "lipFullness":
      return high ? "full lips" : "thin lips";
    case "youthfulness":
      return high ? "youthful features" : "mature features";
    case "skinL":
    case "skinA":
    case "skinB":
    case "hairL":
    case "hairA":
    case "hairB":
    case "masculine":
    case "feminine":
      return null;
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

function keyOrder(key: FeatureKey): number {
  const index = STRUCTURAL_KEYS.indexOf(key);
  return index === -1 ? STRUCTURAL_KEYS.length : index;
}

export function pickAgreeingTraits(
  userFeatures: Partial<FaceFeatures>,
  celebFeatures: Partial<FaceFeatures>,
  limit = 2,
): PickedTrait[] {
  const ranked: PickedTrait[] = [];
  for (const key of comparableKeys(userFeatures, celebFeatures)) {
    const user = readFeature(userFeatures, key);
    const celeb = readFeature(celebFeatures, key);
    const phrase = agreementPhrase(key);
    if (user === undefined || celeb === undefined || phrase === null) continue;
    const similarity = traitSimilarity(user, celeb);
    if (similarity < AGREEMENT_MIN) continue;
    ranked.push({
      key,
      phrase,
      similarity,
      distinctiveness: 0,
    });
  }
  ranked.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return keyOrder(a.key) - keyOrder(b.key);
  });
  return ranked.slice(0, Math.max(0, limit));
}

export function pickDistinctiveTraits(
  celebFeatures: Partial<FaceFeatures>,
  limit = 2,
): PickedTrait[] {
  const ranked: PickedTrait[] = [];
  for (const key of comparableKeys(celebFeatures)) {
    const value = readFeature(celebFeatures, key);
    if (value === undefined) continue;
    const distinctiveness = Math.abs(value - 0.5);
    if (distinctiveness < DISTINCTIVE_MIN) continue;
    const phrase = distinctivePhrase(key, value);
    if (phrase === null) continue;
    ranked.push({
      key,
      phrase,
      similarity: 0,
      distinctiveness: distinctiveness * FEATURE_WEIGHTS[key],
    });
  }
  ranked.sort((a, b) => {
    if (b.distinctiveness !== a.distinctiveness) {
      return b.distinctiveness - a.distinctiveness;
    }
    return keyOrder(a.key) - keyOrder(b.key);
  });
  return ranked.slice(0, Math.max(0, limit));
}

function isAppearanceTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (!trimmed) return false;
  if (CAREER_TAG_RE.test(trimmed) && !/\b(jaw|eye|eyes|lip|lips|face|chin|nose|brow|hair|cheek)/i.test(trimmed)) {
    return false;
  }
  return APPEARANCE_TAG_RE.test(trimmed);
}

function normalizeTag(tag: string): string {
  const t = tag.trim().toLowerCase();
  if (/\b(jaw|jaws|eye|eyes|lip|lips|face|chin|nose|brow|brows|hair|cheek|cheeks|forehead|mouth|smile)/i.test(t)) {
    return t;
  }
  if (/(features|look|hair)$/i.test(t)) return t;
  return `${t} look`;
}

function tagOverlaps(tagPhrase: string, phrases: readonly string[]): boolean {
  const tokens = tagPhrase.split(/[^a-z]+/i).filter((t) => t.length > 2);
  return phrases.some((phrase) =>
    tokens.some((token) => phrase.toLowerCase().includes(token)),
  );
}

function appearanceTagPhrases(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const phrases: string[] = [];
  for (const tag of tags) {
    if (!isAppearanceTag(tag)) continue;
    const phrase = normalizeTag(tag);
    if (!phrases.includes(phrase)) phrases.push(phrase);
  }
  return phrases;
}

function shareSentence(
  pronoun: "his" | "her" | "their",
  phrases: readonly string[],
): string {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return `You share ${pronoun} ${phrases[0]}.`;
  return `You share ${pronoun} ${phrases[0]} and ${phrases[1]}.`;
}

function lookFallback(name: string): string {
  const trimmed = name.trim();
  return `You share a look with ${trimmed || "this face"}.`;
}

export function composeMatchBlurb(input: ComposeMatchBlurbInput): string {
  if (input.verdict === "distant-twin") {
    return verdictSubtitle("distant-twin");
  }

  const pronoun = pronounFromGender(input.gender);
  const user = input.userFeatures;
  const celeb = input.celebFeatures;

  if (user && celeb) {
    const agreeing = pickAgreeingTraits(user, celeb, 2);
    if (agreeing.length > 0) {
      return shareSentence(
        pronoun,
        agreeing.map((t) => t.phrase),
      );
    }
  }

  const distinctive = celeb ? pickDistinctiveTraits(celeb, 2) : [];
  const phrases = distinctive.map((t) => t.phrase);
  const tags = appearanceTagPhrases(input.tags);
  for (const tag of tags) {
    if (phrases.length >= 2) break;
    if (tagOverlaps(tag, phrases)) continue;
    phrases.push(tag);
  }

  if (phrases.length > 0) return shareSentence(pronoun, phrases.slice(0, 2));
  return lookFallback(input.name);
}

function traitDescription(trait: string): string {
  switch (trait) {
    case "facialStructure":
      return "Overall face geometry versus the gallery embedding";
    case "ageAffinity":
      return "How close the estimated ages sit";
    case "genderPresentation":
      return "Presentation alignment between the two faces";
    case "lightingQuality":
      return "Capture sharpness, coverage, and lighting";
    default:
      return "Shared facial measurement";
  }
}

function titlePhrase(phrase: string): string {
  if (!phrase) return phrase;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function composeBreakdownRows(
  traits: readonly TraitInsight[],
  opts?: {
    userFeatures?: Partial<FaceFeatures> | null;
    celebFeatures?: Partial<FaceFeatures> | null;
    /** Accepted and ignored — scores must never be derived from hue. */
    accentHue?: number;
    /** Distant twins keep engine rows only — no 99% "jawline" extras. */
    verdict?: VerdictTier;
  },
): BreakdownRow[] {
  void opts?.accentHue;
  const rows: BreakdownRow[] = [];
  const seen = new Set<string>();

  for (const trait of traits) {
    if (typeof trait.similarity !== "number" || !Number.isFinite(trait.similarity)) {
      continue;
    }
    const score = Math.round(Math.max(0, Math.min(1, trait.similarity)) * 100);
    rows.push({
      id: trait.trait,
      name: trait.label || trait.trait,
      score,
      description: traitDescription(trait.trait),
    });
    seen.add(trait.trait);
  }

  const user = opts?.userFeatures;
  const celeb = opts?.celebFeatures;
  if (user && celeb && opts?.verdict !== "distant-twin") {
    for (const agree of pickAgreeingTraits(user, celeb, 2)) {
      if (seen.has(agree.key)) continue;
      rows.push({
        id: agree.key,
        name: titlePhrase(agree.phrase),
        score: Math.round(Math.max(0, Math.min(1, agree.similarity)) * 100),
        description: `You both sit near the same ${agree.phrase}.`,
      });
      seen.add(agree.key);
    }
  }

  return rows;
}
