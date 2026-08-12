import { CELEBRITIES, getCelebrityById } from "../celebrities/database.ts";
import { initials } from "../celebrities/types.ts";
import type { CelebrityMatch, FaceFeatures, TraitInsight } from "./types.ts";
import { geomAffinity } from "./geometry.ts";
import {
  type CelebrityEmbedding,
  ensembleDistance,
  rankPercentsFromDistances,
  genderAffinity,
  ageAffinity,
  computeMatchConfidence,
  mergeWithProfile,
} from "./embeddings.ts";
import { getPoseAdaptiveLandmarkWeight, type HeadPose } from "./pose.ts";

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
  features?: FaceFeatures;
  /** Optional 3D head pose — damps geom weight when yaw is large. */
  headPose?: HeadPose;
}

/**
 * Rank celebrities by FaceNet L2 distance (primary), with soft age/gender priors
 * and landmark geometric feature fusion.
 * Gallery may contain multiple age-buckets per celeb id (e.g. 46/58/72).
 * We score every bucket, then keep only the best bucket per celeb id
 * (lowest adjusted distance), so results are diverse and age-aware.
 *
 * Geom weight: base 0.10, scaled by cos(|yaw|) with floor 0.2 when headPose is set.
 */
export function rankByDescriptor(
  user: UserFaceQuery,
  gallery: CelebrityEmbedding[],
  topK = 5,
): CelebrityMatch[] {
  const geomWeight = user.headPose
    ? getPoseAdaptiveLandmarkWeight(user.headPose, 0.10)
    : 0.10;

  const scored = gallery.map((celeb) => {
    // High-accuracy ensemble: euclidean + cosine, normalized descriptors
    const dist = ensembleDistance(user.descriptor, celeb.descriptor);
    const g = genderAffinity(user.gender, user.genderProbability, celeb);
    const a = ageAffinity(user.age, celeb.age);
    const celebFeatures = celeb.features ?? getCelebrityById(celeb.id)?.features;
    const geomAffinityScore = geomAffinity(user.features, celebFeatures);
    // Landmark Geometric Fusion denominator balance with epsilon scaling:
    // (dist + 1e-4) / (0.68 + 0.14 * g + 0.08 * a + w_geom * geomAffinityScore)
    const adjusted =
      (dist + 1e-4) / (0.68 + 0.14 * g + 0.08 * a + geomWeight * geomAffinityScore);
    return { celeb, dist, adjusted, g, a, geomAffinityScore };
  });

  // Deduplicate by celeb id: keep best bucket per id
  const bestById = new Map<string, (typeof scored)[number]>();
  for (const s of scored) {
    const prev = bestById.get(s.celeb.id);
    if (!prev || s.adjusted < prev.adjusted) bestById.set(s.celeb.id, s);
  }
  const deduped = Array.from(bestById.values());
  deduped.sort((a, b) => {
    const delta = a.adjusted - b.adjusted;
    if (Math.abs(delta) < 1e-5) {
      const geomDelta = b.geomAffinityScore - a.geomAffinityScore;
      if (Math.abs(geomDelta) > 1e-4) {
        return geomDelta;
      }
      return (b.g + b.a) - (a.g + a.a);
    }
    return delta;
  });
  const top = deduped.slice(0, topK);
  const percents = rankPercentsFromDistances(top.map((t) => t.adjusted));

  // Match distance ceiling / floor gate: reject non-face descriptors
  if (top.length === 0 || top[0]!.dist > 1.25 || top[0]!.adjusted > 1.25 || (percents[0] ?? 0) < 30) {
    return [];
  }

  const confScore = computeMatchConfidence(
    user.detConfidence ?? 0.92,
    user.sharpness ?? 0.85,
    user.faceCoverage ?? 0.25,
    user.genderProbability,
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
      rawScore: 1 / (1 + t.adjusted),
      confidenceScore: confScore,
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
        ? Math.min(1, 0.85 + 0.15 * user.genderProbability)
        : Math.max(0.2, 1 - user.genderProbability * 0.7);

  const confidence = computeMatchConfidence(
    user.detConfidence ?? 0.92,
    user.sharpness ?? 0.85,
    user.faceCoverage ?? 0.25,
    user.genderProbability,
  );
  const qualitySim = confidence / 100;

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
      userValue: Math.min(1, user.age / 100),
      celebValue: Math.min(1, celeb.age / 100),
      similarity: ageSim,
      label: "Age Affinity",
    },
    {
      trait: "genderPresentation",
      userValue: user.genderProbability,
      celebValue: celeb.genderProb,
      similarity: genderSim,
      label: "Gender Presentation",
    },
    {
      trait: "lightingQuality",
      userValue: user.qualityScore ?? qualitySim,
      celebValue: 0.92,
      similarity: qualitySim,
      label: "Lighting & Quality",
    },
  ].sort((a, b) => b.similarity - a.similarity);
}
