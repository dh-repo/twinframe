import { loadGalleryDataNode } from "../scripts/evaluate-match-accuracy.ts";
import { euclideanDistance, cosineDistance } from "../src/lib/face/embeddings.ts";

const gallery = loadGalleryDataNode(process.cwd());
console.log(`Loaded gallery with ${gallery.length} embeddings.`);

// Analyze raw distributions of Euclidean and Cosine distances for negative pairs
const eucNegs: number[] = [];
const cosNegs: number[] = [];
const eucPos: number[] = [];
const cosPos: number[] = [];

for (let i = 0; i < gallery.length; i++) {
  const q = gallery[i]!;
  
  // Positives: same celeb candidates
  const sameCeleb = gallery.filter((b) => b !== q && b.id === q.id);
  if (sameCeleb.length > 0) {
    let minEuc = Infinity;
    let minCos = Infinity;
    for (const c of sameCeleb) {
      const e = euclideanDistance(q.descriptor, c.descriptor);
      const cos = cosineDistance(q.descriptor, c.descriptor);
      if (e < minEuc) minEuc = e;
      if (cos < minCos) minCos = cos;
    }
    eucPos.push(minEuc);
    cosPos.push(minCos);
  }

  // Negatives: top distractor
  const diffCeleb = gallery.filter((b) => b.id !== q.id);
  let minEuc = Infinity;
  let minCos = Infinity;
  for (const c of diffCeleb) {
    const e = euclideanDistance(q.descriptor, c.descriptor);
    const cos = cosineDistance(q.descriptor, c.descriptor);
    if (e < minEuc) minEuc = e;
    if (cos < minCos) minCos = cos;
  }
  eucNegs.push(minEuc);
  cosNegs.push(minCos);
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

console.log("--- RAW DISTANCE METRICS SUMMARY ---");
console.log(`Positives count: ${eucPos.length}`);
console.log(`Negatives count: ${eucNegs.length}`);
console.log(`Mean Euclidean Pos (e_pos): ${mean(eucPos).toFixed(6)}`);
console.log(`Mean Euclidean Neg (e_neg): ${mean(eucNegs).toFixed(6)}`);
console.log(`Euclidean Gap (e_neg - e_pos): ${(mean(eucNegs) - mean(eucPos)).toFixed(6)}`);
console.log(`Mean Cosine Pos (c_pos): ${mean(cosPos).toFixed(6)}`);
console.log(`Mean Cosine Neg (c_neg): ${mean(cosNegs).toFixed(6)}`);
console.log(`Cosine Gap (c_neg - c_pos): ${(mean(cosNegs) - mean(cosPos)).toFixed(6)}`);

// Current ensemble distance: 0.72 * euc + 0.28 * (cos * 0.85) = 0.72 * euc + 0.238 * cos
// Baseline gap: 0.262161

console.log("\n--- PARAMETER SWEEP FOR ensembleDistance(a, b) ---");

interface Result {
  wEuc: number;
  wCos: number;
  scaleCos: number;
  powerEuc: number;
  powerCos: number;
  meanPos: number;
  meanNeg: number;
  gap: number;
  improvementPct: number;
  rank1Acc: number;
  formula: string;
}

const baselineGap = 0.26216106266613864;

function evaluateFn(
  distFn: (a: number[], b: number[]) => number,
  wEuc: number,
  wCos: number,
  scaleCos: number,
  powerEuc: number,
  powerCos: number,
  formulaName: string
): Result {
  const posList: number[] = [];
  const negList: number[] = [];
  let correctRank1 = 0;

  for (let i = 0; i < gallery.length; i++) {
    const q = gallery[i]!;

    const searchSpace = gallery.filter((b) => b !== q);

    let minSameDist = 0;
    const sameCeleb = searchSpace.filter((b) => b.id === q.id);
    if (sameCeleb.length > 0) {
      let minD = Infinity;
      for (const c of sameCeleb) {
        const d = distFn(q.descriptor, c.descriptor);
        if (d < minD) minD = d;
      }
      minSameDist = minD;
    }

    let minDiffDist = Infinity;
    const diffCeleb = searchSpace.filter((b) => b.id !== q.id);
    for (const c of diffCeleb) {
      const d = distFn(q.descriptor, c.descriptor);
      if (d < minDiffDist) {
        minDiffDist = d;
      }
    }

    let overallMinDist = Infinity;
    let overallTopId = "";
    for (const c of searchSpace) {
      const d = distFn(q.descriptor, c.descriptor);
      if (d < overallMinDist) {
        overallMinDist = d;
        overallTopId = c.id;
      }
    }
    if (overallTopId === q.id) correctRank1++;

    posList.push(minSameDist);
    negList.push(minDiffDist);
  }

  const mPos = mean(posList);
  const mNeg = mean(negList);
  const gap = mNeg - mPos;
  const improvementPct = ((gap - baselineGap) / baselineGap) * 100;
  const rank1Acc = (correctRank1 / gallery.length) * 100;

  return {
    wEuc,
    wCos,
    scaleCos,
    powerEuc,
    powerCos,
    meanPos: mPos,
    meanNeg: mNeg,
    gap,
    improvementPct,
    rank1Acc,
    formula: formulaName,
  };
}

// 1. Current baseline
const baselineRes = evaluateFn(
  (a, b) => {
    const euc = euclideanDistance(a, b);
    const cos = cosineDistance(a, b);
    return 0.72 * euc + 0.28 * (cos * 0.85);
  },
  0.72, 0.28, 0.85, 1.0, 1.0, "Current Baseline (0.72*euc + 0.238*cos)"
);
console.log("\nBASELINE RESULT:", baselineRes);

// 2. Linear combination sweep (wEuc * euc + wCos * cos)
const linearResults: Result[] = [];
for (const wE of [0.0, 0.3, 0.5, 0.72, 0.8, 0.85, 0.9, 1.0, 1.1, 1.2]) {
  for (const wC of [0.0, 0.28, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0, 1.2]) {
    if (wE === 0 && wC === 0) continue;
    for (const sC of [0.85, 1.0, 1.15, 1.25, 1.5]) {
      const formula = `${wE}*euc + ${wC}*(cos*${sC})`;
      const res = evaluateFn(
        (a, b) => {
          const euc = euclideanDistance(a, b);
          const cos = cosineDistance(a, b);
          return wE * euc + wC * (cos * sC);
        },
        wE, wC, sC, 1.0, 1.0, formula
      );
      linearResults.push(res);
    }
  }
}

linearResults.sort((a, b) => b.gap - a.gap);
console.log("\nTop 10 Linear Formulations (by Gap):");
console.table(linearResults.slice(0, 10).map(r => ({
  formula: r.formula,
  gap: r.gap.toFixed(4),
  improvement: `${r.improvementPct.toFixed(2)}%`,
  rank1Acc: `${r.rank1Acc.toFixed(2)}%`
})));

// 3. Nonlinear / Power / Polynomial Formulations
const polyResults: Result[] = [];

// A: Power of L2 distance: e^p (e.g. p=1.2, 1.5, 1.8, 2.0)
for (const p of [1.1, 1.2, 1.25, 1.3, 1.35, 1.4, 1.5, 1.6, 1.75, 2.0]) {
  for (const wE of [0.5, 0.72, 0.8, 0.85, 0.9, 1.0, 1.1, 1.2]) {
    for (const wC of [0.0, 0.28, 0.35, 0.4, 0.5, 0.6]) {
      const formula = `${wE}*euc^${p} + ${wC}*cos`;
      const res = evaluateFn(
        (a, b) => {
          const euc = euclideanDistance(a, b);
          const cos = cosineDistance(a, b);
          return wE * Math.pow(euc, p) + wC * cos;
        },
        wE, wC, 1.0, p, 1.0, formula
      );
      polyResults.push(res);
    }
  }
}

// B: Cosine-enhanced linear: wE * euc + wC * cos + wCross * euc * cos
for (const wE of [0.72, 0.8, 0.85, 0.9, 1.0]) {
  for (const wC of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    for (const wX of [0.2, 0.35, 0.5, 0.7, 1.0]) {
      const formula = `${wE}*euc + ${wC}*cos + ${wX}*euc*cos`;
      const res = evaluateFn(
        (a, b) => {
          const euc = euclideanDistance(a, b);
          const cos = cosineDistance(a, b);
          return wE * euc + wC * cos + wX * euc * cos;
        },
        wE, wC, 1.0, 1.0, 1.0, formula
      );
      polyResults.push(res);
    }
  }
}

// C: Pure Cosine vs Pure Euclidean vs Squared Euclidean
polyResults.push(evaluateFn(
  (a, b) => euclideanDistance(a, b),
  1.0, 0.0, 0.0, 1.0, 1.0, "Pure Euclidean (1.0*euc)"
));
polyResults.push(evaluateFn(
  (a, b) => cosineDistance(a, b),
  0.0, 1.0, 1.0, 1.0, 1.0, "Pure Cosine (1.0*cos)"
));
polyResults.push(evaluateFn(
  (a, b) => Math.pow(euclideanDistance(a, b), 2),
  1.0, 0.0, 0.0, 2.0, 1.0, "Squared Euclidean (euc^2)"
));

polyResults.sort((a, b) => b.gap - a.gap);
console.log("\nTop 15 Nonlinear/Polynomial Formulations (by Gap):");
console.table(polyResults.slice(0, 15).map(r => ({
  formula: r.formula,
  gap: r.gap.toFixed(4),
  improvement: `${r.improvementPct.toFixed(2)}%`,
  rank1Acc: `${r.rank1Acc.toFixed(2)}%`
})));

