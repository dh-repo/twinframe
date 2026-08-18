import { useEffect, useMemo, useState } from "react";
import type { CelebrityMatch, FaceFeatures } from "@/lib/face/types";
import { NumberCounter } from "@/components/ui/number-counter";
import { ComparisonView } from "@/components/results/comparison-view";
import { TraitBreakdown } from "@/components/results/trait-breakdown";
import { ShareCardModal } from "@/components/results/share-card-modal";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Share2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  honestyBand,
  honestyBandFromVerdict,
  honestyHeadline,
  honestyRating,
  honestyShareLabel,
} from "@/lib/ux/honesty";
import { composeMatchBlurb } from "@/lib/ux/match-blurb";
import { verdictLabel, verdictSubtitle } from "@/lib/face/verdict";
import { getCelebrityById } from "@/lib/celebrities/database";
import { galleryFeaturesFor } from "@/lib/celebrities/gallery-features";

export interface MatchRevealCardProps {
  topMatch: CelebrityMatch;
  youUrl: string | null;
  estimatedAge?: number | null;
  userFeatures?: FaceFeatures | null;
  className?: string;
}

export function MatchRevealCard({
  topMatch,
  youUrl,
  estimatedAge,
  userFeatures = null,
  className,
}: MatchRevealCardProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsRevealed(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const celebFeatures =
    galleryFeaturesFor(topMatch.celebrityId) ??
    getCelebrityById(topMatch.celebrityId)?.features ??
    null;
  const band = topMatch.verdict
    ? honestyBandFromVerdict(topMatch.verdict)
    : honestyBand(topMatch.matchPercent, topMatch.rankMargin);
  const confidenceScore =
    topMatch.confidenceScore ?? Math.round(topMatch.matchPercent * 0.95);
  const confidenceRating = honestyRating(band, confidenceScore);
  const headline = topMatch.verdict
    ? verdictLabel(topMatch.verdict)
    : honestyHeadline(band);
  const secondary = topMatch.verdict
    ? verdictSubtitle(topMatch.verdict)
    : honestyShareLabel(band);

  const blurb = useMemo(
    () =>
      topMatch.blurb ??
      composeMatchBlurb({
        name: topMatch.name,
        gender: topMatch.gender,
        tags: topMatch.tags,
        celebFeatures,
        userFeatures,
      }),
    [
      topMatch.blurb,
      topMatch.name,
      topMatch.gender,
      topMatch.tags,
      celebFeatures,
      userFeatures,
    ],
  );
  const matchWithBlurb = useMemo<CelebrityMatch>(
    () => (topMatch.blurb === blurb ? topMatch : { ...topMatch, blurb }),
    [topMatch, blurb],
  );

  return (
    <>
      <article
        className={cn(
          "relative overflow-hidden rounded-[var(--radius-xl)] border border-match/40 bg-bg-elevated shadow-2xl transition-all duration-700 perspective-1000",
          isRevealed ? "animate-card-flip-in animate-glow-aura" : "opacity-0 scale-95",
          className,
        )}
      >
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <div
            className="absolute top-4 left-1/4 h-2 w-2 rounded-full bg-match text-match animate-sparkle-float opacity-70"
            style={{ animationDelay: "0ms" }}
          />
          <div
            className="absolute top-8 right-1/4 h-1.5 w-1.5 rounded-full bg-match text-match animate-sparkle-float opacity-80"
            style={{ animationDelay: "600ms" }}
          />
          <div
            className="absolute bottom-12 left-1/3 h-2 w-2 rounded-full bg-match text-match animate-sparkle-float opacity-60"
            style={{ animationDelay: "1200ms" }}
          />
        </div>

        <div className="relative z-10 border-b border-border bg-gradient-to-b from-bg-subtle/80 to-bg-elevated px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.16em] text-match">
                {headline}
              </p>
              <p className="mt-0.5 text-[10px] font-mono text-fg-subtle">
                {secondary}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-match/40 bg-match/10 px-2.5 py-1.5 text-[10px] font-mono font-medium text-match shadow-sm">
                <ShieldCheck className="h-3 w-3" />
                <span>
                  {confidenceRating}
                  {band === "strong" ? ` (${confidenceScore}%)` : ""}
                </span>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShareOpen(true)}
                className="h-11 w-11 text-match hover:bg-match/10"
                title="Create shareable card"
                aria-label="Share match"
              >
                <Share2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-[1.75rem] sm:text-[2.25rem] font-bold tracking-tight leading-tight truncate text-fg">
                {topMatch.name}
              </h2>
              <p className="mt-1 text-sm text-fg leading-snug text-pretty">
                {blurb}
              </p>
              <p className="mt-1 text-xs sm:text-sm text-fg-muted truncate">
                {topMatch.knownFor}
              </p>
            </div>

            <div
              className="shrink-0 text-right"
              data-match-percent={Math.round(topMatch.matchPercent)}
              data-verdict={topMatch.verdict ?? ""}
            >
              <div className="flex items-baseline justify-end gap-0.5 text-match">
                <NumberCounter
                  value={topMatch.matchPercent}
                  duration={1400}
                  decimals={0}
                  className="text-[2.25rem] sm:text-[2.75rem] font-extrabold tabular-nums leading-none tracking-tight"
                />
                <span className="text-xl font-bold">%</span>
              </div>
              <p className="mt-0.5 text-[10px] uppercase font-mono tracking-widest text-fg-subtle">
                {band === "weak" ? "NEAREST" : "SIMILARITY"}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <Progress value={topMatch.matchPercent} className="h-1.5" />
          </div>
        </div>

        <div className="relative z-10 p-5 sm:p-6 bg-bg-elevated">
          <ComparisonView
            userPhotoUrl={youUrl}
            celebrityPhotoUrl={topMatch.photoUrl}
            celebrityPhoto192Url={topMatch.photoUrl192}
            celebrityFallbackUrl={topMatch.fallbackPhotoUrl}
            celebrityName={topMatch.name}
            celebrityInitials={topMatch.initials}
            accentHue={topMatch.accentHue}
            traits={topMatch.traits}
          />
        </div>

        {(estimatedAge != null || topMatch.tags.length > 0) && (
          <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 border-t border-border bg-bg-subtle/50 px-5 py-3 sm:px-6">
            {estimatedAge != null && (
              <span className="rounded-full border border-border bg-bg px-3 py-1 text-xs text-fg-muted tabular-nums shadow-sm">
                ~{estimatedAge} yrs detected
              </span>
            )}
            {topMatch.tags.slice(0, 4).map((tag: string) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-bg px-3 py-1 text-xs text-fg-muted shadow-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="relative z-10 border-t border-border px-5 py-5 sm:px-6">
          <TraitBreakdown
            match={matchWithBlurb}
            userFeatures={userFeatures}
            celebFeatures={celebFeatures}
          />
        </div>
      </article>

      <ShareCardModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        topMatch={matchWithBlurb}
        userPhotoUrl={youUrl}
      />
    </>
  );
}
