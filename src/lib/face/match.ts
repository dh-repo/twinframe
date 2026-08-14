import { CELEBRITIES, getCelebrityById } from "../celebrities/database.ts";
import { initials } from "../celebrities/types.ts";
import {
  type CelebrityMatch,
  type FaceFeatures,
  type TraitInsight,
  type EthnicCluster,
  type MatchScoreResult,
  getEthnicCluster,
} from "./types.ts";
import { geomAffinity, crossDemographicMismatchPenalty, computeMorphologicalDistance, morphologicalDistance, ensureAnatomicalFeatures } from "./geometry.ts";
import type { RegionalOcclusionConfidence } from "./occlusion.ts";
import {
  estimateNuissanceDirections,
  projectIdentity,
  shouldProjectIdentity,
} from "./identity-project.ts";
import {
  type CelebrityEmbedding,
  ensembleDistance,
  fastEnsembleDistance,
  fastMinMultiVectorDistance,
  fastTopologicalManifoldDistance,
  getBestMatchingReferenceVector,
  getCelebrityDescriptors,
  rankPercentsFromDistances,
  distanceToMatchPercent,
  genderAffinity,
  ageAffinity,
  calibratedAgeGapPenalty,
  computeMatchConfidence,
  blendWithMatchConfidence,
  mergeWithProfile,
  combinedDescriptorDistance,
  computeMatchScore,
} from "./embeddings.ts";
import { getPoseAdaptiveLandmarkWeight, type HeadPose } from "./pose.ts";
import { WEAK_MATCH_MAX } from "../ux/honesty.ts";

/** Threshold for Dynamic Morphological Metric Tie-Breaking (R5: |\Delta d| < 0.015) */
export const MORPH_TIE_THRESHOLD_EPS = 0.015;

export {
  computeMatchConfidence,
  blendWithMatchConfidence,
  computeMatchScore,
  combinedDescriptorDistance,
  computeMorphologicalDistance,
  calibratedAgeGapPenalty,
};
export type { MatchScoreResult };

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
  /** Glasses/beard regional confidence for morph damping */
  occlusion?: RegionalOcclusionConfidence;
  /** Soft-wipe hair/age directions on the query (live photos only) */
  projectIdentity?: boolean;
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
    const d = fastEnsembleDistance(t, celebDescriptor);
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
  if (!query.descriptor || query.descriptor.length === 0) return 1.0;
  const qMain = query.descriptor instanceof Float32Array
    ? query.descriptor
    : Float32Array.from(query.descriptor);
  const qDescs = query.descriptors && query.descriptors.length > 0
    ? query.descriptors.map((d) => d instanceof Float32Array ? d : Float32Array.from(d))
    : [qMain];
  return fastMinMultiVectorDistance(qDescs, celeb, query.headPose);
}

