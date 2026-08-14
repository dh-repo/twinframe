/**
 * Twinframe — Requirement R4: Adaptive Illumination Normalization (CLAHE in CIE L*a*b* space)
 *
 * Implements real-time Contrast-Limited Adaptive Histogram Equalization (CLAHE) on the L* channel
 * in CIELAB space. Preserves chromaticity channels a* and b* completely untouched (Δa* = 0, Δb* = 0)
 * to maintain natural human skin tones without color casting or hue distortion.
 *
 * Performance SLA: < 5ms for 384x384 frames, < 1ms for 150x150 face crops.
 */

export interface ClaheOptions {
  /** Contrast clip limit factor (default: 2.5) */
  clipLimit?: number;
  /** Tile grid decomposition count per axis (default: 8 for 8x8 grid) */
  gridTiles?: number;
  /** Maximum dimension (width/height) for pre-downscaling optimization (default: 384) */
  maxClaheSide?: number;
  /** Whether to preserve chromaticity channels a* and b* without modification (default: true) */
  preserveSkinTones?: boolean;
}

// 1. Pre-computed 256-element sRGB -> Linear RGB lookup table
export const SRGB_TO_LINEAR_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255.0;
  SRGB_TO_LINEAR_LUT[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// 2. Pre-computed 4096-element Linear RGB -> sRGB lookup table for sub-millisecond conversion
export const LINEAR_TO_SRGB_LUT_SIZE = 4096;
export const LINEAR_TO_SRGB_LUT = new Uint8Array(LINEAR_TO_SRGB_LUT_SIZE + 1);
for (let i = 0; i <= LINEAR_TO_SRGB_LUT_SIZE; i++) {
  const v = i / LINEAR_TO_SRGB_LUT_SIZE;
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;
  LINEAR_TO_SRGB_LUT[i] = Math.min(255, Math.max(0, Math.round(s * 255.0)));
}

// 3. Pre-computed 4096-element Cube Root lookup table for sub-millisecond sRGB -> CIELAB
export const CBRT_LUT_SIZE = 4096;
export const CBRT_LUT = new Float32Array(CBRT_LUT_SIZE + 1);
const DELTA3 = 0.008856451679035631; // (6/29)^3
const M_COEFF = 7.787037037037037;   // 841/108
const C_COEFF = 0.13793103448275862; // 4/29

for (let i = 0; i <= CBRT_LUT_SIZE; i++) {
  const t = i / CBRT_LUT_SIZE;
  CBRT_LUT[i] = t > DELTA3 ? Math.cbrt(t) : M_COEFF * t + C_COEFF;
}

/**
 * Fast lookup for f(t) in CIELAB transformation.
 */
export function fastCbrt(t: number): number {
  if (t <= 0) return C_COEFF;
  if (t >= 1) return 1.0;
  return CBRT_LUT[(t * 4096 + 0.5) | 0]!;
}

/**
 * Fast conversion from Linear RGB [0.0, 1.0] to uint8 sRGB [0, 255] via 4096-entry LUT.
 */
export function fastLinearToSrgbByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  return LINEAR_TO_SRGB_LUT[(v * 4096 + 0.5) | 0]!;
}

// Pre-computed D65 illuminant matrices pre-scaled for maximum performance
const M_XX = 0.4124564 / 0.95047;
const M_XG = 0.3575761 / 0.95047;
const M_XB = 0.1804375 / 0.95047;

const M_YX = 0.2126729;
const M_YG = 0.7151522;
const M_YB = 0.0721750;

const M_ZX = 0.0193339 / 1.08883;
const M_ZG = 0.1191920 / 1.08883;
const M_ZB = 0.9503041 / 1.08883;

// Pre-scaled inverse matrices (4096x scaled) to eliminate per-pixel floating point multiplies
const M_RX_4096 = 3.2404542 * 0.95047 * 4096;
const M_RY_4096 = -1.5371385 * 1.00000 * 4096;
const M_RZ_4096 = -0.4985314 * 1.08883 * 4096;

const M_GX_4096 = -0.9692660 * 0.95047 * 4096;
const M_GY_4096 = 1.8760108 * 1.00000 * 4096;
const M_GZ_4096 = 0.0415560 * 1.08883 * 4096;

const M_BX_4096 = 0.0556434 * 0.95047 * 4096;
const M_BY_4096 = -0.2040259 * 1.00000 * 4096;
const M_BZ_4096 = 1.0572252 * 1.08883 * 4096;

