import { getCelebrityDescriptors, l2Normalize, euclideanDistance, cosineDistance } from "../src/lib/face/embeddings.ts";
import type { CelebrityEmbedding, ReferenceVector, FaceFeatures } from "../src/lib/face/types.ts";
import { FEATURE_KEYS } from "../src/lib/face/types.ts";
import fs from "fs";
import path from "path";

function vecNorm(v: Float32Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!;
  }
  return Math.sqrt(sum);
}

let passedTests = 0;
let failedTests = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${testName}`);
  } else {
    failedTests++;
    const err = `  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ""}`;
    console.error(err);
    failures.push(err);
  }
}

console.log("=== ADVERSARIAL STRESS TEST: Milestone 1 ===");

// Section 1: getCelebrityDescriptors Precedence & Edge Cases
console.log("\n--- 1. Testing getCelebrityDescriptors ---");

// Test 1.1: Single vector legacy number[]
const legacyCeleb: CelebrityEmbedding = {
  id: "test-1",
  name: "Legacy Celeb",
  path: "/celebs/test-1.jpg",
  descriptor: [3, 4, 0, 0], // length 4 unnormalized
  age: 30,
  gender: "male",
  genderProb: 0.9,
};
const descs1 = getCelebrityDescriptors(legacyCeleb);
assert(descs1.length === 1, "Single vector legacy number[] returns 1 descriptor");
assert(descs1[0] instanceof Float32Array, "Returned descriptor is Float32Array");
assert(Math.abs(vecNorm(descs1[0]!) - 1.0) < 1e-5, "Returned descriptor is L2-normalized (norm=1.0)", `norm=${vecNorm(descs1[0]!)}`);
assert(Math.abs(descs1[0]![0]! - 0.6) < 1e-5 && Math.abs(descs1[0]![1]! - 0.8) < 1e-5, "Normalized values match expected [0.6, 0.8, 0, 0]");

// Test 1.2: Single vector Float32Array (already normalized)
const normVec = l2Normalize([1, 2, 3, 4]);
const float32Celeb: CelebrityEmbedding = {
  id: "test-2",
  name: "Float32 Celeb",
  path: "/celebs/test-2.jpg",
  descriptor: Array.from(normVec),
  descriptors: [normVec],
  age: 25,
  gender: "female",
  genderProb: 0.95,
};
const descs2 = getCelebrityDescriptors(float32Celeb);
assert(descs2.length === 1, "descriptors property takes precedence over descriptor");
assert(descs2[0] === normVec, "descriptors returns identity Float32Array reference without reallocation");

// Test 1.3: Multi-vector descriptors (Float32Array[])
const v1 = l2Normalize([1, 0, 0, 0]);
const v2 = l2Normalize([0, 1, 0, 0]);
const v3 = l2Normalize([0, 0, 1, 0]);
const multiCeleb: CelebrityEmbedding = {
  id: "test-3",
  name: "Multi Celeb",
  path: "/celebs/test-3.jpg",
  descriptor: Array.from(v1),
  descriptors: [v1, v2, v3],
  age: 40,
  gender: "male",
  genderProb: 0.8,
};
const descs3 = getCelebrityDescriptors(multiCeleb);
assert(descs3.length === 3, "descriptors returns all 3 Float32Array items");
assert(descs3[0] === v1 && descs3[1] === v2 && descs3[2] === v3, "Array items match exact references");

// Test 1.4: Precedence of referenceVectors over descriptors & descriptor
const refV1: ReferenceVector = { descriptor: l2Normalize([5, 12, 0, 0]), viewType: "frontal" };
const refV2: ReferenceVector = { descriptor: l2Normalize([0, 0, 3, 4]), viewType: "profile_left" };
const refCeleb: CelebrityEmbedding = {
  id: "test-4",
  name: "Ref Celeb",
  path: "/celebs/test-4.jpg",
  descriptor: [1, 0, 0, 0],
  descriptors: [v1],
  referenceVectors: [refV1, refV2],
  age: 35,
  gender: "female",
  genderProb: 0.99,
};
const descs4 = getCelebrityDescriptors(refCeleb);
assert(descs4.length === 2, "referenceVectors takes precedence over descriptors and descriptor");
assert(Math.abs(vecNorm(descs4[0]!) - 1.0) < 1e-5, "refV1 descriptor is normalized Float32Array");
assert(Math.abs(vecNorm(descs4[1]!) - 1.0) < 1e-5, "refV2 descriptor is normalized Float32Array");

// Test 1.5: ReferenceVector with unnormalized JS array in descriptor (defensive check)
const unnormRef: ReferenceVector = { descriptor: [10, 0, 0, 0] as unknown as Float32Array, viewType: "frontal" };
const unnormRefCeleb: CelebrityEmbedding = {
  id: "test-5",
  name: "Unnorm Ref Celeb",
  path: "/celebs/test-5.jpg",
  descriptor: [1, 0, 0, 0],
  referenceVectors: [unnormRef],
  age: 30,
  gender: "male",
  genderProb: 0.9,
};
const descs5 = getCelebrityDescriptors(unnormRefCeleb);
assert(descs5.length === 1, "unnormalized array in referenceVectors returns 1 item");
assert(descs5[0] instanceof Float32Array, "unnormalized referenceVector converted to Float32Array");
assert(Math.abs(vecNorm(descs5[0]!) - 1.0) < 1e-5, "unnormalized referenceVector is L2-normalized");

// Test 1.6: Empty/missing edge cases
const emptyCeleb1: CelebrityEmbedding = {
  id: "empty-1",
  name: "Empty 1",
  path: "/celebs/empty-1.jpg",
  descriptor: [],
  age: 30,
  gender: "male",
  genderProb: 0.5,
};
assert(getCelebrityDescriptors(emptyCeleb1).length === 0, "descriptor: [] returns empty array []");

const emptyCeleb2: CelebrityEmbedding = {
  id: "empty-2",
  name: "Empty 2",
  path: "/celebs/empty-2.jpg",
  descriptor: undefined as unknown as number[],
  descriptors: [],
  age: 30,
  gender: "male",
  genderProb: 0.5,
};
assert(getCelebrityDescriptors(emptyCeleb2).length === 0, "descriptors: [] returns empty array []");

const emptyCeleb3: CelebrityEmbedding = {
  id: "empty-3",
  name: "Empty 3",
  path: "/celebs/empty-3.jpg",
  descriptor: undefined as unknown as number[],
  referenceVectors: [],
  age: 30,
  gender: "male",
  genderProb: 0.5,
};
assert(getCelebrityDescriptors(emptyCeleb3).length === 0, "referenceVectors: [] returns empty array []");

// Section 2: L2-Normalization Invariant & Typed Array Stress Tests
console.log("\n--- 2. L2-Normalization Invariant ($||v||_2 = 1.0$) ---");

// Test 2.1: Standard 128-d random vector
const rand128 = new Array(128).fill(0).map(() => Math.random() * 2 - 1);
const norm128 = l2Normalize(rand128);
assert(norm128 instanceof Float32Array, "l2Normalize returns Float32Array");
assert(norm128.length === 128, "l2Normalize preserves vector dimension (128)");
assert(Math.abs(vecNorm(norm128) - 1.0) < 1e-6, `Random 128-d vector norm == 1.0 (got ${vecNorm(norm128)})`);

// Test 2.2: Extremes: Zero vector
const zeroVec = new Float32Array(128); // all 0s
const normZero = l2Normalize(zeroVec);
const zeroNorm = vecNorm(normZero);
console.log(`   [Info] Zero vector L2 norm after l2Normalize: ${zeroNorm}`);
assert(normZero.every((x) => x === 0), "Zero vector l2Normalize does not produce NaNs (returns 0-vector)");

// Test 2.3: Tiny magnitude vector (near subnormal)
const tinyVec = new Float32Array(128).fill(1e-18);
const normTiny = l2Normalize(tinyVec);
assert(!Number.isNaN(normTiny[0]), "Tiny magnitude vector does not result in NaN");
assert(Math.abs(vecNorm(normTiny) - 1.0) < 1e-4, `Tiny magnitude norm == 1.0 (got ${vecNorm(normTiny)})`);

// Test 2.4: Large magnitude vector (near Float32 max)
const hugeVec = new Float32Array(128).fill(1e18);
const normHuge = l2Normalize(hugeVec);
assert(!Number.isNaN(normHuge[0]), "Large magnitude vector does not overflow to NaN");
assert(Math.abs(vecNorm(normHuge) - 1.0) < 1e-4, `Large magnitude norm == 1.0 (got ${vecNorm(normHuge)})`);

// Test 2.5: Already normalized vector identity check
const reNorm = l2Normalize(norm128);
let maxDiff = 0;
for (let i = 0; i < 128; i++) {
  maxDiff = Math.max(maxDiff, Math.abs(norm128[i]! - reNorm[i]!));
}
assert(maxDiff < 1e-7, "Re-normalizing an already normalized vector is idempotent", `maxDiff=${maxDiff}`);

// Section 3: Gallery Features Dataset Integrity Audit
console.log("\n--- 3. Dataset Audit: public/celebs/gallery.features.json ---");
const featuresPath = path.join(process.cwd(), "public/celebs/gallery.features.json");
assert(fs.existsSync(featuresPath), "public/celebs/gallery.features.json exists");

const rawFeatures = fs.readFileSync(featuresPath, "utf-8");
const featuresMap = JSON.parse(rawFeatures) as Record<string, FaceFeatures>;
const celebCount = Object.keys(featuresMap).length;
console.log(`   [Info] Total celebrities in gallery.features.json: ${celebCount}`);
assert(celebCount >= 800, `gallery.features.json contains at least 800 celebrities (found ${celebCount})`);

let missingKeyCount = 0;
let invalidValueCount = 0;
let nanValueCount = 0;

for (const [id, feat] of Object.entries(featuresMap)) {
  for (const key of FEATURE_KEYS) {
    if (!(key in feat)) {
      missingKeyCount++;
      console.error(`Missing key ${key} in celeb ${id}`);
    } else {
      const val = feat[key];
      if (typeof val !== "number" || Number.isNaN(val)) {
        nanValueCount++;
      } else if (val < -100 || val > 100) { // Reasonable boundary check for normalized/LAB features
        invalidValueCount++;
      }
    }
  }
}

assert(missingKeyCount === 0, "All entries contain all 23 feature keys", `missingKeys=${missingKeyCount}`);
assert(nanValueCount === 0, "No NaN or non-number feature values", `nanValues=${nanValueCount}`);
assert(invalidValueCount === 0, "All feature values are within expected numerical boundaries", `invalidValues=${invalidValueCount}`);

// Summary
console.log("\n=== TEST RESULTS SUMMARY ===");
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);

if (failedTests > 0) {
  console.error("\nFailures:");
  failures.forEach((f) => console.error(f));
  process.exit(1);
} else {
  console.log("\nALL ADVERSARIAL CHECKS PASSED!");
  process.exit(0);
}
