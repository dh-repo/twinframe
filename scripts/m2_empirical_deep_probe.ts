import fs from "fs";
import { morphologicalDistance, crossDemographicMismatchPenalty } from "../src/lib/face/geometry.ts";
import { FaceFeatures } from "../src/lib/face/types.ts";

console.log("=== M2 EMPIRICAL DEEP PROBE ===");

// Load real gallery features
const galleryFeatures: Record<string, FaceFeatures> = JSON.parse(
  fs.readFileSync("public/celebs/gallery.features.json", "utf8")
);

// Synthetic demographic profile vectors (matching scripts/m2_challenger_demographics.test.ts)
const EastAsian: FaceFeatures = {
  eyeSlant: 0.25, eyeSpacing: 0.42, eyeOpenness: 0.35,
  cheekboneProminence: 0.65, faceRoundness: 0.60, faceAspect: 0.72, foreheadHeight: 0.50,
  noseLength: 0.45, noseWidth: 0.55,
  jawWidth: 0.50, chinSharpness: 0.45, mouthWidth: 0.48, lipFullness: 0.45, browHeight: 0.45,
  skinL: 0.75, skinA: 0.12, skinB: 0.18,
  hairL: 0.15, hairA: 0.02, hairB: 0.03,
  masculine: 0.50, feminine: 0.50, youthfulness: 0.60,
};

const EastAsian_Var1: FaceFeatures = {
  ...EastAsian,
  eyeSlant: 0.26, eyeSpacing: 0.43, cheekboneProminence: 0.64, noseWidth: 0.54, skinL: 0.76,
};

const EastAsian_Var2: FaceFeatures = {
  ...EastAsian,
  eyeSlant: 0.24, eyeSpacing: 0.41, cheekboneProminence: 0.66, noseWidth: 0.56, skinL: 0.74,
};

const Caucasian: FaceFeatures = {
  eyeSlant: 0.10, eyeSpacing: 0.50, eyeOpenness: 0.48,
  cheekboneProminence: 0.45, faceRoundness: 0.45, faceAspect: 0.85, foreheadHeight: 0.55,
  noseLength: 0.62, noseWidth: 0.38,
  jawWidth: 0.62, chinSharpness: 0.60, mouthWidth: 0.52, lipFullness: 0.38, browHeight: 0.55,
  skinL: 0.85, skinA: 0.08, skinB: 0.14,
  hairL: 0.45, hairA: 0.10, hairB: 0.25,
  masculine: 0.50, feminine: 0.50, youthfulness: 0.50,
};

const Caucasian_Var1: FaceFeatures = {
  ...Caucasian,
  eyeSpacing: 0.51, noseLength: 0.61, jawWidth: 0.61, skinL: 0.86,
};

const Caucasian_Var2: FaceFeatures = {
  ...Caucasian,
  eyeSpacing: 0.49, noseLength: 0.63, jawWidth: 0.63, skinL: 0.84,
};

const African: FaceFeatures = {
  eyeSlant: 0.12, eyeSpacing: 0.52, eyeOpenness: 0.52,
  cheekboneProminence: 0.58, faceRoundness: 0.55, faceAspect: 0.78, foreheadHeight: 0.52,
  noseLength: 0.48, noseWidth: 0.72,
  jawWidth: 0.68, chinSharpness: 0.40, mouthWidth: 0.62, lipFullness: 0.75, browHeight: 0.48,
  skinL: 0.35, skinA: 0.18, skinB: 0.22,
  hairL: 0.12, hairA: 0.02, hairB: 0.03,
  masculine: 0.50, feminine: 0.50, youthfulness: 0.50,
};

const African_Var1: FaceFeatures = {
  ...African,
  noseWidth: 0.71, lipFullness: 0.74, skinL: 0.36,
};

const African_Var2: FaceFeatures = {
  ...African,
  noseWidth: 0.73, lipFullness: 0.76, skinL: 0.34,
};

