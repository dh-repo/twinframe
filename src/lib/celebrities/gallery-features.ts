import type { FaceFeatures } from "../face/types.ts";

export const GALLERY_FEATURES_URL = "/celebs/gallery.features.json";

type FeatureMap = Record<string, Partial<FaceFeatures>>;

let featuresById: FeatureMap = {};

function isFeatureRow(value: unknown): value is Partial<FaceFeatures> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Register celeb geometry from `gallery.features.json` (or a test stub). */
export function applyGalleryFeatureManifest(data: unknown): void {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    featuresById = {};
    return;
  }
  const next: FeatureMap = {};
  for (const [id, row] of Object.entries(data as Record<string, unknown>)) {
    if (typeof id === "string" && id && isFeatureRow(row)) next[id] = row;
  }
  featuresById = next;
}

export function galleryFeaturesFor(id: string): Partial<FaceFeatures> | null {
  const row = featuresById[id];
  return row ?? null;
}

export function galleryFeatureCount(): number {
  return Object.keys(featuresById).length;
}

export function resetGalleryFeaturesForTests(): void {
  featuresById = {};
}
