export const REFERENCE_LANDMARKS_112: readonly [number, number][] = [
  [38.2946, 51.6963], // Left Eye
  [73.5318, 51.5014], // Right Eye
  [56.0252, 71.7366], // Nose Tip
  [41.5493, 92.3655], // Left Mouth Corner
  [70.7299, 92.2041], // Right Mouth Corner
];

export const REFERENCE_LANDMARKS_160: readonly [number, number][] = [
  [54.7066, 73.8519],
  [105.0454, 73.5734],
  [80.0360, 102.4809],
  [59.3561, 131.9507],
  [101.0427, 131.7201],
];

export interface TransformResult {
  /** 2x3 affine matrix [a, -b, tx; b, a, ty] */
  M: number[][];
  /** 2x3 inverse affine matrix for mapping target (u,v) back to source (x,y) */
  invM: number[][];
  /** Scale factor */
  scale: number;
  /** Rotation angle in radians */
  rotationRad: number;
}

/**
 * Computes closed-form 2D Umeyama similarity transformation matrix (scale, rotation, translation)
 * mapping detected 5-point facial landmarks to canonical InsightFace reference landmarks.
 */
export function compute5PointSimilarityMatrix(
  landmarks: Float32Array | number[][],
  targetSize: 112 | 160 = 112
): TransformResult {
  const ref = targetSize === 160 ? REFERENCE_LANDMARKS_160 : REFERENCE_LANDMARKS_112;

  // Extract source points (x_i, y_i)
  const srcPts: Array<[number, number]> = [];
  if (Array.isArray(landmarks)) {
    for (let i = 0; i < 5; i++) {
      srcPts.push([landmarks[i][0], landmarks[i][1]]);
    }
  } else {
    for (let i = 0; i < 5; i++) {
      srcPts.push([landmarks[i * 2], landmarks[i * 2 + 1]]);
    }
  }

  // Construct normal equations (A^T A) X = A^T B for X = [a, b, tx, ty]^T
  // Row 2i:   x_i * a - y_i * b + tx = u_i
  // Row 2i+1: y_i * a + x_i * b + ty = v_i
  let sumSq = 0;
  let sumX = 0;
  let sumY = 0;

  let rhs0 = 0; // sum(x*u + y*v)
  let rhs1 = 0; // sum(-y*u + x*v)
  let rhs2 = 0; // sum(u)
  let rhs3 = 0; // sum(v)

  for (let i = 0; i < 5; i++) {
    const x = srcPts[i][0];
    const y = srcPts[i][1];
    const u = ref[i][0];
    const v = ref[i][1];

    sumSq += x * x + y * y;
    sumX += x;
    sumY += y;

    rhs0 += x * u + y * v;
    rhs1 += -y * u + x * v;
    rhs2 += u;
    rhs3 += v;
  }

  // Solve symmetric 4x4 linear system via Gaussian elimination
  const ATA = [
    [sumSq, 0, sumX, sumY, rhs0],
    [0, sumSq, -sumY, sumX, rhs1],
    [sumX, -sumY, 5, 0, rhs2],
    [sumY, sumX, 0, 5, rhs3],
  ];

  // Perform row operations to reduce to upper triangular form
  for (let i = 0; i < 4; i++) {
    let maxRow = i;
    for (let k = i + 1; k < 4; k++) {
      if (Math.abs(ATA[k][i]) > Math.abs(ATA[maxRow][i])) {
        maxRow = k;
      }
    }
    const temp = ATA[i];
    ATA[i] = ATA[maxRow];
    ATA[maxRow] = temp;

    const pivot = ATA[i][i];
    if (Math.abs(pivot) < 1e-10) {
      // Identity fallback if degenerate
      return {
        M: [[1, 0, 0], [0, 1, 0]],
        invM: [[1, 0, 0], [0, 1, 0]],
        scale: 1,
        rotationRad: 0,
      };
    }

    for (let j = i; j <= 4; j++) {
      ATA[i][j] /= pivot;
    }

    for (let k = 0; k < 4; k++) {
      if (k !== i) {
        const factor = ATA[k][i];
        for (let j = i; j <= 4; j++) {
          ATA[k][j] -= factor * ATA[i][j];
        }
      }
    }
  }

  const a = ATA[0][4];
  const b = ATA[1][4];
  const tx = ATA[2][4];
  const ty = ATA[3][4];

  const scaleSq = a * a + b * b;
  const scale = Math.sqrt(scaleSq);
  const rotationRad = Math.atan2(b, a);

  const M = [
    [a, -b, tx],
    [b, a, ty],
  ];

  // Compute inverse 2x3 matrix invM
  const invScaleSq = scaleSq > 1e-10 ? 1 / scaleSq : 1;
  const aInv = a * invScaleSq;
  const bInv = b * invScaleSq;

  const txInv = (-a * tx - b * ty) * invScaleSq;
  const tyInv = (b * tx - a * ty) * invScaleSq;

  const invM = [
    [aInv, bInv, txInv],
    [-bInv, aInv, tyInv],
  ];

  return { M, invM, scale, rotationRad };
}

export function createSafeCanvas(w: number, h: number): any {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  const mockCtx = {
    fillStyle: "",
    fillRect: () => {},
    drawImage: () => {},
    getImageData: (x: number, y: number, sw: number, sh: number) => ({
      data: new Uint8ClampedArray(sw * sh * 4),
      width: sw,
      height: sh,
    }),
    setTransform: () => {},
  };
  return {
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h)),
    getContext: (type: string) => (type === "2d" ? mockCtx : null),
  };
}

/**
 * Renders aligned 5-point face crop onto a target HTMLCanvasElement or OffscreenCanvas.
 */
export function align5PointSimilarityCanvas(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas,
  landmarks: Float32Array | number[][],
  targetSize: 112 | 160 = 112
): HTMLCanvasElement | OffscreenCanvas {
  const { M } = compute5PointSimilarityMatrix(landmarks, targetSize);

  const canvas = createSafeCanvas(targetSize, targetSize);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("[SimilarityTransform] Context 2d acquisition failed");
  }

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, targetSize, targetSize);

  // Apply 2x3 affine matrix transformation
  ctx.setTransform(M[0][0], M[1][0], M[0][1], M[1][1], M[0][2], M[1][2]);
  ctx.drawImage(source as any, 0, 0);

  return canvas;
}


/**
 * Extracts aligned 5-point face crop as Planar NCHW Float32Array tensor [1, 3, H, W] normalized to [-1.0, 1.0].
 */
export function align5PointSimilarityTensor(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | OffscreenCanvas,
  landmarks: Float32Array | number[][],
  targetSize: 112 | 160 = 112
): Float32Array {
  const canvas = align5PointSimilarityCanvas(source, landmarks, targetSize);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
  const rgba = imgData.data;

  const tensor = new Float32Array(1 * 3 * targetSize * targetSize);
  const planeSize = targetSize * targetSize;

  for (let i = 0; i < planeSize; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];

    tensor[i] = (r - 127.5) / 128.0;
    tensor[planeSize + i] = (g - 127.5) / 128.0;
    tensor[2 * planeSize + i] = (b - 127.5) / 128.0;
  }

  return tensor;
}