const Hispanic: FaceFeatures = {
  eyeSlant: 0.14, eyeSpacing: 0.48, eyeOpenness: 0.45,
  cheekboneProminence: 0.52, faceRoundness: 0.50, faceAspect: 0.80, foreheadHeight: 0.52,
  noseLength: 0.54, noseWidth: 0.48,
  jawWidth: 0.58, chinSharpness: 0.52, mouthWidth: 0.54, lipFullness: 0.48, browHeight: 0.52,
  skinL: 0.65, skinA: 0.14, skinB: 0.20,
  hairL: 0.20, hairA: 0.04, hairB: 0.06,
  masculine: 0.50, feminine: 0.50, youthfulness: 0.50,
};

const Hispanic_Var1: FaceFeatures = {
  ...Hispanic,
  skinL: 0.66, noseLength: 0.53, jawWidth: 0.57,
};

const Hispanic_Var2: FaceFeatures = {
  ...Hispanic,
  skinL: 0.64, noseLength: 0.55, jawWidth: 0.59,
};

// 1. Synthetic Matrix Verification
console.log("\n--- SECTION 1: SYNTHETIC DEMOGRAPHIC MATRIX ---");
const profiles = [
  { name: "EastAsian", feat: EastAsian },
  { name: "Caucasian", feat: Caucasian },
  { name: "African", feat: African },
  { name: "Hispanic", feat: Hispanic },
];

let syntheticPass = true;

for (let i = 0; i < profiles.length; i++) {
  for (let j = i + 1; j < profiles.length; j++) {
    const p1 = profiles[i];
    const p2 = profiles[j];
    const d = morphologicalDistance(p1.feat, p2.feat);
    const pen = crossDemographicMismatchPenalty(p1.feat, p2.feat);
    const ok = d > 0.35 && pen > 0;
    if (!ok) syntheticPass = false;
    console.log(`Cross [${p1.name} vs ${p2.name}]: D = ${d.toFixed(4)}, Penalty = ${pen.toFixed(4)} | Pass: ${ok}`);
  }
}

const intraProfiles = [
  { name: "East Asian Intra 1", f1: EastAsian, f2: EastAsian_Var1 },
  { name: "East Asian Intra 2", f1: EastAsian, f2: EastAsian_Var2 },
  { name: "Caucasian Intra 1", f1: Caucasian, f2: Caucasian_Var1 },
  { name: "Caucasian Intra 2", f1: Caucasian, f2: Caucasian_Var2 },
  { name: "African Intra 1", f1: African, f2: African_Var1 },
  { name: "African Intra 2", f1: African, f2: African_Var2 },
  { name: "Hispanic Intra 1", f1: Hispanic, f2: Hispanic_Var1 },
  { name: "Hispanic Intra 2", f1: Hispanic, f2: Hispanic_Var2 },
];

for (const ip of intraProfiles) {
  const d = morphologicalDistance(ip.f1, ip.f2);
  const pen = crossDemographicMismatchPenalty(ip.f1, ip.f2);
  const ok = d <= 0.35 && pen === 0;
  if (!ok) syntheticPass = false;
  console.log(`Intra [${ip.name}]: D = ${d.toFixed(4)}, Penalty = ${pen.toFixed(4)} | Pass: ${ok}`);
}

// 2. Key Celebrity Pairs Verification (from recalibration specs)
console.log("\n--- SECTION 2: REAL CELEBRITY GALLERY BENCHMARK PAIRS ---");
const celebPairs = [
  { c1: "brad-pitt", c2: "simu-liu", type: "cross" },
  { c1: "brad-pitt", c2: "idris-elba", type: "cross" },
  { c1: "brad-pitt", c2: "pedro-pascal", type: "cross" },
  { c1: "simu-liu", c2: "idris-elba", type: "cross" },
  { c1: "simu-liu", c2: "pedro-pascal", type: "cross" },
  { c1: "idris-elba", c2: "pedro-pascal", type: "cross" },
  { c1: "idris-elba", c2: "michael-b-jordan", type: "intra" },
  { c1: "pedro-pascal", c2: "ryan-gosling", type: "intra-like" },
];

