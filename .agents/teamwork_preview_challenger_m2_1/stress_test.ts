import {
  distanceToMatchPercent,
  rankPercentsFromDistances,
  ageAffinity,
  genderAffinity,
  computeMatchConfidence,
  euclideanDistance,
  cosineDistance,
  ensembleDistance,
  type CelebrityEmbedding,
} from "../../src/lib/face/embeddings.ts";
import { rankByDescriptor, type UserFaceQuery } from "../../src/lib/face/match.ts";

console.log("=== STARTING M2 EMPIRICAL STRESS TEST SUITE ===");

let passedTests = 0;
let totalTests = 0;

function assertTest(condition: boolean, description: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${description}`);
  } else {
    console.error(`[FAIL] ${description}`);
  }
}

// -------------------------------------------------------------
// TEST 1: Monotonicity evaluation across 1,000 fine evaluation steps in d in [0, 2.0]
// -------------------------------------------------------------
console.log("\n--- TEST 1: Monotonicity across 1,000 fine evaluation steps in d in [0, 2.0] ---");
const N_STEPS = 1000;
const d_start = 0.0;
const d_end = 2.0;
const step = (d_end - d_start) / N_STEPS;

let monotonicViolations = 0;
let maxStepDrop = 0;
let minVal = Infinity;
let maxVal = -Infinity;

const distances: number[] = [];
const percents: number[] = [];

for (let i = 0; i <= N_STEPS; i++) {
  const d = d_start + i * step;
  const p = distanceToMatchPercent(d);
  distances.push(d);
  percents.push(p);

  if (p < minVal) minVal = p;
  if (p > maxVal) maxVal = p;

  if (i > 0) {
    const prevP = percents[i - 1]!;
    if (p > prevP) {
      monotonicViolations++;
      console.error(`Monotonicity violation at d=${d}: previous p=${prevP}, current p=${p}`);
    } else {
      const drop = prevP - p;
      if (drop > maxStepDrop) maxStepDrop = drop;
    }
  }
}

assertTest(monotonicViolations === 0, `Monotonicity across 1,000 fine steps in [0, 2.0] (0 violations found, max step drop = ${maxStepDrop.toFixed(4)})`);
assertTest(maxVal === 100.0, `Maximum percentage at d=0 is 100.0 (got ${maxVal})`);
assertTest(minVal >= 15.0 && minVal <= 17.0, `Percentage at d=2.0 approaches asymptotic floor 15.0% (got ${minVal.toFixed(1)}%)`);

// -------------------------------------------------------------
// TEST 2: Edge Case Inputs (d=0, d<0, d=Infinity, -Infinity, NaN, large numbers)
// -------------------------------------------------------------
console.log("\n--- TEST 2: Edge Case Inputs ---");

const d_zero = distanceToMatchPercent(0);
assertTest(d_zero === 100.0, `d = 0 -> exact 100.0 (got ${d_zero})`);

const d_neg1 = distanceToMatchPercent(-0.5);
const d_neg_huge = distanceToMatchPercent(-1e9);
assertTest(d_neg1 === 100.0 && d_neg_huge === 100.0, `d < 0 -> clamped to 100.0 (got -0.5: ${d_neg1}, -1e9: ${d_neg_huge})`);

const d_inf = distanceToMatchPercent(Infinity);
assertTest(d_inf === 15.0, `d = Infinity -> returns minimum floor 15.0 (got ${d_inf})`);

const d_neg_inf = distanceToMatchPercent(-Infinity);
assertTest(d_neg_inf === 100.0, `d = -Infinity -> clamped to 100.0 (got ${d_neg_inf})`);

const d_nan = distanceToMatchPercent(NaN);
assertTest(Number.isNaN(d_nan) || d_nan === 15.0, `d = NaN -> safe evaluation (got ${d_nan})`);

const d_huge = distanceToMatchPercent(1e10);
assertTest(d_huge === 15.0, `d = 1e10 -> returns floor 15.0 (got ${d_huge})`);

// Key threshold checks
console.log(`Sample calibration points:
  d=0.00 -> ${distanceToMatchPercent(0.00)}%
  d=0.20 -> ${distanceToMatchPercent(0.20)}%
  d=0.35 -> ${distanceToMatchPercent(0.35)}%
  d=0.45 -> ${distanceToMatchPercent(0.45)}%
  d=0.58 -> ${distanceToMatchPercent(0.58)}% (inflection point ~ 57.5%)
  d=0.75 -> ${distanceToMatchPercent(0.75)}%
  d=1.00 -> ${distanceToMatchPercent(1.00)}%
  d=1.50 -> ${distanceToMatchPercent(1.50)}%
  d=2.00 -> ${distanceToMatchPercent(2.00)}%
`);

// -------------------------------------------------------------
// TEST 3: Age Affinity Smoothness & Continuity
// -------------------------------------------------------------
console.log("\n--- TEST 3: Age Affinity Smoothness ---");

const zeroDelta = ageAffinity(30, 30);
assertTest(zeroDelta === 1.0, `Zero age delta yields 1.0 (got ${zeroDelta})`);

let ageNonMonotonic = 0;
let maxDerivChange = 0;
let prevAff = 1.0;
let prevSlope = 0;

for (let delta = 0; delta <= 80; delta += 0.1) {
  const aff = ageAffinity(30, 30 + delta);
  if (aff > prevAff + 1e-9) {
    ageNonMonotonic++;
  }
  const slope = (aff - prevAff) / 0.1;
  if (delta > 0.1) {
    const derivChange = Math.abs(slope - prevSlope);
    if (derivChange > maxDerivChange) maxDerivChange = derivChange;
  }
  prevAff = aff;
  prevSlope = slope;
}

assertTest(ageNonMonotonic === 0, `Age affinity strictly decreases as age delta increases (0 violations)`);
assertTest(maxDerivChange < 0.05, `Age affinity derivative changes smoothly (max derivative step change = ${maxDerivChange.toFixed(5)})`);

// Edge case ages
const negAgeAff = ageAffinity(-5, 25);
const largeAgeAff = ageAffinity(20, 120);
assertTest(negAgeAff > 0 && negAgeAff <= 1.0, `Negative age handled gracefully (got ${negAgeAff.toFixed(4)})`);
assertTest(largeAgeAff > 0 && largeAgeAff <= 1.0, `Extreme age difference (100 yrs) handled gracefully (got ${largeAgeAff.toFixed(6)})`);

// -------------------------------------------------------------
// TEST 4: Ranking Order & Relative Ranking
// -------------------------------------------------------------
console.log("\n--- TEST 4: Ranking Order & Relative Ranking ---");

// Test rankPercentsFromDistances
const rawDists = [0.35, 0.45, 0.55, 0.65, 0.75];
const rankedPcts = rankPercentsFromDistances(rawDists);
console.log(`Input distances: [${rawDists.join(", ")}]`);
console.log(`Ranked percents: [${rankedPcts.join(", ")}]`);

let rankOrderPreserved = true;
for (let i = 0; i < rankedPcts.length - 1; i++) {
  if (rankedPcts[i]! <= rankedPcts[i + 1]!) {
    rankOrderPreserved = false;
  }
}
assertTest(rankOrderPreserved, `rankPercentsFromDistances preserves strict descending percentage order for ascending distances`);

// Test tied distances in rankPercentsFromDistances
const tiedDists = [0.50, 0.50, 0.50];
const tiedPcts = rankPercentsFromDistances(tiedDists);
console.log(`Tied distances [0.50, 0.50, 0.50] -> Ranked percents: [${tiedPcts.join(", ")}]`);
assertTest(
  tiedPcts[0]! > tiedPcts[1]! && tiedPcts[1]! > tiedPcts[2]!,
  `Tied distances produce strict monotonic tie-broken rank percentages`
);

// Test rankByDescriptor pipeline end-to-end with realistic descriptor distance
const mockUser: UserFaceQuery = {
  descriptor: new Float32Array(128).fill(0.1),
  age: 25,
  gender: "female",
  genderProbability: 0.95,
  detConfidence: 0.98,
  sharpness: 90,
  faceCoverage: 0.30,
};

const createDescriptor = (baseVal: number, offset: number) => {
  const arr = new Float32Array(128).fill(baseVal);
  arr[0] = baseVal + offset;
  return Array.from(arr);
};

const mockGallery: CelebrityEmbedding[] = [
  {
    id: "celeb-a",
    name: "Celeb A (Close match, age 60)",
    path: "/a1.webp",
    descriptor: createDescriptor(0.1, 0.05),
    age: 60,
    gender: "female",
    genderProb: 0.9,
  },
  {
    id: "celeb-a",
    name: "Celeb A (Close match, age 25)",
    path: "/a2.webp",
    descriptor: createDescriptor(0.1, 0.05),
    age: 25,
    gender: "female",
    genderProb: 0.9,
  },
  {
    id: "celeb-b",
    name: "Celeb B (Medium match)",
    path: "/b.webp",
    descriptor: createDescriptor(0.1, 0.15),
    age: 25,
    gender: "female",
    genderProb: 0.9,
  },
  {
    id: "celeb-c",
    name: "Celeb C (Distant match)",
    path: "/c.webp",
    descriptor: createDescriptor(0.1, 0.35),
    age: 25,
    gender: "female",
    genderProb: 0.9,
  },
];

const results = rankByDescriptor(mockUser, mockGallery, 5);
console.log("\nEnd-to-End rankByDescriptor Results:");
results.forEach((r, idx) => {
  console.log(` Rank ${idx + 1}: ${r.name} (id: ${r.celebrityId}) -> Match: ${r.matchPercent}%, Raw dist: ${r.distance.toFixed(4)}, Conf: ${r.confidenceScore}%`);
});

assertTest(results.length === 3, `Deduplicates multi-bucket gallery entries by celeb ID (expected 3 unique celebs, got ${results.length})`);
assertTest(results[0]?.celebrityId === "celeb-a", `Top match is celeb-a`);
assertTest(results[0]?.photoUrl === "/a2.webp", `Deduplication selects the best age-bucket (/a2.webp for age 25 vs /a1.webp for age 60) when distance > 0`);
assertTest(results[0]!.matchPercent > results[1]!.matchPercent, `Rank 1 percentage (${results[0]!.matchPercent}%) > Rank 2 percentage (${results[1]!.matchPercent}%)`);
assertTest(results[1]!.matchPercent > results[2]!.matchPercent, `Rank 2 percentage (${results[1]!.matchPercent}%) > Rank 3 percentage (${results[2]!.matchPercent}%)`);

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log(`\n=== STRESS TEST SUMMARY: ${passedTests} / ${totalTests} PASSED ===`);
if (passedTests === totalTests) {
  console.log("ALL EMPIRICAL TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
} else {
  console.error("SOME STRESS TESTS FAILED!");
  process.exit(1);
}
