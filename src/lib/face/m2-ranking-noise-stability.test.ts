import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  l2Normalize,
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
  distanceToMatchPercent,
  rankPercentsFromDistances,
  type CelebrityEmbedding,
} from "./embeddings.ts";
import { rankByDescriptor, type UserFaceQuery } from "./match.ts";

/** Helper: Generate pseudo-random deterministic numbers in [0, 1) */
function pseudoRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Helper: Generate a random 128-d L2-normalized vector using Box-Muller transform */
function generateNormalizedVector(rand: () => number): Float32Array {
  const vec = new Float32Array(128);
  for (let i = 0; i < 128; i += 2) {
    const u1 = Math.max(1e-10, rand());
    const u2 = rand();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    vec[i] = z0;
    vec[i + 1] = z1;
  }
  return l2Normalize(vec);
}

/**
 * Helper: Add Gaussian feature noise with target L2 perturbation magnitude `eta`
 * In 128-d, component stddev sigma = eta / sqrt(128).
 */
function addGaussianVectorNoise(vec: ArrayLike<number>, eta: number, rand: () => number): Float32Array {
  if (eta === 0) return l2Normalize(vec);
  const dim = vec.length;
  const sigma = eta / Math.sqrt(dim);
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i += 2) {
    const u1 = Math.max(1e-10, rand());
    const u2 = rand();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    out[i] = (vec[i] ?? 0) + z0 * sigma;
    if (i + 1 < dim) {
      out[i + 1] = (vec[i + 1] ?? 0) + z1 * sigma;
    }
  }
  return l2Normalize(out);
}

/** Helper: Jaccard similarity between two arrays of strings */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

