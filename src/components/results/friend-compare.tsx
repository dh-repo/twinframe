import { useState } from "react";
import { RotateCcw, Share2, Users } from "lucide-react";
import type { CelebrityMatch } from "@/lib/face/types";
import { verdictLabel } from "@/lib/face/verdict";
import { CelebrityPortrait } from "@/components/celebrity-portrait";
import { FriendShareModal } from "@/components/results/friend-share-modal";
import { Button } from "@/components/ui/button";
import { NumberCounter } from "@/components/ui/number-counter";
import { cn } from "@/lib/utils/cn";
import {
  closerTwin,
  closerTwinLabel,
  closerTwinStamp,
  type CloserTwinWinner,
} from "@/lib/ux/closer-twin";
import { resolveShareVerdict } from "@/lib/ux/share-copy";
import { verdictStampStyle } from "@/lib/ux/share-image";

export interface FriendComparePerson {
  previewUrl: string | null;
  match: CelebrityMatch;
}

export interface FriendCompareProps {
  you: FriendComparePerson;
  friend: FriendComparePerson;
  onStartOver: () => void;
}

function winnerRing(winner: CloserTwinWinner, side: "a" | "b"): boolean {
  switch (winner) {
    case "a":
      return side === "a";
    case "b":
      return side === "b";
    case "tie":
      return true;
    default: {
      const _exhaustive: never = winner;
      return _exhaustive;
    }
  }
}

function closerBadge(winner: CloserTwinWinner, side: "a" | "b"): string | null {
  switch (winner) {
    case "a":
      return side === "a" ? "Closer" : null;
    case "b":
      return side === "b" ? "Closer" : null;
    case "tie":
      return "Tied";
    default: {
      const _exhaustive: never = winner;
      return _exhaustive;
    }
  }
}

export function FriendCompare({ you, friend, onStartOver }: FriendCompareProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const winner = closerTwin(
    {
      adjustedDistance: you.match.adjustedDistance,
      matchPercent: you.match.matchPercent,
    },
    {
      adjustedDistance: friend.match.adjustedDistance,
      matchPercent: friend.match.matchPercent,
    },
  );
  const stampVerdict = resolveShareVerdict(winner === "b" ? friend.match : you.match);
  const stamp = verdictStampStyle(stampVerdict);

  return (
    <section className="animate-fade-up space-y-5">
      <div
        className="overflow-hidden rounded-[var(--radius-xl)] border border-white/15 bg-gradient-to-b from-white/[0.05] to-white/[0.02] px-4 py-5 text-center sm:px-6"
        style={{ boxShadow: `inset 0 0 80px ${stamp.glow}` }}
      >
        <div className="mb-3 flex items-center justify-center gap-2 text-[11px] font-mono font-semibold uppercase tracking-[0.16em] text-white/50">
          <Users className="h-3.5 w-3.5" />
          Friend mode
        </div>
        <div
          className="mx-auto inline-block -rotate-[6deg] rounded-md border-[3px] px-3.5 py-1.5 text-xs font-black uppercase tracking-widest sm:text-sm"
          style={{
            color: stamp.fill,
            borderColor: stamp.fill,
            background: stamp.wash,
          }}
        >
          {closerTwinStamp(winner)}
        </div>
        <p className="mt-4 text-sm font-medium text-white">{closerTwinLabel(winner)}</p>
        <p className="mt-1 text-xs text-white/55">
          Lower face distance wins — percent breaks a tie.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PersonCard person={you} label="You" highlighted={winnerRing(winner, "a")} badge={closerBadge(winner, "a")} />
        <PersonCard person={friend} label="Friend" highlighted={winnerRing(winner, "b")} badge={closerBadge(winner, "b")} />
      </div>

      <Button
        variant="primary"
        size="lg"
        onClick={() => setShareOpen(true)}
        className="w-full"
      >
        <Share2 className="h-4 w-4" />
        Share pair card
      </Button>

      <Button variant="secondary" size="lg" onClick={onStartOver} className="w-full">
        <RotateCcw className="h-4 w-4" />
        Start over
      </Button>

      <FriendShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        you={you}
        friend={friend}
      />
    </section>
  );
}

function PersonCard({
  person,
  label,
  highlighted,
  badge,
}: {
  person: FriendComparePerson;
  label: string;
  highlighted: boolean;
  badge: string | null;
}) {
  const match = person.match;
  const verdict = resolveShareVerdict(match);
  const style = verdictStampStyle(verdict);
  const first = match.name.split(" ")[0] ?? match.name;

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white/[0.03] p-4",
        highlighted ? "border-white/30 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" : "border-white/10",
      )}
      style={highlighted ? { boxShadow: `0 0 32px ${style.glow}` } : undefined}
      data-friend-card={label}
      data-match-percent={Math.round(match.matchPercent)}
      data-verdict={match.verdict ?? ""}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-white/50">
          {label}
        </p>
        {badge ? (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: style.fill, background: style.wash }}
          >
            {badge}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-2">
        <div
          className="relative h-[5.5rem] w-[5.5rem] overflow-hidden rounded-2xl border bg-black/40"
          style={{ borderColor: highlighted ? style.fill : "rgba(255,255,255,0.18)" }}
        >
          {person.previewUrl ? (
            <img
              src={person.previewUrl}
              alt={label}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-white/50">
              {label}
            </div>
          )}
        </div>
        <div
          className="relative h-[5.5rem] w-[5.5rem] overflow-hidden rounded-2xl border bg-black/40"
          style={{ borderColor: highlighted ? style.fill : "rgba(255,255,255,0.18)" }}
        >
          <CelebrityPortrait
            initials={match.initials}
            accentHue={match.accentHue}
            photoUrl={match.photoUrl}
            photoUrl192={match.photoUrl192}
            fallbackUrl={match.fallbackPhotoUrl}
            size="lg"
            alt={match.name}
            className="h-full w-full rounded-none"
          />
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-white/70">
            {first.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="mt-3 text-center">
        <div className="flex items-baseline justify-center gap-0.5" style={{ color: style.fill }}>
          <NumberCounter
            value={match.matchPercent}
            duration={1200}
            decimals={0}
            className="text-3xl font-extrabold tabular-nums leading-none"
          />
          <span className="text-lg font-bold">%</span>
        </div>
        <p
          className="mt-2 text-[11px] font-black uppercase tracking-[0.14em]"
          style={{ color: style.fill }}
        >
          {verdictLabel(verdict)}
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-white">{match.name}</p>
        {match.blurb ? (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/55">{match.blurb}</p>
        ) : null}
      </div>
    </article>
  );
}
