import {
  DEFAULT_PACK,
  applyPackManifest,
  isPackId,
  type PackId,
} from "./packs.ts";

export const PACKS_URL = "/celebs/packs.json";
export const PACK_STORAGE_KEY = "twinframe.pack";

let loadPromise: Promise<void> | null = null;

export function resetPacksLoadForTests(): void {
  loadPromise = null;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readStoredPack(): PackId {
  if (!canUseStorage()) return DEFAULT_PACK;
  try {
    const raw = window.localStorage.getItem(PACK_STORAGE_KEY);
    if (raw && isPackId(raw)) return raw;
  } catch {
    return DEFAULT_PACK;
  }
  return DEFAULT_PACK;
}

export function writeStoredPack(pack: PackId): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(PACK_STORAGE_KEY, pack);
  } catch {
    // Quota / private mode — pack still applies for this session.
  }
}

async function fetchAndRegister(fetchImpl: typeof fetch): Promise<void> {
  try {
    const res = await fetchImpl(PACKS_URL);
    if (!res.ok) return;
    const data: unknown = await res.json();
    applyPackManifest(data);
  } catch {
    // knownFor-only membership remains when the manifest is missing.
  }
}

/** Fetch curated pack ids once and register them. Safe to call on every boot. */
export function loadCuratedPacks(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!loadPromise) {
    loadPromise = fetchAndRegister(fetchImpl);
  }
  return loadPromise;
}
