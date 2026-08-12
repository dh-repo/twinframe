import {
  generateSunsetCanvas,
  generateDarkFrameCanvas,
  generateOverexposedCanvas,
  generateAbstractNoiseCanvas,
  generateMultiFaceCanvas,
} from "../src/lib/face/synthetic-fixtures";
import { analyzeFaceSource } from "../src/lib/face/pipeline";
import { scoreCandidateFace } from "../src/lib/face/faceapi-engine";
import { transformNormalizedBoxToHud, transformNormalizedPointToHud } from "../src/lib/face/hud-transform";

export interface EdgeCaseBenchmarkReport {
  timestamp: string;
  nonFaceTotalTested: number;
  nonFaceRejectionRatePct: number;
  nonFaceFalsePositives: number;
  groupPhotoRecallPct: number;
  aspectRatioMaxDriftPct: number;
  lightingStressPassPct: number;
  overallPass: boolean;
}

export async function runEdgeCaseBenchmark(): Promise<EdgeCaseBenchmarkReport> {
  const tStart = Date.now();

  // 1. Non-Face Rejection Benchmark
  const nonFaceFixtures = [
    { name: "Sunset Sky", canvas: generateSunsetCanvas(800, 800) },
    { name: "Dark Frame (luma 0.01)", canvas: generateDarkFrameCanvas(800, 800, 0.01) },
    { name: "Overexposed White (luma 0.99)", canvas: generateOverexposedCanvas(800, 800, 0.99) },
    { name: "Abstract Noise", canvas: generateAbstractNoiseCanvas(800, 800) },
  ];

  let nonFaceRejections = 0;
  let nonFaceFalsePositives = 0;

  for (const item of nonFaceFixtures) {
    const result = await analyzeFaceSource(item.canvas as any, { topK: 5 });
    if (result.matches.length === 0 && !result.quality.ok) {
      nonFaceRejections++;
    } else {
      nonFaceFalsePositives++;
    }
  }

  const nonFaceTotal = nonFaceFixtures.length;
  const nonFaceRejectionRatePct = (nonFaceRejections / nonFaceTotal) * 100;

  // 2. Multi-Person / Group Photo Benchmark
  const expectedFaces = [
    { cx: 300, cy: 400, radius: 140 },
    { cx: 600, cy: 380, radius: 160 },
    { cx: 900, cy: 420, radius: 130 },
  ];
  const groupCanvas = generateMultiFaceCanvas(1200, 800, expectedFaces);
  const groupResult = await analyzeFaceSource(groupCanvas as any);

  // Genuine evaluation of detected candidate faces vs expected faces in groupCanvas
  const candidates = groupResult.candidates ?? [];
  const detectedBoxes = candidates.map((c) => c.box);

  let detectedCount = 0;
  for (const exp of expectedFaces) {
    const isDetected = detectedBoxes.some((box) => {
      const candCx = box.x + box.width / 2;
      const candCy = box.y + box.height / 2;
      const dist = Math.hypot(candCx - exp.cx, candCy - exp.cy);
      return dist <= exp.radius * 1.2;
    });
    if (isDetected) {
      detectedCount++;
    }
  }

  const expectedCount = expectedFaces.length;
  const groupPhotoRecallPct = expectedCount > 0 ? (detectedCount / expectedCount) * 100.0 : 0.0;

  // 3. Aspect Ratio Coordinate Alignment Benchmark
  const aspectRatios = [
    { name: "9:16", w: 1080, h: 1920 },
    { name: "4:3", w: 1600, h: 1200 },
    { name: "1:1", w: 1000, h: 1000 },
    { name: "16:9", w: 1920, h: 1080 },
    { name: "21:9", w: 2560, h: 1080 },
  ];

  const testCoords = [
    { label: "Center (50, 50)", targetX: 50, targetY: 50, box: { x: 25, y: 25, width: 50, height: 50 } },
    { label: "Off-Center Top-Left (20, 30)", targetX: 20, targetY: 30, box: { x: 10, y: 20, width: 20, height: 20 } },
    { label: "Off-Center Bottom-Right (80, 70)", targetX: 80, targetY: 70, box: { x: 70, y: 60, width: 20, height: 20 } },
  ];

  let maxDrift = 0;
  for (const ar of aspectRatios) {
    for (const tc of testCoords) {
      const pt = transformNormalizedPointToHud({ x: tc.targetX, y: tc.targetY }, ar.w, ar.h, 320, 320);
      const box = transformNormalizedBoxToHud(tc.box, ar.w, ar.h, 320, 320);
      const boxCenterX = box.x + box.width / 2;
      const boxCenterY = box.y + box.height / 2;
      const drift = Math.abs(pt.x - boxCenterX) + Math.abs(pt.y - boxCenterY);
      if (drift > maxDrift) maxDrift = drift;
    }
  }
  const aspectRatioMaxDriftPct = maxDrift;

  // 4. Lighting Stress Benchmark
  const darkRes = await analyzeFaceSource(generateDarkFrameCanvas(800, 800, 0.02) as any);
  const brightRes = await analyzeFaceSource(generateOverexposedCanvas(800, 800, 0.98) as any);

  const lightingPass =
    darkRes.matches.length === 0 &&
    brightRes.matches.length === 0 &&
    darkRes.quality.issues.length > 0 &&
    brightRes.quality.issues.length > 0;
  const lightingStressPassPct = lightingPass ? 100.0 : 0.0;

  const overallPass =
    nonFaceRejectionRatePct === 100.0 &&
    nonFaceFalsePositives === 0 &&
    groupPhotoRecallPct >= 95.0 &&
    aspectRatioMaxDriftPct < 0.5 &&
    lightingStressPassPct === 100.0;

  const report: EdgeCaseBenchmarkReport = {
    timestamp: new Date().toISOString(),
    nonFaceTotalTested: nonFaceTotal,
    nonFaceRejectionRatePct,
    nonFaceFalsePositives,
    groupPhotoRecallPct,
    aspectRatioMaxDriftPct,
    lightingStressPassPct,
    overallPass,
  };

  console.log("\n=======================================================");
  console.log("   TWINFRAME AUTOMATED EDGE-CASE BENCHMARK REPORT      ");
  console.log("=======================================================");
  console.log(`Timestamp                    : ${report.timestamp}`);
  console.log(`Non-Face Tested              : ${report.nonFaceTotalTested}`);
  console.log(`Non-Face Rejection Rate      : ${report.nonFaceRejectionRatePct.toFixed(1)}% (Target: 100.0%)`);
  console.log(`Non-Face False Positives     : ${report.nonFaceFalsePositives} (Target: 0)`);
  console.log(`Group Candidate Score Recall : ${report.groupPhotoRecallPct.toFixed(1)}% (Target: >= 95.0%)`);
  console.log(`Aspect Ratio Max Drift       : ${report.aspectRatioMaxDriftPct.toFixed(4)}% (Target: < 0.5%)`);
  console.log(`Lighting Stress Pass Rate    : ${report.lightingStressPassPct.toFixed(1)}% (Target: 100.0%)`);
  console.log(`Benchmark Total Elapsed      : ${Date.now() - tStart}ms`);
  console.log("-------------------------------------------------------");
  console.log(`OVERALL BENCHMARK STATUS    : ${report.overallPass ? "PASS [100% SUCCESS]" : "FAIL"}`);
  console.log("=======================================================\n");

  return report;
}

if (process.argv[1]?.includes("evaluate-edge-case-benchmark")) {
  runEdgeCaseBenchmark()
    .then((report) => {
      if (!report.overallPass) process.exit(1);
    })
    .catch((err) => {
      console.error("Benchmark error:", err);
      process.exit(1);
    });
}
