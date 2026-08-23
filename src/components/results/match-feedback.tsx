import { useMemo, useState } from "react";
import { ThumbsDown, ThumbsUp, Sparkles } from "lucide-react";
import type { CelebrityMatch } from "@/lib/face/types";
import { Button } from "@/components/ui/button";
import {
  hashProbeKey,
  lookalikeFeedbackCopy,
  lookalikeFeedbackThanks,
  saveLookalikeFeedbackEvent,
  type LookalikeFeedbackVerdict,
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
  const [sent, setSent] = useState<LookalikeFeedbackVerdict | null>(null);
  const [picking, setPicking] = useState(false);
  const probeHash = useMemo(
    () => hashProbeKey(previewUrl || topMatch.celebrityId),
    [previewUrl, topMatch.celebrityId],
  );
  const copy = lookalikeFeedbackCopy(topMatch.verdict);

  if (sent) {
    return (
      <p className="rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3.5 py-3 text-center text-xs text-fg-muted">
        {lookalikeFeedbackThanks(topMatch.verdict, sent)}
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3.5 py-3">
      <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-subtle">
        {copy.prompt}
      </p>
      <div className="flex flex-wrap gap-2">
        {copy.fairNearestLabel && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              saveLookalikeFeedbackEvent({
                probeHash,
                shownId: topMatch.celebrityId,
                shownPercent: topMatch.matchPercent,
                verdict: "fair_nearest",
                engineVersion,
              });
              setSent("fair_nearest");
              setPicking(false);
            }}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            {copy.fairNearestLabel}
          </Button>
        )}
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
          {copy.negativeLabel}
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
