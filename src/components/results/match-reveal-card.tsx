import { useEffect, useState } from "react";
import type { CelebrityMatch, ExtendedAnatomicalFeatures } from "@/lib/face/types";
import type { RegionalOcclusionConfidence } from "@/lib/face/occlusion";
import { NumberCounter } from "@/components/ui/number-counter";
import { ComparisonView } from "@/components/results/comparison-view";
import { Progress } from "@/components/ui/progress";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  honestyBand,
  honestyHeadline,
  honestyRating,
  shouldShowEstimatedAge,
} from "@/lib/ux/honesty";

export interface MatchRevealCardProps {
  topMatch: CelebrityMatch;
  youUrl: string | null;
  estimatedAge?: number | null;
  quality?: { score?: number; sharpness?: number };
  landmarks?: Array<{ x: number; y: number }> | null;
  anatomical?: ExtendedAnatomicalFeatures | null;
  occlusion?: RegionalOcclusionConfidence | null;
  youthfulness?: number | null;
  className?: string;
}

export function MatchRevealCard({
  topMatch,
  youUrl,
  estimatedAge,
  quality,
  landmarks = null,
  anatomical = null,
  occlusion = null,
  youthfulness = null,
  className,
}: MatchRevealCardProps) {
  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    // Trigger active 3D reveal stage animation
    const timer = setTimeout(() => setIsRevealed(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const confidenceScore = topMatch.confidenceScore ?? Math.round(topMatch.matchPercent * 0.95);
  const sim = topMatch.matchPercent;
  const band = honestyBand(sim);
  const isWeak = band === "weak";
  const headline = honestyHeadline(band);
  const confidenceRating = honestyRating(band, confidenceScore);
  const badgePct = Math.round(sim);
  const showAge = shouldShowEstimatedAge(estimatedAge, quality, {
    youthfulness: youthfulness ?? undefined,
  });
  const showMeta = showAge || topMatch.tags.length > 0;
  const visibleTraits = (topMatch.traits ?? [])
    .filter((t) => !isWeak || t.trait === "facialStructure")
    .slice(0, 4);

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-xl)] border border-match/40 bg-bg-elevated shadow-2xl transition-all duration-700 perspective-1000",
        isRevealed ? "animate-card-flip-in animate-glow-aura" : "opacity-0 scale-95",
        className
      )}
    >
      {/* Ambient Sparkles Overlay — toned down for weak matches */}
      {!isWeak && (
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <div className="absolute top-4 left-1/4 h-2 w-2 rounded-full bg-match text-match animate-sparkle-float opacity-70" style={{ animationDelay: "0ms" }} />
          <div className="absolute top-8 right-1/4 h-1.5 w-1.5 rounded-full bg-match text-match animate-sparkle-float opacity-80" style={{ animationDelay: "600ms" }} />
          <div className="absolute bottom-12 left-1/3 h-2 w-2 rounded-full bg-match text-match animate-sparkle-float opacity-60" style={{ animationDelay: "1200ms" }} />
        </div>
      )}

      {/* Header Banner with Score & Confidence */}
      <div className="relative z-10 border-b border-border bg-gradient-to-b from-bg-subtle/80 to-bg-elevated px-5 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.16em] text-match">
            {headline}
          </p>

          {/* Match Confidence Score Badge — weak matches show face similarity only */}
          <div className="flex items-center gap-1.5 rounded-full border border-match/40 bg-match/10 px-2.5 py-0.5 text-[10px] font-mono font-medium text-match shadow-sm">
            <ShieldCheck className="h-3 w-3" />
            <span>
              {confidenceRating} ({badgePct}%)
            </span>
          </div>
        </div>
        {isWeak && (
          <p className="mt-2 text-[11px] leading-snug text-fg-muted">
            No strong doppelgänger in the gallery — this is only the nearest embedding
            neighbor ({badgePct}% face similarity). It may not look like you. Check other
            matches below or try a front-facing photo in even light.
          </p>
        )}

        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[1.75rem] sm:text-[2.25rem] font-bold tracking-tight leading-tight truncate text-fg">
              {topMatch.name}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-fg-muted truncate">{topMatch.knownFor}</p>
          </div>

          <div className="shrink-0 text-right">
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
              SIMILARITY
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Progress value={topMatch.matchPercent} className="h-1.5" />
        </div>
      </div>

      {/* Interactive Face Comparison View */}
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
          landmarks={landmarks}
          anatomical={anatomical}
          occlusion={occlusion}
        />
      </div>

      {/* Meta Pills */}
      {showMeta && (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 border-t border-border bg-bg-subtle/50 px-5 py-3 sm:px-6">
          {showAge && (
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

      {visibleTraits.length > 0 && (
        <div className="relative z-10 border-t border-border px-5 py-5 sm:px-6">
          <h3 className="mb-3.5 text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-fg-subtle">
            {isWeak ? "FACE SIMILARITY BREAKDOWN" : "GRANULAR FACIAL DESCRIPTORS"}
          </h3>
          <ul className="space-y-3">
            {visibleTraits.map((t) => {
              const traitPercent = Math.round(t.similarity * 100);
              return (
                <li key={t.trait}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="text-xs sm:text-sm font-medium text-fg">{t.label}</span>
                    <div className="flex items-center gap-1 text-xs font-mono tabular-nums text-match">
                      <NumberCounter value={traitPercent} duration={1200} decimals={0} />
                      <span>%</span>
                    </div>
                  </div>
                  <Progress
                    value={traitPercent}
                    className="h-1.5"
                    barClassName="bg-match"
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}
