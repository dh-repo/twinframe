import { useMemo } from "react";
import { RotateCcw, AlertTriangle } from "lucide-react";
import type { MatchResult } from "@/lib/face/types";
import { CelebrityPortrait } from "@/components/celebrity-portrait";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface MatchResultsProps {
  result: MatchResult;
  previewUrl: string | null;
  onReset: () => void;
}

export function MatchResults({ result, previewUrl, onReset }: MatchResultsProps) {
  const top = result.matches[0];
  const rest = result.matches.slice(1);
  const youUrl = result.facePreviewUrl || previewUrl;

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

  return (
    <section className="animate-fade-up space-y-5">
      {qualityNote && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <p className="text-sm text-fg-muted text-pretty leading-snug">{qualityNote}</p>
        </div>
      )}

      {/* Primary match card */}
      <article className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-elevated">
        {/* Score banner */}
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
            Closest match
          </p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[1.75rem] sm:text-[2rem] font-medium tracking-tight leading-none truncate">
                {top.name}
              </h2>
              <p className="mt-1.5 text-sm text-fg-muted">{top.knownFor}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[2rem] sm:text-[2.25rem] font-medium tabular-nums leading-none text-match tracking-tight">
                {top.matchPercent.toFixed(0)}
                <span className="text-lg text-match/80">%</span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-fg-subtle">
                match
              </p>
            </div>
          </div>
          <div className="mt-4">
            <Progress value={top.matchPercent} className="h-1" />
          </div>
        </div>

        {/* Face pair */}
        <div className="flex items-center justify-center gap-4 px-5 py-6 sm:gap-6 sm:px-6">
          <div className="flex flex-col items-center gap-2">
            <div className="relative h-28 w-28 sm:h-32 sm:w-32 overflow-hidden rounded-full border border-border bg-bg-subtle">
              {youUrl ? (
                <img
                  src={youUrl}
                  alt="You"
                  className="h-full w-full object-cover object-top"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-fg-subtle">
                  You
                </div>
              )}
            </div>
            <span className="text-xs text-fg-muted">You</span>
          </div>

          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-xs text-fg-subtle"
            aria-hidden
          >
            ≈
          </div>

          <div className="flex flex-col items-center gap-2">
            <CelebrityPortrait
              initials={top.initials}
              accentHue={top.accentHue}
              photoUrl={top.photoUrl}
              size="xl"
              alt={top.name}
            />
            <span className="max-w-[7rem] truncate text-xs text-fg-muted text-center">
              {top.name.split(" ")[0]}
            </span>
          </div>
        </div>

        {/* Meta row */}
        {(result.estimatedAge || top.tags.length > 0) && (
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border px-5 py-3.5 sm:px-6">
            {result.estimatedAge != null && (
              <span className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted tabular-nums">
                ~{result.estimatedAge} yrs detected
              </span>
            )}
            {top.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Traits */}
        <div className="border-t border-border px-5 py-5 sm:px-6">
          <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
            Similarity signals
          </h3>
          <ul className="space-y-3">
            {top.traits.map((t) => (
              <li key={t.trait}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="text-sm text-fg">{t.label}</span>
                  <span className="text-xs tabular-nums text-fg-muted">
                    {Math.round(t.similarity * 100)}%
                  </span>
                </div>
                <Progress
                  value={t.similarity * 100}
                  className="h-1"
                  barClassName="bg-fg-muted"
                />
              </li>
            ))}
          </ul>
        </div>
      </article>

      {/* Contenders */}
      {rest.length > 0 && (
        <div className="space-y-2.5">
          <h3 className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
            Also close
          </h3>
          <ul className="space-y-2">
            {rest.map((m, i) => (
              <li
                key={m.celebrityId}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-bg-elevated px-3.5 py-3",
                )}
              >
                <span className="w-4 text-center text-xs tabular-nums text-fg-subtle">
                  {i + 2}
                </span>
                <CelebrityPortrait
                  initials={m.initials}
                  accentHue={m.accentHue}
                  photoUrl={m.photoUrl}
                  size="sm"
                  alt={m.name}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">{m.name}</p>
                  <p className="truncate text-xs text-fg-muted">{m.knownFor}</p>
                </div>
                <p className="shrink-0 text-sm font-medium tabular-nums text-match">
                  {m.matchPercent.toFixed(0)}%
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant="primary" size="lg" onClick={onReset} className="w-full">
        <RotateCcw className="h-4 w-4" />
        Try another photo
      </Button>

      <p className="pb-1 text-center text-[11px] leading-relaxed text-fg-subtle">
        FaceNet embeddings · on-device · engine v{result.engineVersion}
      </p>
    </section>
  );
}