/**
 * Converts sRGB color components (0..255) to CIELAB (L*: 0..100, a*: -128..127, b*: -128..127).
 * Uses D65 reference white (Xn=0.95047, Yn=1.00000, Zn=1.08883).
 */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rByte = Math.min(255, Math.max(0, Math.round(r)));
  const gByte = Math.min(255, Math.max(0, Math.round(g)));
  const bByte = Math.min(255, Math.max(0, Math.round(b)));

  const rLin = SRGB_TO_LINEAR_LUT[rByte]!;
  const gLin = SRGB_TO_LINEAR_LUT[gByte]!;
  const bLin = SRGB_TO_LINEAR_LUT[bByte]!;

  const x = M_XX * rLin + M_XG * gLin + M_XB * bLin;
  const y = M_YX * rLin + M_YG * gLin + M_YB * bLin;
  const z = M_ZX * rLin + M_ZG * gLin + M_ZB * bLin;

  const fx = fastCbrt(x);
  const fy = fastCbrt(y);
  const fz = fastCbrt(z);

  const l = 116.0 * fy - 16.0;
  const aVal = 500.0 * (fx - fy);
  const bVal = 200.0 * (fy - fz);

  return [l, aVal, bVal];
}

/**
 * Converts CIELAB color components (L*: 0..100, a*: -128..127, b*: -128..127) back to sRGB (0..255).
 * Clamps output RGB values strictly to valid range [0, 255].
 */
export function labToRgb(l: number, aVal: number, bVal: number): [number, number, number] {
  const fy = (l + 16.0) / 116.0;
  const fx = fy + aVal / 500.0;
  const fz = fy - bVal / 200.0;

  const delta = 0.20689655172413793; // 6/29

  const xr = fx > delta ? fx * fx * fx : (fx - C_COEFF) / M_COEFF;
  const yr = fy > delta ? fy * fy * fy : (fy - C_COEFF) / M_COEFF;
  const zr = fz > delta ? fz * fz * fz : (fz - C_COEFF) / M_COEFF;

  const rLinScaled = M_RX_4096 * xr + M_RY_4096 * yr + M_RZ_4096 * zr;
  const gLinScaled = M_GX_4096 * xr + M_GY_4096 * yr + M_GZ_4096 * zr;
  const bLinScaled = M_BX_4096 * xr + M_BY_4096 * yr + M_BZ_4096 * zr;

  const r = rLinScaled <= 0 ? 0 : (rLinScaled >= 4096 ? 255 : LINEAR_TO_SRGB_LUT[(rLinScaled + 0.5) | 0]!);
  const g = gLinScaled <= 0 ? 0 : (gLinScaled >= 4096 ? 255 : LINEAR_TO_SRGB_LUT[(gLinScaled + 0.5) | 0]!);
  const b = bLinScaled <= 0 ? 0 : (bLinScaled >= 4096 ? 255 : LINEAR_TO_SRGB_LUT[(bLinScaled + 0.5) | 0]!);

  return [r, g, b];
}

/**
 * Calculates CIE76 Color Difference ΔE_ab between two sRGB colors.
 */