function getTopKCoarseItems<T extends { dist: number; coarseAdjusted: number }>(items: T[], k: number): T[] {
  if (items.length <= k) {
    return items.slice().sort((a, b) => a.dist - b.dist || a.coarseAdjusted - b.coarseAdjusted);
  }
  const top: T[] = items.slice(0, k);
  let maxIdx = 0;
  for (let i = 1; i < k; i++) {
    if (top[i]!.dist > top[maxIdx]!.dist) maxIdx = i;
  }
  for (let i = k; i < items.length; i++) {
    const item = items[i]!;
    if (item.dist < top[maxIdx]!.dist) {
      top[maxIdx] = item;
      maxIdx = 0;
      for (let j = 1; j < k; j++) {
        if (top[j]!.dist > top[maxIdx]!.dist) maxIdx = j;
      }
    }
  }
  top.sort((a, b) => a.dist - b.dist || a.coarseAdjusted - b.coarseAdjusted);
  return top;
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
  if (!gallery || gallery.length === 0) return [];
  if (!user.descriptor || user.descriptor.length === 0) return [];

  const geomWeight = user.headPose
    ? getPoseAdaptiveLandmarkWeight(user.headPose, 0.10)
    : 0.10;
  const genderConf = Math.max(0, Math.min(1, user.genderProbability));

  let searchGallery = gallery;
  if (!options?.includeLongTail) {
    const head = gallery.filter(isPrimaryGalleryEntry);
    if (head.length > 0) searchGallery = head;
  }

  // Pre-convert query descriptors to Float32Array ONCE (zero allocation in loop)
  const qMain = user.descriptor instanceof Float32Array
    ? user.descriptor
    : Float32Array.from(user.descriptor);
  const qDescs = user.descriptors && user.descriptors.length > 0
    ? user.descriptors.map((d) => d instanceof Float32Array ? d : Float32Array.from(d))
    : [qMain];

  let qDescsProj: Float32Array[] | null = null;
  if (user.projectIdentity) {
    const residuals: Float32Array[] = [];
    for (const celeb of searchGallery) {
      const ds = getCelebrityDescriptors(celeb);
      if (ds.length < 2) continue;
      const primary = ds[0]!;
      for (let i = 1; i < ds.length; i++) {
        const extra = ds[i]!;
        if (extra.length !== primary.length) continue;
        const r = new Float32Array(primary.length);
        for (let k = 0; k < primary.length; k++) r[k] = (extra[k] ?? 0) - (primary[k] ?? 0);
        residuals.push(r);
      }
    }
    const dirs = estimateNuissanceDirections(residuals, 2);
    if (dirs.length > 0) qDescsProj = qDescs.map((d) => projectIdentity(d, dirs));
  }

  // Stage 1 target capacity K1 = max(30, topK * 2)
  const K1 = Math.max(30, topK * 2);

  // --- STAGE 1: Bounded Coarse Multi-Vector Search ---
  type CoarseItem = {
    celeb: CelebrityEmbedding;
    dist: number;
    coarseAdjusted: number;
    g: number;
    a: number;
  };
  const topK1List: CoarseItem[] = [];
  const bestById = new Map<string, CoarseItem>();
  let maxDistInTopK1 = Infinity;

  for (let i = 0; i < searchGallery.length; i++) {
    const celeb = searchGallery[i]!;

    const prev = bestById.get(celeb.id);
    const useProj =
      Boolean(qDescsProj) &&
      shouldProjectIdentity(user.age, celeb.age, user.features?.hairL, celeb.features?.hairL);
    const dist = fastMinMultiVectorDistance(
      useProj ? qDescsProj! : qDescs,
      celeb,
      user.headPose,
      maxDistInTopK1,
    );

    if (prev && dist >= prev.dist - 1e-6) {
      continue;
    }

    if (topK1List.length >= K1 && dist >= maxDistInTopK1) {
      continue;
    }

    const g = genderAffinity(user.gender, user.genderProbability, celeb);
    const a = ageAffinity(user.age, celeb.age);
    const ageGapPenalty = calibratedAgeGapPenalty(dist, user.age, celeb.age);
    const genderNudge =
      user.gender !== "unknown" && celeb.gender !== user.gender
        ? 0.10 * genderConf
        : 0;
    const ageNudge = 0.05 * (1 - a);
    const coarseAdjusted = dist + genderNudge + ageNudge + ageGapPenalty;

    const newItem: CoarseItem = { celeb, dist, coarseAdjusted, g, a };
    bestById.set(celeb.id, newItem);

    if (prev) {
      const existingIdx = topK1List.indexOf(prev);
      if (existingIdx >= 0) topK1List.splice(existingIdx, 1);
    }

    let low = 0;
    let high = topK1List.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const m = topK1List[mid]!;
      if (m.dist < dist || (m.dist === dist && m.coarseAdjusted <= coarseAdjusted)) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    topK1List.splice(low, 0, newItem);

    if (topK1List.length > K1) {
      const popped = topK1List.pop()!;
      bestById.delete(popped.celeb.id);
    }

    if (topK1List.length >= K1) {
      maxDistInTopK1 = topK1List[topK1List.length - 1]!.dist;
    } else {
      maxDistInTopK1 = Infinity;
    }
  }

  const topCoarse = topK1List;

  // --- STAGE 2: Fine Morphological Reranker (Top-K2, K2 = topK) ---
  const uCluster = user.ethnicCluster
    ?? (user.features ? getEthnicCluster({ id: "user", features: user.features }) : null);

  const fineScored = topCoarse.map((c) => {
    const celebFeatures = c.celeb.features ?? getCelebrityById(c.celeb.id)?.features;
    const cCluster = c.celeb.ethnicCluster
      ?? getEthnicCluster({ id: c.celeb.id, name: c.celeb.name, features: celebFeatures });
    const geomAffinityScore = geomAffinity(user.features, celebFeatures);
    const muteHair =
      typeof user.age === "number" && Math.abs(user.age - c.celeb.age) > 15;
    const crossPenalty =
      user.features && celebFeatures
        ? crossDemographicMismatchPenalty(
            morphologicalDistance(user.features, celebFeatures, { muteHair }),
            undefined,
            uCluster,
            cCluster,
          )
        : crossDemographicMismatchPenalty(user.features, celebFeatures, uCluster, cCluster);

    const genderNudge =
      user.gender !== "unknown" && c.celeb.gender !== user.gender
        ? 0.10 * genderConf
        : 0;
    const ageNudge = 0.05 * (1 - c.a);
    const agePenalty = calibratedAgeGapPenalty(c.dist, user.age, c.celeb.age);
    const geomBonus = 0.04 * geomWeight * geomAffinityScore * 10; // ~0–0.04
    const adjusted = c.dist + crossPenalty + genderNudge + ageNudge + agePenalty - geomBonus + 1e-4;

    return {
      celeb: c.celeb,
      dist: c.dist,
      adjusted,
      g: c.g,
      a: c.a,
      geomAffinityScore,
      crossPenalty,
      agePenalty,
    };
  });

  // Primary sort: fine face distance + cross-demographic penalty with clinical morphological tie-breaking (R5).
  const byFaceThenDemo = (
    a: (typeof fineScored)[number],
    b: (typeof fineScored)[number],
  ) => {
    const gNudgeA = user.gender !== "unknown" && a.celeb.gender !== user.gender ? 0.10 * genderConf : 0;
    const gNudgeB = user.gender !== "unknown" && b.celeb.gender !== user.gender ? 0.10 * genderConf : 0;
    const dDeep = a.dist - b.dist;

    // Gate on raw FaceNet distance. Penalty/gender still rank outside the window,
    // but must not open the clinical morph window when |Δd_deep| >= 0.015.
    if (Math.abs(dDeep) >= MORPH_TIE_THRESHOLD_EPS) {
      const effA = a.dist + a.crossPenalty + gNudgeA + (a.agePenalty ?? 0);
      const effB = b.dist + b.crossPenalty + gNudgeB + (b.agePenalty ?? 0);
      return effA - effB;
    }

    const userFeat = user.features;
    const aFeat = a.celeb.features ?? getCelebrityById(a.celeb.id)?.features;
    const bFeat = b.celeb.features ?? getCelebrityById(b.celeb.id)?.features;

    const dMorphA = computeMorphologicalDistance(userFeat, aFeat, user.occlusion);
    const dMorphB = computeMorphologicalDistance(userFeat, bFeat, user.occlusion);

    const wMorph = 0.04;
    const dFinalA = a.dist + wMorph * dMorphA;
    const dFinalB = b.dist + wMorph * dMorphB;
    const dFinalDiff = dFinalA - dFinalB;

    if (Math.abs(dFinalDiff) > 1e-6) return dFinalDiff;

    // Secondary fallback: higher landmark geometric affinity first, then demographic prior
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

  // Age/gender may break a true FaceNet near-tie only. Preserves R5 morphological tie-breaking when |Δd| < 0.015.
  if (ordered.length > 1) {
    const poolN = Math.min(48, ordered.length);
    const pool = ordered.slice(0, poolN);
    const rest = ordered.slice(poolN);
    pool.sort((a, b) => {
      if (Math.abs(a.dist - b.dist) >= MORPH_TIE_THRESHOLD_EPS) {
        const effA = a.dist + a.crossPenalty + (a.agePenalty ?? 0);
        const effB = b.dist + b.crossPenalty + (b.agePenalty ?? 0);
        return effA - effB;
      }
      return byFaceThenDemo(a, b);
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
    const dFace = Math.abs(a.dist - b.dist);
    if (dFace > FAME_FACE_EPS) return 0;
    // R5 owns |Δd_deep| < 0.015: fame/portrait may not invert a morphological decision.
    if (dFace < MORPH_TIE_THRESHOLD_EPS) {
      if (!user.features) return 0;
      const dMorphA = computeMorphologicalDistance(
        user.features,
        a.celeb.features ?? getCelebrityById(a.celeb.id)?.features,
        user.occlusion,
      );
      const dMorphB = computeMorphologicalDistance(
        user.features,
        b.celeb.features ?? getCelebrityById(b.celeb.id)?.features,
        user.occlusion,
      );
      if (Math.abs(dMorphA - dMorphB) > 1e-4) return 0;
    }
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

  // Weak neighborhood: display order must follow effective distance so age & cross-demo penalties are preserved.
  // Soft/strong (≥55%) keep look-alike ranking (R5, fame, demo).
  const bestPct = distanceToMatchPercent(Math.min(...top.map((t) => t.dist)));
  if (bestPct < WEAK_MATCH_MAX) {
    top.sort((a, b) => {
      const effA = a.dist + a.crossPenalty + (a.agePenalty ?? 0);
      const effB = b.dist + b.crossPenalty + (b.agePenalty ?? 0);
      return effA - effB || a.dist - b.dist || a.celeb.id.localeCompare(b.celeb.id);
    });
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
    const celebFeatures = t.celeb.features ?? getCelebrityById(t.celeb.id)?.features;
    const cCluster = t.celeb.ethnicCluster ?? getEthnicCluster({ id: t.celeb.id, name: t.celeb.name, features: celebFeatures });
    
    const bestMatch = getBestMatchingReferenceVector(qDescs, t.celeb, user.headPose);
    const bestDesc = bestMatch.descriptor;
    const bestFeat = bestMatch.refVec?.features ?? celebFeatures;

    const matchScore = computeMatchScore(
      user.descriptor,
      bestDesc,
      user.features,
      bestFeat,
      {
        headPose: user.headPose,
        ethnicClusterA: uCluster,
        ethnicClusterB: cCluster,
        userAge: user.age,
        celebAge: t.celeb.age,
      },
    );

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
      ethnicCluster: cCluster,
      matchScoreResult: matchScore,
      passedLookalikeGate: matchScore.passedLookalikeGate,
    };
  });
}

/**
 * Two-Stage candidate search and ranking engine matching contract in PROJECT.md:
 * Stage 1: Fast coarse dot-product / distance gating on candidate array to select Top 30-50 candidates in < 2ms.
 * Stage 2: Fine morphological reranking with pose weighting and hill-curve similarity scoring.
 */
export function rankCandidates(
  user: UserFaceQuery,
  gallery: CelebrityEmbedding[],
  topK = 5,
  options?: { includeLongTail?: boolean },
): CelebrityMatch[] {
  return rankByDescriptor(user, gallery, topK, options);
}

export function rankCandidatesTwoStage(
  user: UserFaceQuery,
  gallery: CelebrityEmbedding[],
  topK = 5,
  options?: { includeLongTail?: boolean },
): CelebrityMatch[] {
  return rankByDescriptor(user, gallery, topK, options);
}

/**
 * 4-Part Granular Anatomical Trait Breakdown Builder per ORIGINAL_REQUEST R3 & PROJECT.md §3:
 * 1. Facial Thirds & Forehead Proportions (facialThirds)
 * 2. Eye Spacing & Canthal Tilt (eyeCanthal)
 * 3. Nose Bridge & Width Index (noseBridge)
 * 4. Jawline Contour & Chin Sharpness (jawlineChin)
 */
export function buildDescriptorTraits(
  user: UserFaceQuery,
  celeb: CelebrityEmbedding,
  distance: number,
): TraitInsight[] {
  const uFeat = user.features;
  const cFeat = celeb.features ?? getCelebrityById(celeb.id)?.features;

  const uAnat = uFeat ? ensureAnatomicalFeatures(uFeat) : null;
  const cAnat = cFeat ? ensureAnatomicalFeatures(cFeat) : null;

  // Base fallback face similarity derived from descriptor distance via Hill curve
  const baseFaceSim = Math.max(0.05, Math.min(1.0, distanceToMatchPercent(distance) / 100));

  let thirdsSim = baseFaceSim;
  let eyeSim = baseFaceSim;
  let noseSim = baseFaceSim;
  let jawSim = baseFaceSim;

  if (uFeat && cFeat && uAnat && cAnat) {
    // 1. Facial Thirds & Forehead Proportions
    // Farkas vertical thirds (upper, middle, lower) + foreheadHeight + faceAspect
    const dUpperMid =
      Math.abs(uAnat.upperThirdRatio - cAnat.upperThirdRatio) +
      Math.abs(uAnat.middleThirdRatio - cAnat.middleThirdRatio);
    const dLower = Math.abs(uAnat.lowerThirdRatio - cAnat.lowerThirdRatio);
    const dForehead = Math.abs((uFeat.foreheadHeight ?? 0.5) - (cFeat.foreheadHeight ?? 0.5));
    const dAspect = Math.abs((uFeat.faceAspect ?? 0.5) - (cFeat.faceAspect ?? 0.5));
    const dThirds =
      0.50 * ((dUpperMid + dLower) / 0.35) +
      0.25 * (dForehead / 0.35) +
      0.25 * (dAspect / 0.35);
    thirdsSim = Math.max(0.05, Math.min(1.0, 1.0 - Math.min(1.0, dThirds) * 0.85));

    // 2. Eye Spacing & Canthal Tilt
    // Canthal tilt angle + ICD + eyeSpacing + eyeSlant
    const dTilt = Math.abs(uAnat.canthalTiltAngleDeg - cAnat.canthalTiltAngleDeg) / 25.0;
    const dIcd = Math.abs(uAnat.interCanthalDistance - cAnat.interCanthalDistance) / 0.12;
    const dSpacing = Math.abs((uFeat.eyeSpacing ?? 0.5) - (cFeat.eyeSpacing ?? 0.5)) / 0.30;
    const dSlant = Math.abs((uFeat.eyeSlant ?? 0.5) - (cFeat.eyeSlant ?? 0.5)) / 0.30;
    const dEyes =
      0.35 * Math.min(1.0, dTilt) +
      0.30 * Math.min(1.0, dIcd) +
      0.20 * Math.min(1.0, dSpacing) +
      0.15 * Math.min(1.0, dSlant);
    eyeSim = Math.max(0.05, Math.min(1.0, 1.0 - Math.min(1.0, dEyes) * 0.85));

    // 3. Nose Bridge & Width Index
    // Nasal index + noseLength + noseWidth
    const dNasalIndex = Math.abs(uAnat.nasalIndex - cAnat.nasalIndex) / 0.40;
    const dNoseLen = Math.abs((uFeat.noseLength ?? 0.5) - (cFeat.noseLength ?? 0.5)) / 0.30;
    const dNoseWid = Math.abs((uFeat.noseWidth ?? 0.5) - (cFeat.noseWidth ?? 0.5)) / 0.30;
    const dNose =
      0.50 * Math.min(1.0, dNasalIndex) +
      0.25 * Math.min(1.0, dNoseLen) +
      0.25 * Math.min(1.0, dNoseWid);
    noseSim = Math.max(0.05, Math.min(1.0, 1.0 - Math.min(1.0, dNose) * 0.85));

    // 4. Jawline Contour & Chin Sharpness
    // Gonial angle + bigonial ratio + jawWidth + chinSharpness
    const dGonial = Math.abs(uAnat.gonialJawlineAngleDeg - cAnat.gonialJawlineAngleDeg) / 30.0;
    const dBigonial = Math.abs(uAnat.bigonialToBizygomaticRatio - cAnat.bigonialToBizygomaticRatio) / 0.25;
    const dJawWid = Math.abs((uFeat.jawWidth ?? 0.5) - (cFeat.jawWidth ?? 0.5)) / 0.30;
    const dChin = Math.abs((uFeat.chinSharpness ?? 0.5) - (cFeat.chinSharpness ?? 0.5)) / 0.30;
    const dJaw =
      0.35 * Math.min(1.0, dGonial) +
      0.30 * Math.min(1.0, dBigonial) +
      0.20 * Math.min(1.0, dChin) +
      0.15 * Math.min(1.0, dJawWid);
    jawSim = Math.max(0.05, Math.min(1.0, 1.0 - Math.min(1.0, dJaw) * 0.85));
  }

  const clampSim = (s: number) => {
    if (Number.isNaN(s) || !Number.isFinite(s)) return 0.50;
    return Math.round(Math.max(0.0, Math.min(1.0, s)) * 100) / 100;
  };

  return [
    {
      trait: "facialThirds",
      label: "Facial Thirds & Forehead Proportions",
      userValue: uAnat ? uAnat.upperThirdRatio : 0.33,
      celebValue: cAnat ? cAnat.upperThirdRatio : 0.33,
      similarity: clampSim(thirdsSim),
    },
    {
      trait: "eyeCanthal",
      label: "Eye Spacing & Canthal Tilt",
      userValue: uAnat ? uAnat.interCanthalDistance : 0.30,
      celebValue: cAnat ? cAnat.interCanthalDistance : 0.30,
      similarity: clampSim(eyeSim),
    },
    {
      trait: "noseBridge",
      label: "Nose Bridge & Width Index",
      userValue: uAnat ? uAnat.nasalIndex : 0.75,
      celebValue: cAnat ? cAnat.nasalIndex : 0.75,
      similarity: clampSim(noseSim),
    },
    {
      trait: "jawlineChin",
      label: "Jawline Contour & Chin Sharpness",
      userValue: uAnat ? uAnat.bigonialToBizygomaticRatio : 0.75,
      celebValue: cAnat ? cAnat.bigonialToBizygomaticRatio : 0.75,
      similarity: clampSim(jawSim),
    },
  ];
}
