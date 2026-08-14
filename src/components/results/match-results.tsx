import { useState, useMemo } from "react";
import { RotateCcw, AlertTriangle, Sparkles, Filter, Check } from "lucide-react";
import type { MatchResult, CelebrityMatch } from "@/lib/face/types";
import { CelebrityPortrait } from "@/components/celebrity-portrait";
import { MatchRevealCard } from "@/components/results/match-reveal-card";
import { NumberCounter } from "@/components/ui/number-counter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface MatchResultsProps {
  result: MatchResult;
  previewUrl: string | null;
  onReset: () => void;
}

export function MatchResults({ result, previewUrl, onReset }: MatchResultsProps) {
  const [selectedMatch, setSelectedMatch] = useState<CelebrityMatch | null>(null);
  const [genderFilter, setGenderFilter] = useState<"all" | "male" | "female">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filteredMatches = useMemo(() => {
    return result.matches.filter((m) => {
      if (genderFilter === "male" && m.gender !== "male") return false;
      if (genderFilter === "female" && m.gender !== "female") return false;
      if (categoryFilter !== "all" && m.knownFor !== categoryFilter) return false;
      return true;
    });
  }, [result.matches, genderFilter, categoryFilter]);

  const activeTop = selectedMatch || filteredMatches[0] || result.matches[0];
  const rest = filteredMatches.filter((m) => m.celebrityId !== activeTop?.celebrityId);
  const youUrl = result.facePreviewUrl || previewUrl;

  const qualityNote = useMemo(() => {
    if (result.quality.issues.length === 0) return null;
    return result.quality.issues[0];
  }, [result.quality]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of result.matches) {
      if (m.knownFor) set.add(m.knownFor);
    }
    return Array.from(set);
  }, [result.matches]);

  if (!activeTop) {
    return (
      <section className="animate-fade-up space-y-5 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-7 w-7 text-warn" strokeWidth={1.5} />
          <h2 className="text-lg font-medium">No matches found with current filter</h2>
          <p className="max-w-sm text-sm text-fg-muted text-pretty">
            Try resetting your gender or category filters to view all top doppelgängers.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setGenderFilter("all");
                setCategoryFilter("all");
              }}
            >
              Reset Filters
            </Button>
            <Button variant="primary" onClick={onReset}>
              <RotateCcw className="h-4 w-4" />
              New Photo
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="animate-fade-up space-y-6">
      {qualityNote && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <p className="text-sm text-fg-muted text-pretty leading-snug">{qualityNote}</p>
        </div>
      )}

      {/* Filter Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-xs">
        <div className="flex items-center gap-1.5 text-fg-muted font-mono uppercase text-[10px] tracking-wider">
          <Filter className="h-3.5 w-3.5 text-match" />
          <span>Filters:</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Gender Filter Buttons */}
          <button
            type="button"
            onClick={() => setGenderFilter("all")}
            className={cn(
              "rounded-full px-2.5 py-0.5 font-medium transition-all",
              genderFilter === "all" ? "bg-white text-black font-semibold" : "bg-white/5 text-white/70 hover:bg-white/10"
            )}
          >
            All Genders
          </button>
          <button
            type="button"
            onClick={() => setGenderFilter("male")}
            className={cn(
              "rounded-full px-2.5 py-0.5 font-medium transition-all",
              genderFilter === "male" ? "bg-white text-black font-semibold" : "bg-white/5 text-white/70 hover:bg-white/10"
            )}
          >
            Male Only
          </button>
          <button
            type="button"
            onClick={() => setGenderFilter("female")}
            className={cn(
              "rounded-full px-2.5 py-0.5 font-medium transition-all",
              genderFilter === "female" ? "bg-white text-black font-semibold" : "bg-white/5 text-white/70 hover:bg-white/10"
            )}
          >
            Female Only
          </button>
        </div>
      </div>

      {/* Primary match reveal card with 3D flip & active comparison */}
      <MatchRevealCard
        key={activeTop.celebrityId}
        topMatch={activeTop}
        youUrl={youUrl}
        estimatedAge={result.estimatedAge}
      />

      {/* Contenders list with interactive click-to-promote */}
      {rest.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-fg-subtle">
              ALSO CLOSE DOPPELGÄNGERS (TAP TO INSPECT)
            </h3>
            <span className="text-[10px] font-mono text-match">{rest.length} contenders</span>
          </div>

          <ul className="space-y-2.5">
            {rest.map((m, i) => (
              <li key={m.celebrityId}>
                <button
                  type="button"
                  onClick={() => setSelectedMatch(m)}
                  className={cn(
                    "animate-fade-up w-full text-left flex items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-bg-elevated px-4 py-3 shadow-sm hover:border-match/60 hover:bg-white/5 transition-all group cursor-pointer"
                  )}
                  style={{ animationDelay: `${(i + 1) * 80}ms`, animationFillMode: "both" }}
                >
                  <span className="w-5 text-center text-xs font-mono font-medium text-fg-subtle group-hover:text-match">
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
                    <p className="truncate text-sm font-semibold leading-tight text-fg group-hover:text-match transition-colors">
                      {m.name}
                    </p>
                    <p className="truncate text-xs text-fg-muted">{m.knownFor}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-baseline justify-end text-sm font-bold tabular-nums text-match">
                      <NumberCounter value={m.matchPercent} duration={1000} decimals={0} />
                      <span className="text-xs">%</span>
                    </div>
                    <span className="text-[9px] font-mono text-white/40 group-hover:text-match uppercase">
                      Inspect ➔
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant="primary" size="lg" onClick={onReset} className="w-full mt-4">
        <RotateCcw className="h-4 w-4" />
        Try another photo
      </Button>

      <p className="pb-1 text-center text-[11px] leading-relaxed text-fg-subtle">
        EdgeFace-M 256-d Float16 · ExpNorm 3D UV · On-device engine v{result.engineVersion}
      </p>
    </section>
  );
}


