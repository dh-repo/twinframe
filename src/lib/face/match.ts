import { CELEBRITIES } from "../celebrities/database.ts";
import { initials } from "../celebrities/types.ts";
import type { CelebrityMatch, TraitInsight } from "./types.ts";
import {
  type CelebrityEmbedding,
  l2Normalize,
  cosineDistance256,
  rankPercentsFromDistances,
  genderAffinity,
  ageAffinity,
  computeMatchConfidence,
  mergeWithProfile,
} from "./embeddings.ts";
import { attributeConflictLevel, distanceLookalikeGate } from "./lookalike-policy.ts";
import { applyOpenSetLookalikePercents, rankMargin } from "./open-set-score.ts";

export { computeMatchConfidence };

export interface UserFaceQuery {
  descriptor: ArrayLike<number>;
  age: number;
  gender: "male" | "female" | "unknown";
  genderProbability: number;
  qualityScore?: number;
  detConfidence?: number;
  sharpness?: number;
  faceCoverage?: number;
  smileIntensity?: number;
}

/**
 * Rank celebrities by EdgeFace-M 256-d Cosine distance (primary), with soft age/gender priors.
 * Gallery may contain multiple age-buckets per celeb id (e.g. 46/58/72).
 * We score every bucket, then keep only the best bucket per celeb id
 * (lowest adjusted distance), so results are diverse and age-aware.
 */
export function rankByDescriptor(
  user: UserFaceQuery,
  gallery: CelebrityEmbedding[],
  topK = 5,
): CelebrityMatch[] {
  if (!gallery || gallery.length === 0) return [];
  const userDesc = l2Normalize(user.descriptor);
  const userAge = Number.isFinite(user.age) ? user.age : undefined;
  const userGender = user.gender;
  const userGenderProb = Number.isFinite(user.genderProbability) ? user.genderProbability : 0.9;
  const smileIntensity = typeof user.smileIntensity === "number" && Number.isFinite(user.smileIntensity)
    ? Math.max(0, Math.min(1, user.smileIntensity))
    : 0;

  const scored = gallery.map((celeb) => {
    // AccuFace v4.0 Metric Recalibration: Pure L2-normalized Cosine distance (d = 1 - a_hat^T * b_hat)
    const rawDist = cosineDistance256(userDesc, celeb.descriptor);

    // Expression Resilience: Compensate for orthogonal smile displacement (delta d ~ 0.03-0.05)
    // when comparing high-smile probe vectors to gallery centroids.
    const smileComp = smileIntensity > 0.4 ? (smileIntensity - 0.4) * 0.04 : 0.0;
    const dist = Math.max(0.0, rawDist - smileComp);

    const g = genderAffinity(userGender, userGenderProb, celeb);
    const a = userAge !== undefined ? ageAffinity(userAge, celeb.age) : 1.0;
    // High-accuracy: age/gender are gentle priors (don't dominate face)
    // denominator 0.72 + 0.18*g + 0.10*a => max 12-16% shift for age/gender
    const denom = 0.72 + 0.18 * g + 0.10 * a;
    const adjusted = dist / denom;
    return { celeb, dist, adjusted };
  });

  // Deduplicate by celeb id: keep best bucket per id
  const bestById = new Map<string, (typeof scored)[number]>();
  for (const s of scored) {
    const prev = bestById.get(s.celeb.id);
    if (!prev || s.adjusted < prev.adjusted) bestById.set(s.celeb.id, s);
  }
  const deduped = Array.from(bestById.values());
  deduped.sort((a, b) => a.adjusted - b.adjusted);
  if (deduped.length === 0) return [];
  const presentable = selectPresentableRanks(deduped, topK, userGender, userGenderProb);
  if (presentable.length === 0) return [];

  const bestAdjusted = presentable[0]!.adjusted;
  const previewPercents = rankPercentsFromDistances([bestAdjusted]);
  const floor = distanceLookalikeGate(bestAdjusted, previewPercents[0]);
  if (!floor.pass) return [];

  const top = presentable;
  const hillPercents = rankPercentsFromDistances(top.map((t) => t.adjusted));
  // Margin vs the real gallery #2 (even if we hide them) so dropping a
  // cross-gender neighbor does not invent a distinctive look-alike.
  const margin = rankMargin(deduped.map((t) => t.adjusted));
  const percents = applyOpenSetLookalikePercents(hillPercents, margin, bestAdjusted);
  const confScore = computeMatchConfidence(
    user.detConfidence ?? 0.92,
    user.sharpness ?? 0.85,
    user.faceCoverage ?? 0.25,
    userGenderProb,
  );

  return top.map((t, i) => {
    const meta = mergeWithProfile(t.celeb, CELEBRITIES);
    const displayName =
      CELEBRITIES.find((c) => c.id === t.celeb.id)?.name ||
      t.celeb.name ||
      t.celeb.id;
    const anyPath = t.celeb as CelebrityEmbedding & { path192?: string; fallbackPath?: string };
    return {
      celebrityId: t.celeb.id,
      name: displayName,
      knownFor: meta.knownFor,
      matchPercent: percents[i] ?? 0,
      hillPercent: hillPercents[i] ?? percents[i] ?? 0,
      rankMargin: margin,
      rawScore: 1 / (1 + t.adjusted),
      confidenceScore: confScore,
      traits: buildDescriptorTraits(user, t.celeb, t.dist),
      accentHue: meta.accentHue,
      initials: initials(displayName),
      tags: meta.tags,
      gender: t.celeb.gender as "male" | "female" | "unknown" | undefined,
      attributeConflict: attributeConflictLevel(
        { gender: userGender, genderProbability: userGenderProb, age: userAge },
        { gender: t.celeb.gender, age: t.celeb.age },
      ),
      photoUrl: t.celeb.path,
      photoUrl192: anyPath.path192,
      fallbackPhotoUrl: anyPath.fallbackPath,
      distance: t.dist,
    };
  });
}

