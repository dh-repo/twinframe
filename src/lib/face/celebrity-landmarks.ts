import { loadFaceApi } from "./faceapi-engine";
import { isValidHumanFaceLandmarks68 } from "./geometry";

export interface CelebrityCropData {
  cropUrl: string;
  landmarks: Array<{ x: number; y: number }>;
}

const cropCache = new Map<string, Promise<CelebrityCropData | null>>();

/**
 * Extracts a centered face crop and 68-point normalized facial landmarks
 * for a celebrity reference photo in the browser.
 * Results are memoized in memory for instantaneous subsequent tab switches.
 */
export function getCelebrityFaceCropAndLandmarks(
  imageUrl?: string | null,
): Promise<CelebrityCropData | null> {
  if (!imageUrl || typeof window === "undefined") return Promise.resolve(null);
  
  const cached = cropCache.get(imageUrl);
  if (cached) return cached;

  const promise = (async () => {
    try {
      const api = (await loadFaceApi()) as any;
      if (!api || !api.detectSingleFace) return null;

      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load ${imageUrl}`));
        img.src = imageUrl;
      });

      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      if (!nw || !nh) return null;

      // Rasterize to canvas for SSD detector
      const c = document.createElement("canvas");
      c.width = nw;
      c.height = nh;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);

      // Detect face with landmarks
      const opts = new api.SsdMobilenetv1Options({ minConfidence: 0.15 });
      const det = await api.detectSingleFace(c, opts).withFaceLandmarks();

      if (!det || !det.landmarks) {
        return null;
      }

      const rawPts = det.landmarks.positions;
      if (!rawPts || rawPts.length < 68 || !isValidHumanFaceLandmarks68(rawPts, nw, nh)) {
        return null;
      }

      const box = det.detection.box;
      const padPct = 0.20;
      const cropSide = Math.max(box.width, box.height) * (1 + padPct * 2);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const cropX = Math.max(0, Math.min(nw - cropSide, cx - cropSide / 2));
      const cropY = Math.max(0, Math.min(nh - cropSide, cy - cropSide / 2));
      const actualSide = Math.min(cropSide, nw - cropX, nh - cropY);

      // Create cropped face canvas
      const outSize = 320;
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = outSize;
      cropCanvas.height = outSize;
      const cropCtx = cropCanvas.getContext("2d");
      if (!cropCtx) return null;
      (cropCtx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
      cropCtx.drawImage(c, cropX, cropY, actualSide, actualSide, 0, 0, outSize, outSize);

      const cropUrl = cropCanvas.toDataURL("image/jpeg", 0.90);
      const croppedLandmarks = rawPts.map((pt: { x: number; y: number }) => ({
        x: Math.min(100, Math.max(0, ((pt.x - cropX) / actualSide) * 100)),
        y: Math.min(100, Math.max(0, ((pt.y - cropY) / actualSide) * 100)),
      }));

      return {
        cropUrl,
        landmarks: croppedLandmarks,
      };
    } catch {
      return null;
    }
  })();

  cropCache.set(imageUrl, promise);
  return promise;
}
