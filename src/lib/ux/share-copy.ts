import {
  verdictFromMatch,
  verdictLabel,
  verdictSubtitle,
  type VerdictTier,
} from "../face/verdict.ts";

export interface ShareCopyInput {
  name: string;
  matchPercent: number;
  verdict?: VerdictTier;
  adjustedDistance?: number;
  rankMargin?: number;
  blurb?: string;
}

/** Use the match's verdict when present; otherwise derive it from ranking signals. */
export function resolveShareVerdict(input: {
  verdict?: VerdictTier;
  adjustedDistance?: number;
  rankMargin?: number;
  matchPercent: number;
}): VerdictTier {
  if (input.verdict) return input.verdict;
  return verdictFromMatch({
    adjustedDistance: input.adjustedDistance ?? Number.POSITIVE_INFINITY,
    rankMargin: input.rankMargin ?? 0,
    matchPercent: input.matchPercent,
  });
}

/** Blurb if the match has one; otherwise the honest verdict subtitle. */
export function shareCardBlurb(
  blurb: string | undefined,
  verdict: VerdictTier,
): string {
  const trimmed = blurb?.trim();
  return trimmed ? trimmed : verdictSubtitle(verdict);
}

export function shareCardFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `twinframe-${slug || "match"}.png`;
}

/**
 * Share / clipboard copy: verdict stamp + percent + name.
 * Distant twins stay shareable — honest, not hidden.
 */
export function shareText(
  name: string,
  matchPercent: number,
  verdict: VerdictTier,
): string {
  const pct = Math.round(matchPercent);
  const stamp = verdictLabel(verdict);
  switch (verdict) {
    case "dead-ringer":
      return `${stamp}: I matched ${name} at ${pct}% on Twinframe.`;
    case "strong-resemblance":
      return `${stamp}: ${name} at ${pct}% on Twinframe.`;
    case "soft-match":
      return `${stamp}: ${name} at ${pct}% similarity on Twinframe.`;
    case "distant-twin":
      return `${stamp}: nearest gallery neighbor is ${name} at ${pct}% on Twinframe.`;
    default: {
      const _exhaustive: never = verdict;
      return _exhaustive;
    }
  }
}

export function shareTextFromMatch(input: ShareCopyInput): string {
  return shareText(input.name, input.matchPercent, resolveShareVerdict(input));
}
