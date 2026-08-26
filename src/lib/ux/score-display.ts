import type { VerdictTier } from "../face/verdict.ts";

export interface ScoreDisplayInput {
  matchPercent: number;
  probabilityCorrect?: number;
  verdict?: VerdictTier;
}

export interface ScoreDisplay {
  /** Calibrated P(closest identity in this gallery) as 0–100. Null when we must not hero a percent. */
  heroPercent: number | null;
  heroCaption: string;
  /** Distant Twin / missing calibration — do not sell Hill percent as a twin score. */
  muteHeroPercent: boolean;
  similarityPercent: number;
  similarityLabel: "NEAREST" | "SIMILARITY";
  showSparkles: boolean;
}

function finiteProb(p: number | undefined): number | undefined {
  return typeof p === "number" && Number.isFinite(p) ? p : undefined;
}

export function scoreDisplay(input: ScoreDisplayInput): ScoreDisplay {
  const distant = input.verdict === "distant-twin";
  const p = finiteProb(input.probabilityCorrect);
  const similarityPercent = Number.isFinite(input.matchPercent) ? input.matchPercent : 0;
  const similarityLabel: "NEAREST" | "SIMILARITY" = distant || similarityPercent < 55 ? "NEAREST" : "SIMILARITY";
  const muteHeroPercent = distant || p == null;
  const heroPercent = muteHeroPercent ? null : Math.round(p * 100);

  return {
    heroPercent,
    heroCaption: distant ? "NOT A TWIN CLAIM" : p != null ? "GALLERY ID CHANCE" : "UNCALIBRATED",
    muteHeroPercent,
    similarityPercent,
    similarityLabel,
    showSparkles: !distant && similarityLabel === "SIMILARITY",
  };
}