describe("M2 Candidate Ranking Stability Across Feature Noise", () => {
  const rand = pseudoRandom(42);

  // Generate synthetic gallery of 50 celebrities
  const gallery: CelebrityEmbedding[] = [];
  for (let i = 0; i < 50; i++) {
    const id = `celeb_${i}`;
    gallery.push({
      id,
      name: `Celebrity ${i}`,
      path: `/celebs/${id}.webp`,
      descriptor: Array.from(generateNormalizedVector(rand)),
      age: 20 + (i % 50),
      gender: i % 2 === 0 ? "male" : "female",
      genderProb: 0.95,
    });
  }

  it("retains Rank-1 match for mild noise (L2 perturbation eta <= 0.05)", () => {
    let rank1Retained = 0;
    const trials = 50;

    for (let t = 0; t < trials; t++) {
      const targetCeleb = gallery[t % gallery.length]!;
      const queryUser: UserFaceQuery = {
        descriptor: targetCeleb.descriptor,
        age: targetCeleb.age,
        gender: targetCeleb.gender,
        genderProbability: 0.95,
      };

      // Clean query
      const cleanMatches = rankByDescriptor(queryUser, gallery, 5);
      assert.equal(cleanMatches[0]?.celebrityId, targetCeleb.id);

      // Noised query (L2 perturbation eta = 0.05)
      const noisedDesc = addGaussianVectorNoise(targetCeleb.descriptor, 0.05, rand);
      const noisedUser: UserFaceQuery = {
        ...queryUser,
        descriptor: Array.from(noisedDesc),
      };

      const noisedMatches = rankByDescriptor(noisedUser, gallery, 5);
      if (noisedMatches[0]?.celebrityId === targetCeleb.id) {
        rank1Retained++;
      }
    }

    const retentionRate = (rank1Retained / trials) * 100;
    assert.ok(
      retentionRate >= 95.0,
      `Expected Rank-1 retention under eta=0.05 to be >= 95%, got ${retentionRate}%`
    );
  });

  it("maintains high Top-5 Jaccard overlap under moderate noise (L2 perturbation eta = 0.08)", () => {
    let totalJaccard = 0;
    const trials = 50;

    for (let t = 0; t < trials; t++) {
      const targetCeleb = gallery[t % gallery.length]!;
      const cleanUser: UserFaceQuery = {
        descriptor: targetCeleb.descriptor,
        age: targetCeleb.age,
        gender: targetCeleb.gender,
        genderProbability: 0.95,
      };

      const cleanMatches = rankByDescriptor(cleanUser, gallery, 5).map((m) => m.celebrityId);

      const noisedDesc = addGaussianVectorNoise(targetCeleb.descriptor, 0.08, rand);
      const noisedUser: UserFaceQuery = {
        ...cleanUser,
        descriptor: Array.from(noisedDesc),
      };

      const noisedMatches = rankByDescriptor(noisedUser, gallery, 5).map((m) => m.celebrityId);
      totalJaccard += jaccardSimilarity(cleanMatches, noisedMatches);
    }

    const meanJaccard = totalJaccard / trials;
    assert.ok(
      meanJaccard >= 0.70,
      `Expected Top-5 Jaccard similarity under eta=0.08 to be >= 0.70, got ${meanJaccard}`
    );
  });

  it("exhibits monotonic degradation of match percentage with increasing feature noise", () => {
    const celeb = gallery[0]!;
    const etas = [0.0, 0.02, 0.05, 0.10, 0.20, 0.35];
    const avgPercents: number[] = [];

    for (const eta of etas) {
      let sumPct = 0;
      const subTrials = 30;
      for (let k = 0; k < subTrials; k++) {
        const desc = addGaussianVectorNoise(celeb.descriptor, eta, rand);
        const user: UserFaceQuery = {
          descriptor: Array.from(desc),
          age: celeb.age,
          gender: celeb.gender,
          genderProbability: 0.95,
        };
        const matches = rankByDescriptor(user, gallery, 1);
        sumPct += matches[0]?.matchPercent ?? 0;
      }
      avgPercents.push(sumPct / subTrials);
    }

    // Check monotonic decrease in average match percentage
    for (let i = 1; i < avgPercents.length; i++) {
      assert.ok(
        avgPercents[i]! <= avgPercents[i - 1]! + 0.5,
        `Expected match percentage to decrease with noise. Step ${i-1} (${avgPercents[i-1]}%) vs Step ${i} (${avgPercents[i]}%)`
      );
    }

    // Clean match percentage should be 100%
    assert.equal(avgPercents[0], 100.0);
    // Heavy noise (eta = 0.35) should drop score significantly below clean match
    assert.ok(avgPercents[5]! < 75.0, `Expected heavy noise score < 75%, got ${avgPercents[5]}`);
  });

  it("handles unnormalized or perturbed noisy vectors without numerical breakdown", () => {
    const rawVec = new Float32Array(128).fill(0.1);

    // ensembleDistance with unnormalized rawVec
    const d1 = ensembleDistance(rawVec, gallery[0]!.descriptor);
    assert.ok(Number.isFinite(d1), "ensembleDistance should handle unnormalized vectors");
    assert.ok(d1 >= 0, "ensembleDistance should be non-negative");

    // distanceToMatchPercent with extreme inputs
    assert.equal(distanceToMatchPercent(0), 100.0);
    assert.equal(distanceToMatchPercent(100), 15.0);
    assert.equal(distanceToMatchPercent(-5), 100.0);

    // rankPercentsFromDistances with tied/close distances
    const distances = [0.1, 0.1, 0.1000001, 0.32, 0.8];
    const percents = rankPercentsFromDistances(distances);
    assert.equal(percents.length, 5);
    for (let i = 1; i < percents.length; i++) {
      assert.ok(
        percents[i]! <= percents[i - 1]!,
        `rankPercentsFromDistances should be non-increasing. Index ${i-1} (${percents[i-1]}%) vs Index ${i} (${percents[i]}%)`
      );
    }
  });

  it("preserves distance separation gap (d_neg > d_pos) under noise", () => {
    let countSeparated = 0;
    const trials = 30;

    for (let t = 0; t < trials; t++) {
      const targetCeleb = gallery[t]!;
      const noisedDesc = addGaussianVectorNoise(targetCeleb.descriptor, 0.06, rand);

      const d_pos = ensembleDistance(noisedDesc, targetCeleb.descriptor);
      const otherCeleb = gallery[(t + 1) % gallery.length]!;
      const d_neg = ensembleDistance(noisedDesc, otherCeleb.descriptor);

      if (d_neg > d_pos) {
        countSeparated++;
      }
    }

    assert.ok(
      countSeparated >= 28,
      `Expected true match distance d_pos to be smaller than distractor d_neg in >= 28/30 cases under noise, got ${countSeparated}`
    );
  });
});
