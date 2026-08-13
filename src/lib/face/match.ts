import { CELEBRITIES, getCelebrityById } from "../celebrities/database.ts";
import { initials } from "../celebrities/types.ts";
import {
  type CelebrityMatch,
  type FaceFeatures,
  type TraitInsight,
  type EthnicCluster,
  getEthnicCluster,
} from "./types.ts";
import { geomAffinity, crossDemographicMismatchPenalty } from "./geometry.ts";
import {
  type CelebrityEmbedding,
  ensembleDistance,
  getCelebrityDescriptors,
  rankPercentsFromDistances,
  distanceToMatchPercent,
  genderAffinity,
  ageAffinity,
  computeMatchConfidence,
  blendWithMatchConfidence,
  mergeWithProfile,
} from "./embeddings.ts";
import { getPoseAdaptiveLandmarkWeight, type HeadPose } from "./pose.ts";

export { computeMatchConfidence, blendWithMatchConfidence };

/** Real celebrity portraits (jpg) vs 96px TV-extra scrapes that steal top-k. */
export function isPrimaryGalleryEntry(celeb: CelebrityEmbedding): boolean {
  const blob = `${celeb.fallbackPath ?? ""} ${celeb.path ?? ""}`;
  if (blob.includes(`/${celeb.id}.jpg`)) return true;
  if (blob.includes("/thumbs/96/")) return false;
  return true;
}

/**
 * Household-name prior for FaceNet near-ties only.
 * 3 = global household / legend, 2 = A-list, 1 = well-known, 0 = default.
 * Never used when |Δd| is larger than FAME_FACE_EPS.
 */
const HOUSEHOLD_FAME: Record<string, number> = {
  "tom-hanks": 3,
  "denzel-washington": 3,
  "leonardo-dicaprio": 3,
  "meryl-streep": 3,
  "will-smith": 3,
  "brad-pitt": 3,
  "morgan-freeman": 3,
  "robert-de-niro": 3,
  "al-pacino": 3,
  "emma-stone": 2,
  "emma-watson": 2,
  "jennifer-lawrence": 2,
  "scarlett-johansson": 2,
  "margot-robbie": 2,
  "zendaya": 2,
  "taylor-swift": 2,
  "beyonce": 2,
  "rihanna": 2,
  "the-weeknd": 2,
  "adele": 2,
  "keanu-reeves": 2,
  "viola-davis": 2,
  "idris-elba": 2,
  "angela-bassett": 2,
  "ryan-gosling": 2,
  "ana-de-armas": 2,
  "florence-pugh": 2,
  "gal-gadot": 2,
  "timothee-chalamet": 2,
  "chris-hemsworth": 2,
  "henry-cavill": 2,
  "angelina-jolie": 2,
  "natalie-portman": 2,
  "dwayne-johnson": 2,
  "robert-downey-jr": 2,
  "kendall-jenner": 1,
  "kylie-jenner": 1,
  "josh-hutcherson": 1,
  "kevin-hart": 1,
  "cole-sprouse": 1,
  "sam-smith": 1,
};

export function householdFame(id: string): number {
  return HOUSEHOLD_FAME[id] ?? 0;
}

export interface UserFaceQuery {
  descriptor: ArrayLike<number>;
  /**
   * Optional multi-template descriptors (e.g. primary + flip + average).
   * Distance to a gallery vector is the **minimum** over these templates.
   */
  descriptors?: ArrayLike<number>[];
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
  /** Ethnic cluster annotation for cross-demographic alignment */
  ethnicCluster?: EthnicCluster;
}

/** Min ensemble distance across query templates (falls back to single descriptor). */
export function minTemplateDistance(
  query: UserFaceQuery,
  celebDescriptor: ArrayLike<number>,
): number {
  const templates =
    query.descriptors && query.descriptors.length > 0
      ? query.descriptors
      : [query.descriptor];
  let best = Infinity;
  for (const t of templates) {
    const d = ensembleDistance(t, celebDescriptor);
    if (d < best) best = d;
  }
  return best;
}

/**
  * Min ensemble distance across query templates and all multi-reference vectors
  * available for a celebrity figure (via getCelebrityDescriptors).
  */
