import { CELEBRITIES } from "../celebrities/database.ts";
import { initials } from "../celebrities/types.ts";
import type { CelebrityMatch, TraitInsight } from "./types.ts";
import {
  type CelebrityEmbedding,
  euclideanDistance,
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
 */
export function rankByDescriptor(
  user: UserFaceQuery,
  gallery: CelebrityEmbedding[],
  topK = 5,
): CelebrityMatch[] {
  const scored = gallery.map((celeb) => {
    const dist = euclideanDistance(user.descriptor, celeb.descriptor);
    const g = genderAffinity(user.gender, user.genderProbability, celeb);
    const a = ageAffinity(user.age, celeb.age);
    // Soft priors: nudge distance down (better) for compatible age/gender
    const adjusted = dist / (0.55 + 0.3 * g + 0.15 * a);
    return { celeb, dist, adjusted };
  });

  scored.sort((a, b) => a.adjusted - b.adjusted);
  const top = scored.slice(0, topK);
  const percents = rankPercentsFromDistances(top.map((t) => t.adjusted));

  return top.map((t, i) => {
    const meta = mergeWithProfile(t.celeb, CELEBRITIES);
    const displayName =
      CELEBRITIES.find((c) => c.id === t.celeb.id)?.name ||
      t.celeb.name ||
      t.celeb.id;
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
