/** Detect iPhone HEIC/HEIF so we can decode (or fail clearly) before crop review. */
export function isHeicFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return (
    type.includes("heic") ||
    type.includes("heif") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

/**
 * iOS Photos often hands over HEIC with an empty MIME type, and some Android
 * WebViews omit type entirely. Do not require `image/*`.
 */
export function isLikelyPhotoFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (isHeicFile(file)) return true;
  return /\.(jpe?g|png|webp|gif|avif|bmp|heic|heif)$/i.test(file.name || "");
}

export const HEIC_UNSUPPORTED_MESSAGE =
  "This iPhone format isn't supported here — in Photos, tap Share → Save as JPEG, then upload that file.";

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(HEIC_UNSUPPORTED_MESSAGE));
      },
      "image/jpeg",
      0.92,
    );
  });
}

function jpegFileFromBlob(blob: Blob, originalName: string): File {
  const base = originalName.replace(/\.(heic|heif)$/i, "") || "photo";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

const MAX_EDGE = 2048;
const MIN_BYTES = 32;
const MAX_BYTES = 25 * 1024 * 1024;

async function canvasFromSize(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  srcW: number,
  srcH: number,
  name: string,
): Promise<File> {
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare that photo.");
  ctx.imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality =
    "high";
  draw(ctx, w, h);
  const blob = await canvasToJpegBlob(canvas);
  return jpegFileFromBlob(blob, name);
}

/** Decode, honor EXIF orientation, and cap long edge so phones do not OOM. */
async function rasterizeToJpeg(file: File): Promise<File | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      const out = await canvasFromSize(
        (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        bitmap.width,
        bitmap.height,
        file.name,
      );
      bitmap.close();
      return out;
    } catch {
      /* fall through */
    }
  }

  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("img decode failed"));
      el.src = url;
    });
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (srcW < 2 || srcH < 2) {
      URL.revokeObjectURL(url);
      return null;
    }
    const out = await canvasFromSize(
      (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      srcW,
      srcH,
      file.name,
    );
    URL.revokeObjectURL(url);
    return out;
  } catch {
    return null;
  }
}

/**
 * Return a crop-review-safe JPEG: oriented, HEIC decoded when possible,
 * and downscaled so 12–48MP camera-roll photos do not crash Safari.
 */
export async function normalizeImageFile(file: File): Promise<File> {
  if (file.size < MIN_BYTES) {
    throw new Error("That file is empty. Choose a photo.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("That photo is too large. Try a smaller one or take a new selfie.");
  }
  if (!isLikelyPhotoFile(file)) {
    throw new Error("Please choose a photo (JPG, PNG, or HEIC).");
  }
  const decoded = await rasterizeToJpeg(file);
  if (decoded) return decoded;
  if (isHeicFile(file)) throw new Error(HEIC_UNSUPPORTED_MESSAGE);
  throw new Error("Could not read that photo. Try JPG or PNG.");
}
