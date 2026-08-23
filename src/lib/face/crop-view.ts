/**
 * Crop-review viewfinder math.
 *
 * Full-body / distant-face photos need more zoom and pan than a selfie.
 * Face-centric Approve still uses the detector box; this only keeps the
 * square preview centered on that face so the user sees the crop they send.
 */

export const CROP_ZOOM_MIN = 0.85;
export const CROP_ZOOM_MAX = 6;

/** Hint when the detector found a small face in a tall standing / full-body frame. */
export const STANDING_SHOT_HINT =
  "Standing photo — we zoomed in on your face. Drag if we framed the wrong person.";

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropPan {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Cover-fit scale so the image fills the square viewfinder at zoom=1. */
export function coverFitScale(
  imageW: number,
  imageH: number,
  containerSize: number,
): number {
  if (imageW <= 0 || imageH <= 0 || containerSize <= 0) return 1;
  return Math.max(containerSize / imageW, containerSize / imageH);
}

/**
 * Zoom so the selected face fills ~`fill` of the shorter image side,
 * capped so distant faces in full-body shots can still fill the square.
 */
export function zoomToFillFace(
  faceSidePx: number,
  imageW: number,
  imageH: number,
  fill = 0.45,
): number {
  const target = Math.min(imageW, imageH) * fill;
  return clamp(target / Math.max(faceSidePx, 1), 1, CROP_ZOOM_MAX);
}

/** Tall frame + small face: the swing / standing-civilian case. */
export function isStandingFullBodyShot(
  faceSidePx: number,
  imageW: number,
  imageH: number,
): boolean {
  if (imageW <= 0 || imageH <= 0 || faceSidePx <= 0) return false;
  const shortSide = Math.min(imageW, imageH);
  const tall = imageH / imageW >= 1.2;
  return tall && faceSidePx / shortSide < 0.22;
}

/** How far the user can drag before the image edge leaves the square. */
export function maxCropPan(
  imageW: number,
  imageH: number,
  zoom: number,
  containerSize: number,
): CropPan {
  const drawScale = coverFitScale(imageW, imageH, containerSize) * zoom;
  const drawW = imageW * drawScale;
  const drawH = imageH * drawScale;
  const slack = 24;
  return {
    x: Math.max(40, (drawW - containerSize) / 2 + slack),
    y: Math.max(40, (drawH - containerSize) / 2 + slack),
  };
}

/** Offset that puts `box` (pixel coords in the source image) on the square center. */
export function offsetToCenterBox(
  box: CropBox,
  imageW: number,
  imageH: number,
  zoom: number,
  containerSize: number,
): CropPan {
  const drawScale = coverFitScale(imageW, imageH, containerSize) * zoom;
  const faceCx = box.x + box.width / 2;
  const faceCy = box.y + box.height / 2;
  const max = maxCropPan(imageW, imageH, zoom, containerSize);
  return {
    x: clamp((imageW / 2 - faceCx) * drawScale, -max.x, max.x),
    y: clamp((imageH / 2 - faceCy) * drawScale, -max.y, max.y),
  };
}