let celebPass = true;
for (const cp of celebPairs) {
  const f1 = galleryFeatures[cp.c1];
  const f2 = galleryFeatures[cp.c2];
  if (!f1 || !f2) {
    console.error(`ERROR: Missing feature for ${cp.c1} or ${cp.c2}`);
    celebPass = false;
    continue;
  }
  const d = morphologicalDistance(f1, f2);
  const pen = crossDemographicMismatchPenalty(f1, f2);
  
  if (cp.type === "cross") {
    const ok = d > 0.35 && pen > 0;
    if (!ok) celebPass = false;
    console.log(`Real Cross [${cp.c1} vs ${cp.c2}]: D = ${d.toFixed(4)}, Penalty = ${pen.toFixed(4)} | Pass: ${ok}`);
  } else {
    const ok = d <= 0.35 && pen === 0;
    console.log(`Real Intra [${cp.c1} vs ${cp.c2}]: D = ${d.toFixed(4)}, Penalty = ${pen.toFixed(4)} | Satisfies <= 0.35: ${ok}`);
  }
}

// 3. Mathematical Invariants Verification
console.log("\n--- SECTION 3: MATHEMATICAL INVARIANTS ---");
let invPass = true;

// Identity: D(A, A) === 0
const dIdent = morphologicalDistance(EastAsian, EastAsian);
const penIdent = crossDemographicMismatchPenalty(EastAsian, EastAsian);
if (dIdent !== 0 || penIdent !== 0) {
  console.log(`FAIL: Identity D(A,A) = ${dIdent}, Pen = ${penIdent}`);
  invPass = false;
} else {
  console.log(`PASS: Identity D(A,A) === 0, Penalty === 0`);
}

// Null handling
const dNull1 = morphologicalDistance(null, EastAsian);
const dNull2 = morphologicalDistance(EastAsian, undefined);
const penNull1 = crossDemographicMismatchPenalty(null, EastAsian);
const penNull2 = crossDemographicMismatchPenalty(null);
if (dNull1 !== 0.50 || dNull2 !== 0.50 || penNull1 !== 0.0 || penNull2 !== 0.0) {
  console.log(`FAIL: Null handling D1=${dNull1}, D2=${dNull2}, Pen1=${penNull1}, Pen2=${penNull2}`);
  invPass = false;
} else {
  console.log(`PASS: Null handling returns 0.50 for D and 0.0 for Penalty`);
}

// Symmetry: D(A, B) === D(B, A)
const dAB = morphologicalDistance(EastAsian, Caucasian);
const dBA = morphologicalDistance(Caucasian, EastAsian);
if (Math.abs(dAB - dBA) > 1e-9) {
  console.log(`FAIL: Symmetry D(A,B) = ${dAB} vs D(B,A) = ${dBA}`);
  invPass = false;
} else {
  console.log(`PASS: Symmetry D(A,B) === D(B,A) (${dAB.toFixed(4)})`);
}

// Scalar overload vs feature pair overload parity
const penDirect = crossDemographicMismatchPenalty(EastAsian, Caucasian);
const penScalar = crossDemographicMismatchPenalty(dAB);
if (Math.abs(penDirect - penScalar) > 1e-9) {
  console.log(`FAIL: Parity direct=${penDirect} vs scalar=${penScalar}`);
  invPass = false;
} else {
  console.log(`PASS: Overload parity direct (${penDirect.toFixed(4)}) === scalar (${penScalar.toFixed(4)})`);
}

console.log("\n=== SUMMARY VERDICT ===");
console.log(`Synthetic Matrix: ${syntheticPass ? "PASS" : "FAIL"}`);
console.log(`Real Gallery Benchmark Pairs: ${celebPass ? "PASS" : "FAIL"}`);
console.log(`Mathematical Invariants: ${invPass ? "PASS" : "FAIL"}`);