export function calculateDeltaE(
  rgb1: [number, number, number],
  rgb2: [number, number, number],
): number {
  const [l1, a1, b1] = rgbToLab(rgb1[0], rgb1[1], rgb1[2]);
  const [l2, a2, b2] = rgbToLab(rgb2[0], rgb2[1], rgb2[2]);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// Module-level reusable scratch buffers to eliminate per-frame GC allocations
let scratchCapacity = 0;
let scratchBin: Uint8Array | null = null;
let scratchA: Float32Array | null = null;
let scratchB: Float32Array | null = null;
let scratchTx1: Int32Array | null = null;
let scratchTx2: Int32Array | null = null;
let scratchXLerp: Float32Array | null = null;
let scratchTxAssign: Int32Array | null = null;
let scratchTyAssign: Int32Array | null = null;

function getScratchBuffers(numPixels: number, width: number, height: number) {
  if (scratchCapacity < numPixels) {
    scratchCapacity = Math.max(numPixels, 384 * 384);
    scratchBin = new Uint8Array(scratchCapacity);
    scratchA = new Float32Array(scratchCapacity);
    scratchB = new Float32Array(scratchCapacity);
  }
  if (!scratchTx1 || scratchTx1.length < width) {
    const wCap = Math.max(width, 384);
    scratchTx1 = new Int32Array(wCap);
    scratchTx2 = new Int32Array(wCap);
    scratchXLerp = new Float32Array(wCap);
    scratchTxAssign = new Int32Array(wCap);
  }
  if (!scratchTyAssign || scratchTyAssign.length < height) {
    const hCap = Math.max(height, 384);
    scratchTyAssign = new Int32Array(hCap);
  }
  return {
    bin: scratchBin!,
    A: scratchA!,
    B: scratchB!,
    tx1: scratchTx1!,
    tx2: scratchTx2!,
    xLerp: scratchXLerp!,
    txAssign: scratchTxAssign!,
    tyAssign: scratchTyAssign!,
  };
}

/**
 * Core ImageData CLAHE in CIE L*a*b* space.
 * Equalizes ONLY the L* channel while preserving a* and b* chromaticity values completely untouched.
 */
export function applyClaheLabImageData(
  imgData: ImageData,
  options?: ClaheOptions,
): ImageData {
  const clipLimit = options?.clipLimit ?? 2.5;
  const gridTiles = options?.gridTiles ?? 8;

  const w = imgData.width;
  const h = imgData.height;
  const numPixels = w * h;
  if (numPixels === 0) return imgData;

  const data = imgData.data;
  const {
    bin: binBuf,
    A: aBuf,
    B: bBuf,
    tx1: tx1Arr,
    tx2: tx2Arr,
    xLerp: xLerpArr,
    txAssign,
    tyAssign,
  } = getScratchBuffers(numPixels, w, h);

  // 1. Convert pixels sRGB -> CIELAB (L* bin, a*, b*)
  for (let i = 0; i < numPixels; i++) {
    const p = i * 4;
    const rByte = data[p]!;
    const gByte = data[p + 1]!;
    const bByte = data[p + 2]!;

    const rLin = SRGB_TO_LINEAR_LUT[rByte]!;
    const gLin = SRGB_TO_LINEAR_LUT[gByte]!;
    const bLin = SRGB_TO_LINEAR_LUT[bByte]!;

    const x = M_XX * rLin + M_XG * gLin + M_XB * bLin;
    const y = M_YX * rLin + M_YG * gLin + M_YB * bLin;
    const z = M_ZX * rLin + M_ZG * gLin + M_ZB * bLin;

    const fx = fastCbrt(x);
    const fy = fastCbrt(y);
    const fz = fastCbrt(z);

    const binVal = (295.8 * fy - 40.3) | 0;
    binBuf[i] = binVal <= 0 ? 0 : (binVal >= 255 ? 255 : binVal);
    aBuf[i] = 500.0 * (fx - fy);
    bBuf[i] = 200.0 * (fy - fz);
  }

  // Precompute tile assignment per x and y coordinate for histogram accumulation
  for (let x = 0; x < w; x++) {
    txAssign[x] = Math.min(gridTiles - 1, Math.floor((x * gridTiles) / w));
  }
  for (let y = 0; y < h; y++) {
    tyAssign[y] = Math.min(gridTiles - 1, Math.floor((y * gridTiles) / h));
  }

  // 2. Continuous Grid CLAHE on L* channel
  const numTiles = gridTiles * gridTiles;
  const numBins = 256;
  const tileCDFs = new Float32Array(numTiles * numBins);
  const tileHists = new Int32Array(numTiles * numBins);
  const tileSizes = new Int32Array(numTiles);

  for (let y = 0; y < h; y++) {
    const ty = tyAssign[y]!;
    const tyGrid = ty * gridTiles;
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const tx = txAssign[x]!;
      const tileIdx = tyGrid + tx;
      tileSizes[tileIdx]++;
      const bin = binBuf[rowOffset + x]!;
      tileHists[tileIdx * numBins + bin]++;
    }
  }

  for (let tileIdx = 0; tileIdx < numTiles; tileIdx++) {
    const tileSize = tileSizes[tileIdx]!;
    if (tileSize === 0) continue;

    const offset = tileIdx * numBins;

    // Continuous clip limit threshold
    const clipThreshold = (clipLimit * tileSize) / numBins;
    let excess = 0;
    for (let i = 0; i < numBins; i++) {
      const hVal = tileHists[offset + i]!;
      if (hVal > clipThreshold) {
        excess += hVal - clipThreshold;
      }
    }

    const bonus = excess / numBins;
    const invTileSize = 255.0 / tileSize;

    // Compute tile CDF
    let cum = 0;
    for (let i = 0; i < numBins; i++) {
      const hVal = tileHists[offset + i]!;
      const count = hVal > clipThreshold ? clipThreshold + bonus : hVal + bonus;
      cum += count;
      tileCDFs[offset + i] = Math.min(255, cum * invTileSize);
    }
  }

  // Handle any empty tiles (tileSize === 0) by copying CDF from nearest non-empty tile
  for (let ty = 0; ty < gridTiles; ty++) {
    for (let tx = 0; tx < gridTiles; tx++) {
      const tileIdx = ty * gridTiles + tx;
      if (tileSizes[tileIdx] === 0) {
        let nearestIdx = -1;
        let minDst = Infinity;
        for (let nty = 0; nty < gridTiles; nty++) {
          for (let ntx = 0; ntx < gridTiles; ntx++) {
            const nIdx = nty * gridTiles + ntx;
            if (tileSizes[nIdx]! > 0) {
              const dst = (nty - ty) ** 2 + (ntx - tx) ** 2;
              if (dst < minDst) {
                minDst = dst;
                nearestIdx = nIdx;
              }
            }
          }
        }
        if (nearestIdx !== -1) {
          const srcOffset = nearestIdx * numBins;
          const dstOffset = tileIdx * numBins;
          tileCDFs.copyWithin(dstOffset, srcOffset, srcOffset + numBins);
        }
      }
    }
  }

  // Precompute X continuous interpolation bounds and weights
  for (let x = 0; x < w; x++) {
    const gx = ((x + 0.5) * gridTiles) / w - 0.5;
    const tx1 = Math.max(0, Math.min(gridTiles - 1, Math.floor(gx)));
    const tx2 = Math.min(gridTiles - 1, tx1 + 1);
    tx1Arr[x] = tx1;
    tx2Arr[x] = tx2;
    xLerpArr[x] = tx1 === tx2 ? 0 : Math.max(0, Math.min(1, gx - tx1));
  }

  // 3. Bilinear tile interpolation and CIELAB -> sRGB reconstruction
  const delta = 0.20689655172413793;

  for (let y = 0; y < h; y++) {
    const gy = ((y + 0.5) * gridTiles) / h - 0.5;
    const ty1 = Math.max(0, Math.min(gridTiles - 1, Math.floor(gy)));
    const ty2 = Math.min(gridTiles - 1, ty1 + 1);
    const yLerp = ty1 === ty2 ? 0 : Math.max(0, Math.min(1, gy - ty1));
    const ty1Grid = ty1 * gridTiles;
    const ty2Grid = ty2 * gridTiles;

    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const tx1 = tx1Arr[x]!;
      const tx2 = tx2Arr[x]!;
      const xLerp = xLerpArr[x]!;

      const idx = rowOffset + x;
      const origBin = binBuf[idx]!;

      const offTL = (ty1Grid + tx1) * 256 + origBin;
      const offTR = (ty1Grid + tx2) * 256 + origBin;
      const offBL = (ty2Grid + tx1) * 256 + origBin;
      const offBR = (ty2Grid + tx2) * 256 + origBin;

      const cdfTL = tileCDFs[offTL]!;
      const cdfTR = tileCDFs[offTR]!;
      const cdfBL = tileCDFs[offBL]!;
      const cdfBR = tileCDFs[offBR]!;

      const top = cdfTL + (cdfTR - cdfTL) * xLerp;
      const bottom = cdfBL + (cdfBR - cdfBL) * xLerp;
      const newLBin = top + (bottom - top) * yLerp;

      // Equalized fy coordinate
      const fy = newLBin * 0.0033806626 + 0.13793103;

      // Chromaticity channels a* and b* remain 100% untouched
      const aVal = aBuf[idx]!;
      const bVal = bBuf[idx]!;

      const fx = fy + aVal / 500.0;
      const fz = fy - bVal / 200.0;

      const xr = fx > delta ? fx * fx * fx : (fx - C_COEFF) / M_COEFF;
      const yr = fy > delta ? fy * fy * fy : (fy - C_COEFF) / M_COEFF;
      const zr = fz > delta ? fz * fz * fz : (fz - C_COEFF) / M_COEFF;

      const rLinScaled = M_RX_4096 * xr + M_RY_4096 * yr + M_RZ_4096 * zr;
      const gLinScaled = M_GX_4096 * xr + M_GY_4096 * yr + M_GZ_4096 * zr;
      const bLinScaled = M_BX_4096 * xr + M_BY_4096 * yr + M_BZ_4096 * zr;

      const pxIdx = idx * 4;
      data[pxIdx] = rLinScaled <= 0 ? 0 : (rLinScaled >= 4096 ? 255 : LINEAR_TO_SRGB_LUT[(rLinScaled + 0.5) | 0]!);
      data[pxIdx + 1] = gLinScaled <= 0 ? 0 : (gLinScaled >= 4096 ? 255 : LINEAR_TO_SRGB_LUT[(gLinScaled + 0.5) | 0]!);
      data[pxIdx + 2] = bLinScaled <= 0 ? 0 : (bLinScaled >= 4096 ? 255 : LINEAR_TO_SRGB_LUT[(bLinScaled + 0.5) | 0]!);
    }
  }

  return imgData;
}

