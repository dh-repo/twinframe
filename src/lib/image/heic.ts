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

/** Try native decode (Safari can often read HEIC). Returns null if it cannot. */
async function nativeDecodeToJpeg(file: File): Promise<File | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await canvasToJpegBlob(canvas);
      return jpegFileFromBlob(blob, file.name);
    } catch {
      /* fall through */
    }
  }

  // Last native try: <img> + object URL (Safari HEIC)
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("img decode failed"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    if (canvas.width < 2 || canvas.height < 2) {
      URL.revokeObjectURL(url);
      return null;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return null;
    }
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const blob = await canvasToJpegBlob(canvas);
    return jpegFileFromBlob(blob, file.name);
  } catch {
    return null;
  }
}

/**
 * Return a crop-review-safe image file. JPEG/PNG/WebP pass through.
 * HEIC is re-encoded to JPEG when the browser can decode it.
 */
export async function normalizeImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") && !isHeicFile(file)) {
    throw new Error("Please choose a photo (JPG, PNG, or HEIC).");
  }
  if (!isHeicFile(file)) return file;
  const decoded = await nativeDecodeToJpeg(file);
  if (decoded) return decoded;
  throw new Error(HEIC_UNSUPPORTED_MESSAGE);
}
