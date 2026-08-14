import { useMemo } from "react";
import { RotateCcw, AlertTriangle, Users } from "lucide-react";
import type { MatchResult } from "@/lib/face/types";
import { CelebrityPortrait } from "@/components/celebrity-portrait";
import { MatchRevealCard } from "@/components/results/match-reveal-card";
import { ShareCard } from "@/components/results/share-card";
import { NumberCounter } from "@/components/ui/number-counter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { honestyBand, restListHeading } from "@/lib/ux/honesty";

interface MatchResultsProps {
  result: MatchResult;
  previewUrl: string | null;
  onReset: () => void;
  onMatchOtherFace?: () => void;
}

export function MatchResults({
  result,
  previewUrl,
  onReset,
  onMatchOtherFace,
}: MatchResultsProps) {
  const top = result.matches[0];
  const rest = result.matches.slice(1);
  const youUrl = result.facePreviewUrl || previewUrl;
  const topWeak = top ? honestyBand(top.matchPercent) === "weak" : false;

  const qualityNote = useMemo(() => {
    if (result.quality.issues.length === 0) return null;
    return result.quality.issues[0];
  }, [result.quality]);

  if (!top) {
    return (
      <section className="animate-fade-up space-y-5 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-7 w-7 text-warn" strokeWidth={1.5} />
          <h2 className="text-lg font-medium">No face detected</h2>
          <p className="max-w-sm text-sm text-fg-muted text-pretty">
            {result.quality.issues[0] ??
              "Try another photo with your face clearly visible."}
          </p>
          <Button variant="secondary" onClick={onReset} className="mt-1">
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      </section>
    );
  }

  // All bands share one shell so weak matches keep ComparisonView / Landmarks HUD
  // and the quality note. ShareCard stays soft/strong only (no twin-share chrome on weak).
  return (
    <section className="animate-fade-up space-y-6">
      {qualityNote && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <p className="text-sm text-fg-muted text-pretty leading-snug">{qualityNote}</p>
        </div>
      )}

      <MatchRevealCard
        topMatch={top}
        youUrl={youUrl}
        estimatedAge={result.estimatedAge}
        quality={result.quality}
        landmarks={result.croppedLandmarks}
        anatomical={result.features?.anatomical}
        occlusion={result.occlusion}
        youthfulness={result.features?.youthfulness}
      />

      {rest.length > 0 && (
        <div className="space-y-3 pt-2">
          <h3 className="px-1 text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-fg-subtle">
            {restListHeading(top.matchPercent)}
          </h3>
          <ul className="space-y-2.5">
            {rest.map((m, i) => (
              <li
                key={m.celebrityId}
                className={cn(
                  "animate-fade-up flex items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-bg-elevated px-4 py-3 shadow-sm transition-colors hover:border-match/40",
                )}
                style={{ animationDelay: `${(i + 1) * 120}ms`, animationFillMode: "both" }}
              >
                <span className="w-5 text-center text-xs font-mono font-medium text-fg-subtle">
                  #{i + 2}
                </span>
                <CelebrityPortrait
                  initials={m.initials}
                  accentHue={m.accentHue}
                  photoUrl={m.photoUrl}
                  photoUrl192={m.photoUrl192}
                  fallbackUrl={m.fallbackPhotoUrl}
                  size="sm"
                  alt={m.name}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight text-fg">{m.name}</p>
                  <p className="truncate text-xs text-fg-muted">{m.knownFor}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="flex items-baseline justify-end text-sm font-bold tabular-nums text-match">
                    <NumberCounter value={m.matchPercent} duration={1000} decimals={0} />
                    <span className="text-xs">%</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!topWeak && (
        <ShareCard
          youUrl={youUrl}
          celebrityName={top.name}
          celebrityPhotoUrl={top.photoUrl}
          celebrityPhoto192Url={top.photoUrl192}
          matchPercent={top.matchPercent}
        />
      )}

      {onMatchOtherFace && (
        <Button variant="secondary" size="lg" onClick={onMatchOtherFace} className="w-full">
          <Users className="h-4 w-4" />
          Match another face in this photo
        </Button>
      )}

      <Button variant="secondary" size="lg" onClick={onReset} className="w-full">
        <RotateCcw className="h-4 w-4" />
        Try another photo
      </Button>

      <p className="pb-1 text-center text-[11px] leading-relaxed text-fg-subtle">
        FaceNet embeddings · on-device · engine v{result.engineVersion}
      </p>
    </section>
  );
}

