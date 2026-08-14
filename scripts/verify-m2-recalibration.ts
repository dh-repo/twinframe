import { loadGalleryDataNode, type EvaluationReport } from "../scripts/evaluate-match-accuracy.ts";
import { euclideanDistance, cosineDistance } from "../src/lib/face/embeddings.ts";

const rootDir = process.cwd();
const fullGallery = loadGalleryDataNode(rootDir);

// Test candidate functions against evaluateMatchAccuracy runner logic
function evaluateCustomEnsemble(
  name: string,
  fn: (a: number[], b: number[]) => number
) {
  const posDists: number[] = [];
  const negDists: number[] = [];
  let rank1Count = 0;

  for (let idx = 0; idx < fullGallery.length; idx++) {
    const q = fullGallery[idx]!;
    const searchSpace = fullGallery.filter((b) => b !== q);

    let isCorrectRank1 = false;
    let minDiffDist = Infinity;
    let topMatchId = "";

    let sameCelebMatches = searchSpace.filter((b) => b.id === q.id);
    let posDist = 0;
    if (sameCelebMatches.length > 0) {
      let minD = Infinity;
      for (const candidate of sameCelebMatches) {
        const d = fn(q.descriptor, candidate.descriptor);
        if (d < minD) minD = d;
      }
      posDist = minD;
    }

    let diffCelebMatches = searchSpace.filter((b) => b.id !== q.id);
    let negDist = 1.0;
    if (diffCelebMatches.length > 0) {
      let minD = Infinity;
      for (const candidate of diffCelebMatches) {
        const d = fn(q.descriptor, candidate.descriptor);
        if (d < minD) minD = d;
      }
      negDist = minD;
    }

    let overallMin = Infinity;
    let top1Id = "";
    for (const candidate of searchSpace) {
      const d = fn(q.descriptor, candidate.descriptor);
      if (d < overallMin) {
        overallMin = d;
        top1Id = candidate.id;
      }
    }
    if (top1Id === q.id) rank1Count++;

    posDists.push(posDist);
    negDists.push(negDist);
  }

  const meanPosDist = posDists.reduce((a, b) => a + b, 0) / posDists.length;
  const meanNegDist = negDists.reduce((a, b) => a + b, 0) / negDists.length;
  const gap = meanNegDist - meanPosDist;
  const rank1Pct = (rank1Count / fullGallery.length) * 100;

  const baseGap = 0.26216106266613864;
  const delta = gap - baseGap;
  const improvementPct = (delta / baseGap) * 100;
  const pass = improvementPct >= 15.0 && rank1Pct >= 90.0;

  console.log(`=== ${name} ===`);
  console.log(`Mean Positive Dist (d_pos): ${meanPosDist.toFixed(6)}`);
  console.log(`Mean Negative Dist (d_neg): ${meanNegDist.toFixed(6)}`);
  console.log(`Separation Gap (Δ):          ${gap.toFixed(6)}`);
  console.log(`Separation Delta:           ${delta >= 0 ? "+" : ""}${delta.toFixed(6)}`);
  console.log(`Improvement vs Baseline:    ${improvementPct >= 0 ? "+" : ""}${improvementPct.toFixed(2)}% (Target: >= +15.0%)`);
  console.log(`Rank-1 Accuracy:            ${rank1Pct.toFixed(2)}%`);
  console.log(`Verification Result:        ${pass ? "PASS [✓]" : "FAIL [✗]"}\n`);
}

// Recommended formulation 1: Recalibrated Linear (0.90 * euc + 0.42 * cos)
evaluateCustomEnsemble("Recalibrated Linear (0.90*euc + 0.42*cos)", (a, b) => {
  const euc = euclideanDistance(a, b);
  const cos = cosineDistance(a, b);
  return 0.90 * euc + 0.42 * cos;
});

// Recommended formulation 2: Recalibrated Linear (0.85 * euc + 0.40 * cos)
evaluateCustomEnsemble("Recalibrated Linear (0.85*euc + 0.40*cos)", (a, b) => {
  const euc = euclideanDistance(a, b);
  const cos = cosineDistance(a, b);
  return 0.85 * euc + 0.40 * cos;
});

// Recommended formulation 3: Pure Euclidean (1.0 * euc)
evaluateCustomEnsemble("Pure Euclidean (1.0*euc)", (a, b) => {
  return euclideanDistance(a, b);
});
