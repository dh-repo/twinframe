import { useMemo, useState } from "react";
import { ThumbsDown, Sparkles } from "lucide-react";
import type { CelebrityMatch } from "@/lib/face/types";
import { Button } from "@/components/ui/button";
import {
  hashProbeKey,
  saveLookalikeFeedbackEvent,
} from "@/lib/face/lookalike-feedback";

interface MatchFeedbackProps {
  topMatch: CelebrityMatch;
  contenders: CelebrityMatch[];
  previewUrl: string | null;
  engineVersion?: string;
}

export function MatchFeedback({
  topMatch,
  contenders,
  previewUrl,
  engineVersion,
}: MatchFeedbackProps) {
  const [sent, setSent] = useState<"not_really" | "better_match" | null>(null);
  const [picking, setPicking] = useState(false);
  const probeHash = useMemo(
    () => hashProbeKey(previewUrl || topMatch.celebrityId),
    [previewUrl, topMatch.celebrityId],
  );

  if (sent) {
    return (
      <p className="rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3.5 py-3 text-center text-xs text-fg-muted">
        Thanks — that helps tune future look-alikes
        {sent === "better_match" ? " (better match saved)" : " (hard negative saved)"}.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3.5 py-3">
      <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-subtle">
        Was this a good look-alike?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            saveLookalikeFeedbackEvent({
              probeHash,
              shownId: topMatch.celebrityId,
              shownPercent: topMatch.matchPercent,
              verdict: "not_really",
              engineVersion,
            });
            setSent("not_really");
            setPicking(false);
          }}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
          Not really
        </Button>
        {contenders.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setPicking((v) => !v)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Better match…
          </Button>
        )}
      </div>
      {picking && contenders.length > 0 && (
        <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
          {contenders.map((m) => (
            <li key={m.celebrityId}>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/5"
                onClick={() => {
                  saveLookalikeFeedbackEvent({
                    probeHash,
                    shownId: topMatch.celebrityId,
                    shownPercent: topMatch.matchPercent,
                    verdict: "better_match",
                    betterId: m.celebrityId,
                    engineVersion,
                  });
                  setSent("better_match");
                  setPicking(false);
                }}
              >
                <span className="truncate text-fg">{m.name}</span>
                <span className="tabular-nums text-match">{Math.round(m.matchPercent)}%</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
