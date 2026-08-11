export interface Point2D {
  x: number;
  y: number;
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Transforms a normalized point (percentages [0..100]) from image coordinate space
 * to HUD container percentage space [0..100] under CSS `object-cover object-center`.
 *
 * @param pt Normalized point in image space ({ x: %, y: % })
 * @param imgWidth Source image width in pixels
 * @param imgHeight Source image height in pixels
 * @param boxWidth HUD container width (defaults to 100 for percentage scale)
 * @param boxHeight HUD container height (defaults to 100 for percentage scale)
 * @returns Point transformed to container percentage space ({ x: %, y: % })
 */
export function transformNormalizedPointToHud(
  pt: Point2D,
  imgWidth: number,
  imgHeight: number,
  boxWidth: number = 100,
  boxHeight: number = 100
): Point2D {
  if (!imgWidth || !imgHeight || imgWidth <= 0 || imgHeight <= 0) {
    return { x: pt.x, y: pt.y };
  }

  const containerW = boxWidth > 0 ? boxWidth : 100;
  const containerH = boxHeight > 0 ? boxHeight : 100;

  const R_img = imgWidth / imgHeight;
  const R_box = containerW / containerH;

  const maxR = Math.max(R_img, R_box);
  const kx = maxR / R_box;
  const ky = maxR / R_img;

  return {
    x: 50 + (pt.x - 50) * kx,
    y: 50 + (pt.y - 50) * ky,
  };
}

/**
 * Transforms a normalized bounding box (percentages [0..100]) from image coordinate space
 * to HUD container percentage space [0..100] under CSS `object-cover object-center`.
 *
 * @param box Normalized box in image space ({ x: %, y: %, width: %, height: % })
 * @param imgWidth Source image width in pixels
 * @param imgHeight Source image height in pixels
 * @param boxWidth HUD container width (defaults to 100 for percentage scale)
 * @param boxHeight HUD container height (defaults to 100 for percentage scale)
 * @returns Bounding box transformed to container percentage space
 */
export function transformNormalizedBoxToHud(
  box: NormalizedBox,
  imgWidth: number,
  imgHeight: number,
  boxWidth: number = 100,
  boxHeight: number = 100
): NormalizedBox {
  if (!imgWidth || !imgHeight || imgWidth <= 0 || imgHeight <= 0) {
    return { ...box };
  }

  const containerW = boxWidth > 0 ? boxWidth : 100;
  const containerH = boxHeight > 0 ? boxHeight : 100;

  const R_img = imgWidth / imgHeight;
  const R_box = containerW / containerH;

  const maxR = Math.max(R_img, R_box);
  const kx = maxR / R_box;
  const ky = maxR / R_img;

  return {
    x: 50 + (box.x - 50) * kx,
    y: 50 + (box.y - 50) * ky,
    width: box.width * kx,
    height: box.height * ky,
  };
}
