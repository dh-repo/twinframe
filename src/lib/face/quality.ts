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
