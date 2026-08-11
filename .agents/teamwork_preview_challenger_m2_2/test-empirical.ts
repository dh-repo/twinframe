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
  type CelebrityEmbedding,
} from "../../src/lib/face/embeddings.ts";
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
console.log(`d = 1.50 -> ${dFar}% (Calculated by Hill equation: 18.9%)`);
assert.equal(dFar, 18.9);

const dAsymptote = distanceToMatchPercent(10.0);
console.log(`d = 10.0 (asymptote) -> ${dAsymptote}% (Expected floor: 15.0%)`);
assert.equal(dAsymptote, 15.0);

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
    rankPcts[i]! > rankPcts[i + 1]!,
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
    descriptor: Array.from(generateSyntheticVector(101)), // Slightly different descriptor
    age: 20,
    gender: "female",
    genderProb: 0.95,
  },
  // Celeb A - Bucket 2 (age 28) -> Same descriptor as Bucket 1, but exact age match!
  {
    id: "celeb-a",
    name: "Celebrity A",
    path: "/a28.jpg",
    descriptor: Array.from(generateSyntheticVector(101)),
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
assert.ok(matches[0]!.matchPercent > 0 && matches[0]!.matchPercent <= 100.0, "Match percent should be in valid [0, 100] range");

// 6. STRESS TEST: Edge cases and robust handling
console.log("\n--- 6. Edge Cases & Robust Handling ---");

// 6a. Missing optional quality fields in UserFaceQuery
const minimalQuery: UserFaceQuery = {
  descriptor: generateSyntheticVector(55),
  age: 35,
  gender: "unknown",
  genderProbability: 0.5,
};
const minimalMatches = rankByDescriptor(minimalQuery, syntheticGallery, 2);
assert.equal(minimalMatches.length, 2);
assert.ok(minimalMatches[0]!.confidenceScore >= 10 && minimalMatches[0]!.confidenceScore <= 100);
console.log("✔ Minimal user query (missing optional fields) handled gracefully.");

// 6b. Empty gallery
const emptyMatches = rankByDescriptor(userQuery, [], 5);
assert.equal(emptyMatches.length, 0);
console.log("✔ Empty gallery returns empty matches list [].");

// 6c. Performance & Scale Test with 1,000 synthetic gallery entries
const largeGallery: CelebrityEmbedding[] = [];
for (let i = 0; i < 1000; i++) {
  largeGallery.push({
    id: `celeb-${i % 100}`, // 100 unique celebs across 10 buckets each
    name: `Celebrity ${i % 100}`,
    path: `/celebs/${i}.jpg`,
    descriptor: Array.from(generateSyntheticVector(i + 1000)),
    age: 20 + (i % 60),
    gender: i % 2 === 0 ? "male" : "female",
    genderProb: 0.8 + (i % 20) / 100,
  });
}

const t0 = performance.now();
const scaleMatches = rankByDescriptor(userQuery, largeGallery, 10);
const t1 = performance.now();
console.log(`Ranked 1,000 gallery entries in ${(t1 - t0).toFixed(2)} ms.`);
assert.equal(scaleMatches.length, 10);
assert.ok(t1 - t0 < 50, "Ranking 1,000 items should take less than 50ms");
console.log("✔ Scale test (1,000 gallery entries) passed with excellent performance.");

console.log("\nALL EMPIRICAL TESTS PASSED SUCCESSFULLY!");
