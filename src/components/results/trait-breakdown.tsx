import { useMemo, type ComponentType } from "react";
import type { CelebrityMatch, FaceFeatures } from "@/lib/face/types";
import {
  Activity,
  Eye,
  ScanFace,
  Sparkles,
  SunMedium,
  Users,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils/cn";
import { composeBreakdownRows } from "@/lib/ux/match-blurb";

export interface TraitBreakdownProps {
  match: CelebrityMatch;
  userFeatures?: FaceFeatures | null;
  celebFeatures?: FaceFeatures | null;
  className?: string;
}

function iconForTrait(id: string): ComponentType<{ className?: string }> {
  switch (id) {
    case "facialStructure":
    case "faceAspect":
    case "faceRoundness":
    case "jawWidth":
    case "chinSharpness":
      return ScanFace;
    case "ageAffinity":
    case "youthfulness":
      return Activity;
    case "genderPresentation":
      return Users;
    case "lightingQuality":
      return SunMedium;
    case "eyeSpacing":
    case "eyeOpenness":
    case "eyeSlant":
    case "browHeight":
      return Eye;
    default:
      return Sparkles;
  }
}

export function TraitBreakdown({
  match,
  userFeatures = null,
  celebFeatures = null,
  className,
}: TraitBreakdownProps) {
  const rows = useMemo(
    () =>
      composeBreakdownRows(match.traits, {
        userFeatures,
        celebFeatures,
      }),
    [match.traits, userFeatures, celebFeatures],
  );

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

      {rows.length === 0 ? (
        <p className="text-[12px] text-fg-muted">
          No measured trait scores for this match.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {rows.map((row) => {
            const Icon = iconForTrait(row.id);
            return (
              <div
                key={row.id}
                className="rounded-xl border border-border/80 bg-bg-subtle/70 p-3 shadow-sm transition-colors hover:border-match/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-match/30 bg-match/10 text-match">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <p className="truncate text-xs font-semibold text-fg">
                      {row.name}
                    </p>
                  </div>
                  <span className="font-mono text-xs font-bold text-match tabular-nums shrink-0">
                    {row.score}%
                  </span>
                </div>

                <p className="mt-1.5 text-[11px] leading-snug text-fg-muted line-clamp-1">
                  {row.description}
                </p>

                <div className="mt-2.5">
                  <Progress value={row.score} className="h-1 bg-border/60" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
