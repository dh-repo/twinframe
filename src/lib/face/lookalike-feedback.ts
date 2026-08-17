/**
 * Local look-alike feedback store for hard-negative mining.
 * Client-only; no server round-trip in v1.
 */

export type LookalikeFeedbackVerdict = "not_really" | "better_match";

export interface LookalikeFeedbackEvent {
  id: string;
  createdAt: number;
  probeHash: string;
  shownId: string;
  shownPercent: number;
  verdict: LookalikeFeedbackVerdict;
  betterId?: string;
  engineVersion?: string;
}

const STORAGE_KEY = "twinframe-lookalike-feedback-v1";
const MAX_EVENTS = 200;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadLookalikeFeedback(): LookalikeFeedbackEvent[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LookalikeFeedbackEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLookalikeFeedbackEvent(
  event: Omit<LookalikeFeedbackEvent, "id" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  },
): LookalikeFeedbackEvent {
  const full: LookalikeFeedbackEvent = {
    id: event.id ?? `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: event.createdAt ?? Date.now(),
    probeHash: event.probeHash,
    shownId: event.shownId,
    shownPercent: event.shownPercent,
    verdict: event.verdict,
    betterId: event.betterId,
    engineVersion: event.engineVersion,
  };
  if (!canUseStorage()) return full;
  const prev = loadLookalikeFeedback();
  const next = [full, ...prev].slice(0, MAX_EVENTS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return full;
}

/** Cheap stable hash of a data URL / object URL string for de-dupe. */
export function hashProbeKey(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
