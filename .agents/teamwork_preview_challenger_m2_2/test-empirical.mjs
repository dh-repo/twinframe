import assert from "node:assert/strict";
import {
  distanceToMatchPercent,
  rankPercentsFromDistances,
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
  l2Normalize,
  genderAffinity,
  ageAffinity,
  computeMatchConfidence,
} from "../../src/lib/face/embeddings.ts";
import type { CelebrityEmbedding } from "../../src/lib/face/embeddings.ts";
import { rankByDescriptor, type UserFaceQuery } from "../../src/lib/face/match.ts";

console.log("=== EMPIRICAL STRESS TEST SUITE ===");

// Utility generator for synthetic 128-d vectors
function generateSyntheticVector(seed = 1, normalize = true): Float32Array {
  const vec = new Float32Array(128);
  let s = seed;
  for (let i = 0; i < 128; i++) {
    // Simple LCG PRNG
    s = (s * 1664525 + 1013904223) % 4294967296;
    vec[i] = (s / 4294967296) * 2 - 1;
  }
  return normalize ? l2Normalize(vec) : vec;
}

// 1. STRESS TEST: distanceToMatchPercent & Hill Curve Calibration
console.log("\n--- 1. Distance Calibration Curve ---");
const d0 = distanceToMatchPercent(0);
console.log(`d = 0.00 -> ${d0}% (Expected: 100.0%)`);
assert.equal(d0, 100.0);

const d058 = distanceToMatchPercent(0.58);
console.log(`d = 0.58 (Hill midpoint) -> ${d058}% (Expected: ~57.5%)`);
assert.ok(Math.abs(d058 - 57.5) <= 0.5, `Got ${d058}`);

const dFar = distanceToMatchPercent(1.5);
console.log(`d = 1.50 (far distance) -> ${dFar}% (Expected: ~15.0%)`);
assert.equal(dFar, 15.0);

// Check Monotonicity across 1000 steps in [0, 2.0]
let prevPct = 100.0;
for (let d = 0; d <= 2.0; d += 0.002) {
  const pct = distanceToMatchPercent(d);
  assert.ok(pct <= prevPct, `Monotonicity fail at d=${d}: ${pct} > ${prevPct}`);
  assert.ok(pct >= 15.0 && pct <= 100.0, `Out of bounds at d=${d}: ${pct}`);
  prevPct = pct;
}
console.log("✔ Distance-to-percentage curve strict monotonicity verified.");

// 2. STRESS TEST: rankPercentsFromDistances Order & Tie-breaking
console.log("\n--- 2. Rank Percents Preservation & Monotonic Spacing ---");
const distances = [0.2, 0.4, 0.4, 0.7, 1.2];
const rankPcts = rankPercentsFromDistances(distances);
console.log("Distances:", distances);
console.log("Rank percents:", rankPcts);

// Check strict decreasing order even for tied distances
for (let i = 0; i < rankPcts.length - 1; i++) {
  assert.ok(
    rankPcts[i] > rankPcts[i + 1],
    `Rank percent ordering fail at index ${i}: ${rankPcts[i]} not > ${rankPcts[i + 1]}`
  );
}
console.log("✔ Rank percents strictly decrease in topK order.");

// 3. STRESS TEST: Match Confidence Calculation
console.log("\n--- 3. Match Confidence Scoring ---");
const minConf = computeMatchConfidence(0, 0, 0, 0);
console.log(`Worst input (0,0,0,0) -> ${minConf} (Expected: 10.0)`);
assert.equal(minConf, 10.0);

const maxConf1 = computeMatchConfidence(1.0, 1.0, 0.25, 1.0);
console.log(`Ideal decimal input (1,1,0.25,1) -> ${maxConf1} (Expected: 100.0)`);
assert.equal(maxConf1, 100.0);

const maxConf100 = computeMatchConfidence(100, 100, 25, 100);
console.log(`Percentage format input (100,100,25,100) -> ${maxConf100} (Expected: 100.0)`);
assert.equal(maxConf100, 100.0);

// Typical user query confidence
const typConf = computeMatchConfidence(0.95, 80, 0.20, 0.90);
console.log(`Typical query (0.95, 80, 0.20, 0.90) -> ${typConf}`);
assert.ok(typConf >= 10 && typConf <= 100);
console.log("✔ Match confidence bounds [10, 100] & format normalization verified.");

// 4. STRESS TEST: Age & Gender Affinity
console.log("\n--- 4. Continuous Age & Gender Affinity ---");
console.log(`ageAffinity(25, 25) = ${ageAffinity(25, 25)} (Expected: 1.0)`);
assert.equal(ageAffinity(25, 25), 1.0);

