import { loadGalleryDataNode, evaluateMatchAccuracy } from "../scripts/evaluate-match-accuracy.ts";
import { euclideanDistance, cosineDistance } from "../src/lib/face/embeddings.ts";

const gallery = loadGalleryDataNode(process.cwd());

// Baseline reference values
const BASELINE_GAP = 0.26216106266613864;
const TARGET_GAP = BASELINE_GAP * 1.15; // 0.3014852

console.log(`Baseline Gap: ${BASELINE_GAP.toFixed(6)}`);
console.log(`Target (+15%): ${TARGET_GAP.toFixed(6)}\n`);

interface Candidate {
  id: string;
  name: string;
  wEuc: number;
  wCos: number;
  cosScale: number;
  eucPower: number;
  fn: (a: number[], b: number[]) => number;
  description: string;
}

// Candidates to test:
const candidates: Candidate[] = [
  {
    id: "baseline",
    name: "Current Baseline",
    wEuc: 0.72,
    wCos: 0.28,
    cosScale: 0.85,
    eucPower: 1.0,
    fn: (a, b) => 0.72 * euclideanDistance(a, b) + 0.28 * (cosineDistance(a, b) * 0.85),
    description: "0.72 * euc + 0.238 * cos"
  },
  {
    id: "pure_euc",
    name: "Pure Euclidean",
    wEuc: 1.0,
    wCos: 0.0,
    cosScale: 1.0,
    eucPower: 1.0,
    fn: (a, b) => euclideanDistance(a, b),
    description: "1.0 * euc"
  },
  {
    id: "balanced_euc_cos_1",
    name: "Equal Weight Normalized (0.5 euc + 0.5 cos*2.45)",
    wEuc: 0.5,
    wCos: 0.5,
    cosScale: 2.45,
    eucPower: 1.0,
    fn: (a, b) => {
      const euc = euclideanDistance(a, b);
      const cos = cosineDistance(a, b);
      // c_neg is ~0.0696, e_neg is ~0.3411 -> ratio e/c ~ 4.9. Scaling cos by 2.45 makes cos contribution equal to euc.
      return 0.5 * euc + 0.5 * (cos * 2.45);
    },
    description: "0.5 * euc + 1.225 * cos"
  },
  {
    id: "recalibrated_linear_85_40",
    name: "Recalibrated Linear (0.85 euc + 0.40 cos*1.0)",
    wEuc: 0.85,
    wCos: 0.40,
    cosScale: 1.0,
    eucPower: 1.0,
    fn: (a, b) => 0.85 * euclideanDistance(a, b) + 0.40 * cosineDistance(a, b),
    description: "0.85 * euc + 0.40 * cos"
  },
  {
    id: "recalibrated_linear_90_35",
    name: "Recalibrated Linear (0.90 euc + 0.35 cos*1.2)",
    wEuc: 0.90,
    wCos: 0.35,
    cosScale: 1.2,
    eucPower: 1.0,
    fn: (a, b) => 0.90 * euclideanDistance(a, b) + 0.35 * (cosineDistance(a, b) * 1.2),
    description: "0.90 * euc + 0.42 * cos"
  },
  {
    id: "recalibrated_linear_80_50",
    name: "Recalibrated Linear (0.80 euc + 0.50 cos*1.2)",
    wEuc: 0.80,
    wCos: 0.50,
    cosScale: 1.2,
    eucPower: 1.0,
    fn: (a, b) => 0.80 * euclideanDistance(a, b) + 0.50 * (cosineDistance(a, b) * 1.2),
    description: "0.80 * euc + 0.60 * cos"
  },
  {
    id: "recalibrated_power_1_15",
    name: "Power Recalibrated (0.75 euc^1.15 + 0.35 cos)",
    wEuc: 0.75,
    wCos: 0.35,
    cosScale: 1.0,
    eucPower: 1.15,
    fn: (a, b) => {
      const euc = euclideanDistance(a, b);
      const cos = cosineDistance(a, b);
      return 0.75 * Math.pow(euc, 1.15) + 0.35 * cos;
    },
    description: "0.75 * euc^1.15 + 0.35 * cos"
  },
  {
    id: "recalibrated_power_1_25",
    name: "Power Recalibrated (0.72 euc^1.25 + 0.28 cos)",
    wEuc: 0.72,
    wCos: 0.28,
    cosScale: 1.0,
    eucPower: 1.25,
    fn: (a, b) => {
      const euc = euclideanDistance(a, b);
      const cos = cosineDistance(a, b);
      return 0.72 * Math.pow(euc, 1.25) + 0.28 * cos;
    },
    description: "0.72 * euc^1.25 + 0.28 * cos"
  },
  {
    id: "cosine_scaled_linear_1",
    name: "Optimal Linear Ensemble (0.82 euc + 0.38 cos)",
    wEuc: 0.82,
    wCos: 0.38,
    cosScale: 1.0,
    eucPower: 1.0,
    fn: (a, b) => 0.82 * euclideanDistance(a, b) + 0.38 * cosineDistance(a, b),
    description: "0.82 * euc + 0.38 * cos"
  }
];

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

console.log("--- EVALUATING CANDIDATE FORMULATIONS ---");
console.log(
  "ID".padEnd(28) +
  "| Mean Pos (d_pos)".padEnd(20) +
  "| Mean Neg (d_neg)".padEnd(20) +
  "| Gap (Δ)".padEnd(14) +
  "| Δ Imprv %".padEnd(14) +
  "| Rank-1 Acc".padEnd(14) +
  "| Pass +15%?"
);
console.log("-".repeat(120));

for (const c of candidates) {
  const posList: number[] = [];
  const negList: number[] = [];
  let rank1Count = 0;

  for (let i = 0; i < gallery.length; i++) {
    const q = gallery[i]!;
    const searchSpace = gallery.filter((b) => b !== q);

    let minSameDist = 0;
    const sameCeleb = searchSpace.filter((b) => b.id === q.id);
    if (sameCeleb.length > 0) {
      let minD = Infinity;
      for (const item of sameCeleb) {
        const d = c.fn(q.descriptor, item.descriptor);
        if (d < minD) minD = d;
      }
      minSameDist = minD;
    }

    let minDiffDist = Infinity;
    const diffCeleb = searchSpace.filter((b) => b.id !== q.id);
    for (const item of diffCeleb) {
      const d = c.fn(q.descriptor, item.descriptor);
      if (d < minDiffDist) minDiffDist = d;
    }

    let minOverall = Infinity;
    let topId = "";
    for (const item of searchSpace) {
      const d = c.fn(q.descriptor, item.descriptor);
      if (d < minOverall) {
        minOverall = d;
        topId = item.id;
      }
    }
    if (topId === q.id) rank1Count++;

    posList.push(minSameDist);
    negList.push(minDiffDist);
  }

  const dPos = mean(posList);
  const dNeg = mean(negList);
  const gap = dNeg - dPos;
  const imprvPct = ((gap - BASELINE_GAP) / BASELINE_GAP) * 100;
  const rank1Acc = (rank1Count / gallery.length) * 100;
  const pass = imprvPct >= 15.0;

  console.log(
    c.name.padEnd(28) +
    `| ${dPos.toFixed(6)}`.padEnd(20) +
    `| ${dNeg.toFixed(6)}`.padEnd(20) +
    `| ${gap.toFixed(6)}`.padEnd(14) +
    `| ${imprvPct >= 0 ? "+" : ""}${imprvPct.toFixed(2)}%`.padEnd(14) +
    `| ${rank1Acc.toFixed(2)}%`.padEnd(14) +
    `| ${pass ? "YES [✓]" : "NO [✗]"}`
  );
}

