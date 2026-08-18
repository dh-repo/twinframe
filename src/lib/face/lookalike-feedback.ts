/**
 * Local look-alike feedback store for hard-negative mining.
 * Client-only; no server round-trip in v1.
 */

import type { VerdictTier } from "./verdict.ts";

export type LookalikeFeedbackVerdict = "not_really" | "better_match" | "fair_nearest";

export interface LookalikeFeedbackCopy {
  prompt: string;
  negativeLabel: string;
  /** Distant Twin only — confirm the nearest face is at least plausible. */
  fairNearestLabel: string | null;
}

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

function feedbackTier(verdict?: VerdictTier): VerdictTier {
  return verdict ?? "soft-match";
}

/** Prompt + buttons. Distant Twin asks about nearest-neighbor honesty, not look-alikes. */
export function lookalikeFeedbackCopy(verdict?: VerdictTier): LookalikeFeedbackCopy {
  switch (feedbackTier(verdict)) {
    case "distant-twin":
      return {
        prompt: "Was the nearest face at least plausible?",
        negativeLabel: "Wrong nearest",
        fairNearestLabel: "Fair nearest",
      };
    case "dead-ringer":
    case "strong-resemblance":
    case "soft-match":
      return {
        prompt: "Was this a good look-alike?",
        negativeLabel: "Not really",
        fairNearestLabel: null,
      };
    default: {
      const _exhaustive: never = feedbackTier(verdict);
      return _exhaustive;
    }
  }
}

export function lookalikeFeedbackThanks(
  verdict: VerdictTier | undefined,
  sent: LookalikeFeedbackVerdict,
): string {
  if (feedbackTier(verdict) === "distant-twin") {
    switch (sent) {
      case "fair_nearest":
        return "Thanks — noted as a fair nearest neighbor.";
      case "not_really":
        return "Thanks — marked as the wrong nearest face.";
      case "better_match":
        return "Thanks — noted a closer nearest neighbor.";
      default: {
        const _exhaustive: never = sent;
        return _exhaustive;
      }
    }
  }
  switch (sent) {
    case "better_match":
      return "Thanks — that helps tune future look-alikes (better match saved).";
    case "not_really":
      return "Thanks — that helps tune future look-alikes (hard negative saved).";
    case "fair_nearest":
      return "Thanks — that helps tune future look-alikes.";
    default: {
      const _exhaustive: never = sent;
      return _exhaustive;
    }
  }
}