export function minMultiVectorDistance(
  query: UserFaceQuery,
  celeb: CelebrityEmbedding,
): number {
  const templates =
    query.descriptors && query.descriptors.length > 0
      ? query.descriptors
      : [query.descriptor];
  const celebDescriptors = getCelebrityDescriptors(celeb);
  if (celebDescriptors.length === 0) {
    return minTemplateDistance(query, celeb.descriptor);
  }
  let best = Infinity;
  for (const t of templates) {
    for (const cVec of celebDescriptors) {
      const d = ensembleDistance(t, cVec);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Decoupled Two-Stage Celebrity Match Reranker:
 * 
 * Stage 1: Coarse Multi-Vector Search (K1 = 30)
 *   Finds top 30 candidate identities based on minimum ensemble distance across all
 *   multi-reference vectors (referenceVectors, descriptors, descriptor).
 * 
 * Stage 2: Fine Morphological Reranker (K2 = 5)
 *   Reranks top 30 candidates into top 5 identities by integrating 23-d morphological
 *   sub-distance, crossDemographicMismatchPenalty(uFeat, cFeat), 68-point landmark
 *   alignment, and pose dynamic weighting (w_geom = round3(0.10 * max(0.2, cos(|yaw|)))).
 * 
 * Lookalike note:
 *   Weak neighbors (high distance) still return with honest UI copy.
 *   Only empty/noise-level distances return [] — never a false "photo quality" block.
 */
export function rankByDescriptor(
  user: UserFaceQuery,
  gallery: CelebrityEmbedding[],
  topK = 5,
  options?: { includeLongTail?: boolean },
): CelebrityMatch[] {
  const geomWeight = user.headPose
    ? getPoseAdaptiveLandmarkWeight(user.headPose, 0.10)
    : 0.10;
  const genderConf = Math.max(0, Math.min(1, user.genderProbability));

  const head = gallery.filter(isPrimaryGalleryEntry);
  const searchGallery =
    options?.includeLongTail || head.length === 0 ? gallery : head;

  // --- STAGE 1: Coarse Multi-Vector Search (Top-K1, K1 = 30) ---
  const coarseScored = searchGallery.map((celeb) => {
    const dist = minMultiVectorDistance(user, celeb);
    const g = genderAffinity(user.gender, user.genderProbability, celeb);
    const a = ageAffinity(user.age, celeb.age);
    const genderNudge =
      user.gender !== "unknown" && celeb.gender !== user.gender
        ? 0.10 * genderConf
        : 0;
    const ageNudge = 0.05 * (1 - a);
    const coarseAdjusted = dist + genderNudge + ageNudge;
    return { celeb, dist, coarseAdjusted, g, a };
  });

  // Deduplicate by celeb id: keep best bucket per id (lowest face distance, then coarseAdjusted)
  const bestById = new Map<string, (typeof coarseScored)[number]>();
  for (const s of coarseScored) {
    const prev = bestById.get(s.celeb.id);
    if (
      !prev ||
      s.dist < prev.dist - 1e-6 ||
      (Math.abs(s.dist - prev.dist) <= 1e-6 && s.coarseAdjusted < prev.coarseAdjusted)
    ) {
      bestById.set(s.celeb.id, s);
    }
  }
  const dedupedCoarse = Array.from(bestById.values());
  dedupedCoarse.sort((a, b) => a.dist - b.dist || a.coarseAdjusted - b.coarseAdjusted);

  const K1 = Math.min(30, dedupedCoarse.length);
  const coarseCandidates = dedupedCoarse.slice(0, K1);

  // --- STAGE 2: Fine Morphological Reranker (Top-K2, K2 = topK) ---
  const uCluster = user.ethnicCluster
    ?? (user.features ? getEthnicCluster({ id: "user", features: user.features }) : null);

  const fineScored = coarseCandidates.map((c) => {
    const celebFeatures = c.celeb.features ?? getCelebrityById(c.celeb.id)?.features;
    const cCluster = c.celeb.ethnicCluster
      ?? getEthnicCluster({ id: c.celeb.id, name: c.celeb.name, features: celebFeatures });
    const geomAffinityScore = geomAffinity(user.features, celebFeatures);
    const crossPenalty = crossDemographicMismatchPenalty(user.features, celebFeatures, uCluster, cCluster);

    const genderNudge =
      user.gender !== "unknown" && c.celeb.gender !== user.gender
        ? 0.10 * genderConf
        : 0;
    const ageNudge = 0.05 * (1 - c.a);
    const geomBonus = 0.04 * geomWeight * geomAffinityScore * 10; // ~0–0.04
    const adjusted = c.dist + crossPenalty + genderNudge + ageNudge - geomBonus + 1e-4;

    return {
      celeb: c.celeb,
      dist: c.dist,
      adjusted,
      g: c.g,
      a: c.a,
      geomAffinityScore,
      crossPenalty,
    };
  });

  // Primary sort: raw face distance + cross-demographic penalty.
  const FACE_TIE_EPS = 0.005;
  const byFaceThenDemo = (
    a: (typeof fineScored)[number],
    b: (typeof fineScored)[number],
  ) => {
    const gNudgeA = user.gender !== "unknown" && a.celeb.gender !== user.gender ? 0.10 * genderConf : 0;
    const gNudgeB = user.gender !== "unknown" && b.celeb.gender !== user.gender ? 0.10 * genderConf : 0;
    const fineDistA = a.dist + a.crossPenalty + gNudgeA;
    const fineDistB = b.dist + b.crossPenalty + gNudgeB;
    const dFace = fineDistA - fineDistB;
    if (Math.abs(dFace) > FACE_TIE_EPS) return dFace;
    // Near-tie: higher geom affinity first (landmark fusion), then gender/age
    const geomDelta = b.geomAffinityScore - a.geomAffinityScore;
    if (Math.abs(geomDelta) > 1e-4) return geomDelta;
    const demo = b.g + 0.5 * b.a - (a.g + 0.5 * a.a);
    if (Math.abs(demo) > 1e-4) return demo;
    return a.adjusted - b.adjusted;
  };

  let ordered = fineScored;
  ordered.sort(byFaceThenDemo);

  // Soft gender nudge already lives in byFaceThenDemo. Do not hard-partition
  // the list — that buried opposite-gender identities that were clearly closer.

  // Age/gender may break a true FaceNet near-tie only. Never invert a clearer face.
  const WEAK_AGE_FACE_EPS = 0.005;
  if (ordered.length > 1) {
    const poolN = Math.min(48, ordered.length);
    const pool = ordered.slice(0, poolN);
    const rest = ordered.slice(poolN);
    pool.sort((a, b) => {
      const faceA = a.dist + a.crossPenalty;
      const faceB = b.dist + b.crossPenalty;
      if (Math.abs(faceA - faceB) > WEAK_AGE_FACE_EPS) return faceA - faceB;
      const scoreA = faceA + 0.18 * (1 - a.a) + (a.g < 1 ? 0.08 * genderConf : 0);
      const scoreB = faceB + 0.18 * (1 - b.a) + (b.g < 1 ? 0.08 * genderConf : 0);
      if (Math.abs(scoreA - scoreB) > 1e-6) return scoreA - scoreB;
      return faceA - faceB;
    });
    ordered = [...pool, ...rest];
  }

  // Portrait quality (jpg vs 96px scrape) on a genuine FaceNet tie only.
  // Household fame must not invert a strictly closer face.
  const FAME_FACE_EPS = 0.003;
  const portraitQuality = (c: CelebrityEmbedding) => {
    const p = `${c.fallbackPath ?? ""} ${c.path ?? ""}`;
    if (p.includes(`/${c.id}.jpg`)) return 2;
    if (p.includes("/thumbs/96/")) return 0;
    return 1;
  };
  ordered.sort((a, b) => {
    const faceA = a.dist + a.crossPenalty;
    const faceB = b.dist + b.crossPenalty;
    if (Math.abs(faceA - faceB) > FAME_FACE_EPS) return 0;
    const pq = portraitQuality(b.celeb) - portraitQuality(a.celeb);
    if (pq !== 0) return pq;
    return householdFame(b.celeb.id) - householdFame(a.celeb.id);
  });

  // Always surface top-K face neighbors. Hard-empty only on noise-level distance.
  // (A 0.40 fine-distance cutoff was wiping valid weak results and the UI then
  // falsely said "Photo quality too low".)
  const top = ordered.slice(0, topK);
  if (top.length === 0 || top[0]!.dist > 1.15) {
    return [];
  }

  // Hero % from raw face distance only — cross-demo penalty is for ranking, not score inflation
  const percents = rankPercentsFromDistances(top.map((t) => t.dist));

  const captureConf = computeMatchConfidence(
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
    const matchPercent = percents[i] ?? 0;
    return {
      celebrityId: t.celeb.id,
      name: displayName,
      knownFor: meta.knownFor,
      matchPercent,
      rawScore: 1 / (1 + t.adjusted),
      confidenceScore: blendWithMatchConfidence(captureConf, matchPercent),
      traits: buildDescriptorTraits(user, t.celeb, t.dist),
      accentHue: meta.accentHue,
      initials: initials(displayName),
      tags: meta.tags,
      photoUrl: t.celeb.path,
      photoUrl192: anyPath.path192,
      fallbackPhotoUrl: anyPath.fallbackPath,
      distance: t.dist,
      ethnicCluster: t.celeb.ethnicCluster ?? getEthnicCluster(t.celeb),
    };
  });
}

function buildDescriptorTraits(
  user: UserFaceQuery,
  celeb: CelebrityEmbedding,
  distance: number,
): TraitInsight[] {
  // Facial structure must track the same Hill curve as the hero similarity %
  // (old 1 - d/0.95 overstated structure — e.g. 48% match showed 62% structure).
  const faceSim = Math.max(0, Math.min(1, distanceToMatchPercent(distance) / 100));
  const ageSim = ageAffinity(user.age, celeb.age);
  const genderSim =
    user.gender === "unknown"
      ? 0.7
      : user.gender === celeb.gender
        ? Math.min(1, 0.88 + 0.12 * user.genderProbability)
        : Math.max(0.08, 1 - user.genderProbability * 0.92);

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
