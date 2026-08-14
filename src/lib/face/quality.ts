/**
 * Advanced Face Quality & Illumination Analysis
 * Measures Laplacian variance sharpness, contrast uniformity, and exposure balance.
 */

export interface ImageQualityMetrics {
  sharpnessScore: number;     // Normalized Laplacian variance [0, 1]
  illuminationBalance: number; // Contrast & exposure balance [0, 1]
  overallQuality: number;      // Composite quality score [0, 1]
  issues: string[];
}

/**
 * Assess image quality from an ImageData slice of a face crop.
 */
export function analyzeImageQuality(imageData: ImageData): ImageQualityMetrics {
  const { width, height, data } = imageData;
  const issues: string[] = [];

  if (width < 32 || height < 32) {
    return {
      sharpnessScore: 0.1,
      illuminationBalance: 0.1,
      overallQuality: 0.1,
      issues: ["Resolution too low for high-precision face recognition."],
    };
  }

  // 1. Convert to grayscale & compute Laplacian variance (sharpness)
  const gray = new Float32Array(width * height);
  let totalLum = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = lum;
    totalLum += lum;
  }
  const meanLum = totalLum / (width * height);

  // Discrete 3x3 Laplacian kernel: [[0, 1, 0], [1, -4, 1], [0, 1, 0]]
  let lapSum = 0;
  let lapSqSum = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = gray[idx]!;
      const up = gray[idx - width]!;
      const down = gray[idx + width]!;
      const left = gray[idx - 1]!;
      const right = gray[idx + 1]!;

      const lap = up + down + left + right - 4 * center;
      lapSum += lap;
      lapSqSum += lap * lap;
      count++;
    }
  }

  const lapMean = lapSum / Math.max(1, count);
  const lapVar = Math.max(0, lapSqSum / Math.max(1, count) - lapMean * lapMean);

  // Empirical Laplacian variance threshold: < 80 is blurry, > 500 is sharp
  const sharpnessScore = Math.min(1.0, Math.max(0.05, Math.log(1 + lapVar / 100) / Math.log(1 + 5)));

  if (sharpnessScore < 0.3) {
    issues.push("Image appears blurry — hold camera steady.");
  }

  // 2. Exposure balance (overexposure / underexposure ratio)
  let darkPixels = 0;
  let brightPixels = 0;
  let lumVarSum = 0;

  for (let i = 0; i < width * height; i++) {
    const l = gray[i]!;
    if (l < 25) darkPixels++;
    if (l > 235) brightPixels++;
    const d = l - meanLum;
    lumVarSum += d * d;
  }

  const darkRatio = darkPixels / (width * height);
  const brightRatio = brightPixels / (width * height);
  const stdLum = Math.sqrt(lumVarSum / (width * height));

  const illuminationBalance = Math.min(
    1.0,
    Math.max(0.1, (1 - darkRatio * 1.5 - brightRatio * 1.5) * Math.min(1, stdLum / 40))
  );

  if (darkRatio > 0.3) issues.push("Lighting is too dark.");
  if (brightRatio > 0.3) issues.push("Lighting is overexposed or washed out.");

  const overallQuality = Math.min(1.0, Math.max(0.1, 0.6 * sharpnessScore + 0.4 * illuminationBalance));

  return {
    sharpnessScore: Math.round(sharpnessScore * 100) / 100,
    illuminationBalance: Math.round(illuminationBalance * 100) / 100,
    overallQuality: Math.round(overallQuality * 100) / 100,
    issues,
  };
}

/**
 * Decide whether a FaceNet embed crop should get LAB CLAHE before inference.
 *
 * Uses the inner face box (skips hair/corners) so well-lit deep skin and
 * ordinary dark hair do not trigger. Gallery vectors were enrolled without
 * embed CLAHE — a false positive domain-shifts those queries.
 *
 * Triggers on directional split, backlight, crushed inner face, or blown inner face.
 */
export function cropNeedsIlluminationNorm(
  canvas: { width: number; height: number; getContext: (id: "2d", attrs?: { willReadFrequently?: boolean }) => CanvasRenderingContext2D | null },
): boolean {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 4 || h < 4) return false;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;

  const { data } = ctx.getImageData(0, 0, w, h);
  const n = w * h;
  const lums = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    lums[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const x0 = Math.floor(w * 0.15);
  const x1 = Math.max(x0 + 1, Math.ceil(w * 0.85));
  const y0 = Math.floor(h * 0.18);
  const y1 = Math.max(y0 + 1, Math.ceil(h * 0.88));
  const midX = (x0 + x1) >> 1;
  const midY = (y0 + y1) >> 1;

  let innerN = 0;
  let innerSum = 0;
  let innerDark = 0;
  let innerBright = 0;
  let leftN = 0;
  let leftSum = 0;
  let rightN = 0;
  let rightSum = 0;
  let outerN = 0;
  let outerSum = 0;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const lum = lums[row + x]!;
      const inner = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (!inner) {
        outerN++;
        outerSum += lum;
        continue;
      }
      innerN++;
      innerSum += lum;
      if (lum < 25) innerDark++;
      if (lum > 235) innerBright++;
      if (x < midX) {
        leftN++;
        leftSum += lum;
      } else {
        rightN++;
        rightSum += lum;
      }
    }
  }

  if (innerN === 0) return false;
  const innerMean = innerSum / innerN;
  const leftMean = leftN > 0 ? leftSum / leftN : innerMean;
  const rightMean = rightN > 0 ? rightSum / rightN : innerMean;
  const outerMean = outerN > 0 ? outerSum / outerN : innerMean;
  const innerDarkRatio = innerDark / innerN;
  const innerBrightRatio = innerBright / innerN;

  let topSum = 0;
  let topN = 0;
  let botSum = 0;
  let botN = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) {
      const lum = lums[row + x]!;
      if (y < midY) {
        topN++;
        topSum += lum;
      } else {
        botN++;
        botSum += lum;
      }
    }
  }
  const topMean = topN > 0 ? topSum / topN : innerMean;
  const botMean = botN > 0 ? botSum / botN : innerMean;

  if (Math.abs(leftMean - rightMean) > 40) return true;
  if (Math.abs(topMean - botMean) > 50) return true;
  if (outerMean - innerMean > 50) return true;
  if (innerDarkRatio > 0.28) return true;
  if (innerBrightRatio > 0.18) return true;
  if (innerMean < 22) return true;
  return false;
}