/**
 * Applies CLAHE in L*a*b* space to an HTMLCanvasElement source frame.
 * Supports pre-downscaling optimization to maxClaheSide (default: 384px).
 */
export function applyClaheCanvas(
  sourceCanvas: HTMLCanvasElement,
  options?: ClaheOptions | number,
  gridTilesArg?: number,
  maxClaheSideArg?: number,
): HTMLCanvasElement {
  const origW = sourceCanvas.width;
  const origH = sourceCanvas.height;
  if (!origW || !origH) return sourceCanvas;

  // Resolve positional or options arguments
  let clipLimit = 2.5;
  let gridTiles = 8;
  let maxClaheSide = 384;

  if (typeof options === "number") {
    clipLimit = options;
    if (gridTilesArg !== undefined) gridTiles = gridTilesArg;
    if (maxClaheSideArg !== undefined) maxClaheSide = maxClaheSideArg;
  } else if (options && typeof options === "object") {
    if (options.clipLimit !== undefined) clipLimit = options.clipLimit;
    if (options.gridTiles !== undefined) gridTiles = options.gridTiles;
    if (options.maxClaheSide !== undefined) maxClaheSide = options.maxClaheSide;
  }

  // Pre-downscale to maxClaheSide if needed
  let workingCanvas: HTMLCanvasElement = sourceCanvas;
  if (Math.max(origW, origH) > maxClaheSide && typeof document !== "undefined") {
    const scale = maxClaheSide / Math.max(origW, origH);
    const sw = Math.max(1, Math.round(origW * scale));
    const sh = Math.max(1, Math.round(origH * scale));
    const downCanvas = document.createElement("canvas");
    downCanvas.width = sw;
    downCanvas.height = sh;
    const dctx = downCanvas.getContext("2d", { willReadFrequently: true });
    if (dctx) {
      dctx.imageSmoothingEnabled = false;
      (dctx as unknown as { imageSmoothingQuality?: string }).imageSmoothingQuality = "low";
      dctx.drawImage(sourceCanvas, 0, 0, sw, sh);
      workingCanvas = downCanvas;
    }
  }

  const w = workingCanvas.width;
  const h = workingCanvas.height;

  // Create clean outCanvas matching workingCanvas dimensions (w x h)
  const outCanvas = typeof document !== "undefined"
    ? document.createElement("canvas")
    : workingCanvas;

  if (typeof document !== "undefined") {
    outCanvas.width = w;
    outCanvas.height = h;
  }

  const outCtx = outCanvas.getContext ? outCanvas.getContext("2d", { willReadFrequently: true }) : null;
  if (!outCtx) return sourceCanvas;

  outCtx.drawImage(workingCanvas, 0, 0);
  const imgData = outCtx.getImageData(0, 0, w, h);

  applyClaheLabImageData(imgData, { clipLimit, gridTiles });

  outCtx.putImageData(imgData, 0, 0);
  return outCanvas;
}

/**
 * Backward-compatible wrapper delegating local contrast boost to LAB space CLAHE.
 */
export function applyLocalContrastBoost(
  sourceCanvas: HTMLCanvasElement,
  clipLimit = 2.5,
  gridTiles = 8,
  maxClaheSide = 384,
): HTMLCanvasElement {
  return applyClaheCanvas(sourceCanvas, { clipLimit, gridTiles, maxClaheSide });
}
