import {
  APPEARANCE_FAMILIES_URL,
  applyAppearanceFamilyManifest,
} from "./appearance-family.ts";

let loadPromise: Promise<void> | null = null;

export function resetAppearanceFamiliesLoadForTests(): void {
  loadPromise = null;
}

async function fetchAndRegister(fetchImpl: typeof fetch): Promise<void> {
  try {
    const res = await fetchImpl(APPEARANCE_FAMILIES_URL);
    if (!res.ok) return;
    applyAppearanceFamilyManifest(await res.json());
  } catch {
    // Ranking stays unfiltered until the glance-family manifest loads.
  }
}

/** Fetch glance-family labels once. Safe to call on every boot. */
export function loadAppearanceFamilies(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!loadPromise) {
    loadPromise = fetchAndRegister(fetchImpl);
  }
  return loadPromise;
}