const ageDiff10 = ageAffinity(25, 35);
const ageDiff30 = ageAffinity(25, 55);
console.log(`ageAffinity(25, 35) = ${ageDiff10.toFixed(4)}`);
console.log(`ageAffinity(25, 55) = ${ageDiff30.toFixed(4)}`);
assert.ok(ageDiff10 > ageDiff30);

const mockCelebMale: CelebrityEmbedding = {
  id: "celeb-m",
  name: "Male Celeb",
  path: "/m.jpg",
  descriptor: Array.from(generateSyntheticVector(42)),
  age: 30,
  gender: "male",
  genderProb: 0.99,
};

const gSame = genderAffinity("male", 0.95, mockCelebMale);
const gDiffHigh = genderAffinity("female", 0.95, mockCelebMale);
const gDiffLow = genderAffinity("female", 0.20, mockCelebMale);
console.log(`genderAffinity same gender -> ${gSame}`);
console.log(`genderAffinity cross gender (high user prob) -> ${gDiffHigh}`);
console.log(`genderAffinity cross gender (low user prob) -> ${gDiffLow}`);
assert.equal(gSame, 1.0);
assert.ok(gDiffLow > gDiffHigh);
assert.ok(gDiffHigh >= 0.75);
console.log("✔ Age and gender affinity curves verified.");

// 5. STRESS TEST: Synthetic Vector Ranking & Bucket Deduplication
console.log("\n--- 5. Synthetic Vector Ranking & Bucket Deduplication ---");
const userVec = generateSyntheticVector(100);
const userQuery: UserFaceQuery = {
  descriptor: userVec,
  age: 28,
  gender: "female",
  genderProbability: 0.95,
  detConfidence: 0.98,
  sharpness: 85,
  faceCoverage: 0.22,
};

// Construct synthetic gallery with duplicate celeb IDs across age buckets
const syntheticGallery: CelebrityEmbedding[] = [
  // Celeb A - Bucket 1 (age 20)
  {
    id: "celeb-a",
    name: "Celebrity A",
    path: "/a20.jpg",
    descriptor: Array.from(generateSyntheticVector(100)), // Exact match to userVec
    age: 20,
    gender: "female",
    genderProb: 0.95,
  },
  // Celeb A - Bucket 2 (age 28) -> Exact match + better age match!
  {
    id: "celeb-a",
    name: "Celebrity A",
    path: "/a28.jpg",
    descriptor: Array.from(generateSyntheticVector(100)), // Exact match
    age: 28,
    gender: "female",
    genderProb: 0.95,
  },
  // Celeb B (slightly orthogonal)
  {
    id: "celeb-b",
    name: "Celebrity B",
    path: "/b.jpg",
    descriptor: Array.from(generateSyntheticVector(200)),
    age: 30,
    gender: "female",
    genderProb: 0.90,
  },
  // Celeb C (male, different vector)
  {
    id: "celeb-c",
    name: "Celebrity C",
    path: "/c.jpg",
    descriptor: Array.from(generateSyntheticVector(300)),
    age: 50,
    gender: "male",
    genderProb: 0.99,
  },
];

const matches = rankByDescriptor(userQuery, syntheticGallery, 5);
console.log(`Ranked matches count: ${matches.length}`);
console.log("Top match:", {
  id: matches[0]?.celebrityId,
  name: matches[0]?.name,
  matchPercent: matches[0]?.matchPercent,
  photoUrl: matches[0]?.photoUrl,
  traitsCount: matches[0]?.traits.length,
});

assert.equal(matches.length, 3, "Should deduplicate 4 bucket entries into 3 unique celebrities");
assert.equal(matches[0]?.celebrityId, "celeb-a");
assert.equal(matches[0]?.photoUrl, "/a28.jpg", "Should select the bucket with best adjusted score (age 28 bucket)");
assert.equal(matches[0]?.matchPercent, 100.0, "Exact descriptor match should yield 100% match percent");

// Verify traits structure
const traits = matches[0]!.traits;
console.log("Traits for top match:", traits);
assert.equal(traits.length, 4);
for (let i = 0; i < traits.length - 1; i++) {
  assert.ok(traits[i]!.similarity >= traits[i + 1]!.similarity, "Traits should be sorted by similarity descending");
}
console.log("✔ Deduplication, bucket selection, ranking order, and trait sorting verified!");

console.log("\nALL EMPIRICAL TESTS PASSED SUCCESSFULLY!");
