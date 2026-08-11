import { CELEBRITIES } from "../celebrities/database.ts";
import { initials } from "../celebrities/types.ts";
import type { CelebrityMatch, TraitInsight } from "./types.ts";
import {
  type CelebrityEmbedding,
  ensembleDistance,
  rankPercentsFromDistances,
  genderAffinity,
  ageAffinity,
  mergeWithProfile,
} from "./embeddings.ts";

export interface UserFaceQuery {
  descriptor: ArrayLike<number>;
  age: number;
  gender: "male" | "female" | "unknown";
  genderProbability: number;
}

/**
 * Rank celebrities by FaceNet L2 distance (primary), with soft age/gender priors.
 * Gallery may contain multiple age-buckets per celeb id (e.g. 46/58/72).
 * We score every bucket, then keep only the best bucket per celeb id
 * (lowest adjusted distance), so results are diverse and age-aware.
 */
export function rankByDescriptor(
  user: UserFaceQuery,
  gallery: CelebrityEmbedding[],
  topK = 5,
): CelebrityMatch[] {
  const scored = gallery.map((celeb) => {
    // High-accuracy ensemble: euclidean + cosine, normalized descriptors
    const dist = ensembleDistance(user.descriptor, celeb.descriptor);
    const g = genderAffinity(user.gender, user.genderProbability, celeb);
    const a = ageAffinity(user.age, celeb.age);
    // High-accuracy: age/gender are gentle priors (don't dominate face)
    // denominator 0.72 + 0.18*g + 0.10*a => max 12% shift for age/gender
    const adjusted = dist / (0.72 + 0.18 * g + 0.10 * a);
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
  const top = deduped.slice(0, topK);
  const percents = rankPercentsFromDistances(top.map((t) => t.adjusted));

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
      rawScore: 1 / (1 + t.adjusted),
      traits: buildDescriptorTraits(user, t.celeb, t.dist),
      accentHue: meta.accentHue,
      initials: initials(displayName),
      tags: meta.tags,
      photoUrl: t.celeb.path,
      photoUrl192: anyPath.path192,
      fallbackPhotoUrl: anyPath.fallbackPath,
      distance: t.dist,
    };
  });
}

function buildDescriptorTraits(
  user: UserFaceQuery,
  celeb: CelebrityEmbedding,
  distance: number,
): TraitInsight[] {
  const faceSim = Math.max(0, Math.min(1, 1 - distance / 0.85));
  const ageSim = ageAffinity(user.age, celeb.age);
  const genderSim =
    user.gender === "unknown"
      ? 0.7
      : user.gender === celeb.gender
        ? user.genderProbability
        : 1 - user.genderProbability * 0.7;

  return [
    {
      trait: "faceEmbedding",
      userValue: faceSim,
      celebValue: 1,
      similarity: faceSim,
      label: "Facial structure",
    },
    {
      trait: "age",
      userValue: user.age / 100,
      celebValue: celeb.age / 100,
      similarity: ageSim,
      label: "Age range",
    },
    {
      trait: "presentation",
      userValue: user.genderProbability,
      celebValue: celeb.genderProb,
      similarity: genderSim,
      label: "Presentation",
    },
  ].sort((a, b) => b.similarity - a.similarity);
}
