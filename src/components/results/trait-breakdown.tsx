import { useMemo, type ComponentType } from "react";
import type { CelebrityMatch } from "@/lib/face/types";
import { ScanFace, Calendar, Users, Sun, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils/cn";

export interface TraitBreakdownProps {
  match: CelebrityMatch;
  className?: string;
}

interface BiometricAttribute {
  id: string;
  name: string;
  score: number;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

function iconForTrait(trait: string): ComponentType<{ className?: string }> {
  switch (trait) {
    case "facialStructure":
    case "facialThirds":
      return ScanFace;
    case "ageAffinity":
      return Calendar;
    case "genderPresentation":
      return Users;
    case "lightingQuality":
      return Sun;
    default:
      return Sparkles;
  }
}

function descriptionForTrait(trait: string, label: string): string {
  switch (trait) {
    case "facialStructure":
      return "Overall EdgeFace embedding similarity — not a regional landmark score";
    case "ageAffinity":
      return "Soft age prior vs this celebrity's gallery age";
    case "genderPresentation":
      return "Soft presentation prior — never a hard filter";
    case "lightingQuality":
      return "Detection confidence, sharpness, and face coverage";
    default:
      return label;
  }
}

export function TraitBreakdown({ match, className }: TraitBreakdownProps) {
  const attributes = useMemo<BiometricAttribute[]>(() => {
    if (match.traits.length > 0) {
      return match.traits.map((t) => ({
        id: t.trait,
        name: t.label,
        score: Math.round(Math.max(0, Math.min(1, t.similarity)) * 100),
        description: descriptionForTrait(t.trait, t.label),
        icon: iconForTrait(t.trait),
      }));
    }
    return [
      {
        id: "embedding",
        name: "Face embedding",
        score: Math.round(match.matchPercent),
        description: "Overall EdgeFace similarity — not a regional trait score",
        icon: ScanFace,
      },
    ];
  }, [match]);

  return (
    <div className={cn("space-y-3.5", className)}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-mono font-semibold uppercase tracking-wider text-fg-subtle">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-match" />
          Feature breakdown
        </h4>
        <span className="text-[11px] font-mono font-medium text-match">
          512-d match
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {attributes.map((attr) => {
          const Icon = attr.icon;
          return (
            <div
              key={attr.id}
              className="rounded-xl border border-border/80 bg-bg-subtle/70 p-3 shadow-sm transition-colors hover:border-match/30"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-match/30 bg-match/10 text-match">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <p className="truncate text-xs font-semibold text-fg">
                    {attr.name}
                  </p>
                </div>
                <span className="font-mono text-xs font-bold text-match tabular-nums shrink-0">
                  {attr.score}%
                </span>
              </div>

              <p className="mt-1.5 text-[11px] leading-snug text-fg-muted line-clamp-1">
                {attr.description}
              </p>

              <div className="mt-2.5">
                <Progress value={attr.score} className="h-1 bg-border/60" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
