import { GALLERY_FEATURES_URL, applyGalleryFeatureManifest } from "./gallery-features.ts";

let loadPromise: Promise<void> | null = null;

export function resetGalleryFeaturesLoadForTests(): void {
  loadPromise = null;
}

async function fetchAndRegister(fetchImpl: typeof fetch): Promise<void> {
  try {
    const res = await fetchImpl(GALLERY_FEATURES_URL);
    if (!res.ok) return;
    applyGalleryFeatureManifest(await res.json());
  } catch {
    // Distinctive-trait blurbs stay unavailable until the manifest loads.
  }
}

/** Fetch 1,000-celeb geometry once. Safe to call on every boot. */
export function loadGalleryFeatures(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!loadPromise) {
    loadPromise = fetchAndRegister(fetchImpl);
  }
  return loadPromise;
}