/** Confident gender: keep #1 (visual twin may cross gender), fill #2+ same-gender. */
export const PRESENTABLE_GENDER_MIN_PROB = 0.7;

export function selectPresentableRanks<T extends { celeb: { gender?: string } }>(
  ranked: readonly T[],
  topK: number,
  userGender: string | undefined,
  userGenderProb: number,
): T[] {
  if (ranked.length === 0 || topK <= 0) return [];
  const confident =
    (userGender === "male" || userGender === "female") &&
    Number.isFinite(userGenderProb) &&
    userGenderProb >= PRESENTABLE_GENDER_MIN_PROB;
  if (!confident) return ranked.slice(0, topK);
  const first = ranked[0]!;
  const rest = ranked.slice(1).filter((s) => s.celeb.gender === userGender);
  return [first, ...rest].slice(0, topK);
}

function buildDescriptorTraits(
  user: UserFaceQuery,
  celeb: CelebrityEmbedding,
  distance: number,
): TraitInsight[] {
  const faceSim = Math.max(0, Math.min(1, 1 - distance / 0.85));
  const userAge = Number.isFinite(user.age) ? user.age : (celeb.age ?? 40);
  const ageSim = ageAffinity(userAge, celeb.age);
  const gProb = Number.isFinite(user.genderProbability)
    ? (user.genderProbability > 1 ? user.genderProbability / 100 : user.genderProbability)
    : 0.9;
  const genderSim =
    user.gender === "unknown" || !user.gender
      ? 0.7
      : user.gender === celeb.gender
        ? Math.min(1, 0.85 + 0.15 * gProb)
        : Math.max(0.2, 1 - gProb * 0.7);

  const confidence = computeMatchConfidence(
    user.detConfidence ?? 0.92,
    user.sharpness ?? 0.85,
    user.faceCoverage ?? 0.25,
    gProb,
  );
  const qualitySim = confidence / 100;
  const userQualityScore = typeof user.qualityScore === "number" && Number.isFinite(user.qualityScore)
    ? (user.qualityScore > 1 ? user.qualityScore / 100 : user.qualityScore)
    : qualitySim;

  return [
    {
      trait: "facialStructure",
      userValue: faceSim,
      celebValue: 1,
      similarity: faceSim,
      label: "Facial Structure",
    },
    {
      trait: "ageAffinity",
      userValue: Math.min(1, Math.max(0, userAge / 100)),
      celebValue: Math.min(1, Math.max(0, (celeb.age ?? 40) / 100)),
      similarity: ageSim,
      label: "Age Affinity",
    },
    {
      trait: "genderPresentation",
      userValue: gProb,
      celebValue: celeb.genderProb ?? 0.9,
      similarity: genderSim,
      label: "Gender Presentation",
    },
    {
      trait: "lightingQuality",
      userValue: userQualityScore,
      celebValue: 0.92,
      similarity: qualitySim,
      label: "Lighting & Quality",
    },
  ].sort((a, b) => b.similarity - a.similarity);
}
