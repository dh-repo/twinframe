import { useCallback, useEffect, useState } from "react";
import { Check, Download, Share2, Sparkles, X } from "lucide-react";
import type { CelebrityMatch } from "@/lib/face/types";
import { verdictLabel } from "@/lib/face/verdict";
import { Button } from "@/components/ui/button";
import { CelebrityPortrait } from "@/components/celebrity-portrait";
import { useLockBodyScroll } from "@/lib/ux/lock-body-scroll";
import {
  closerTwin,
  closerTwinLabel,
  closerTwinStamp,
  type CloserTwinWinner,
} from "@/lib/ux/closer-twin";
import { resolveShareVerdict } from "@/lib/ux/share-copy";
import {
  copyShareText,
  shareOrDownload,
  verdictStampStyle,
} from "@/lib/ux/share-image";
import {
  composePairShareImage,
  pairShareFilename,
  pairShareText,
  type PairShareSide,
} from "@/lib/ux/pair-share-image";

export interface FriendSharePerson {
  previewUrl: string | null;
  match: CelebrityMatch;
}

export interface FriendShareModalProps {
  open: boolean;
  onClose: () => void;
  you: FriendSharePerson;
  friend: FriendSharePerson;
}

function sideFromPerson(person: FriendSharePerson, label: string): PairShareSide {
  const match = person.match;
  return {
    label,
    youUrl: person.previewUrl,
    celebrityName: match.name,
    celebrityPhotoUrl: match.photoUrl192 || match.photoUrl || match.fallbackPhotoUrl || null,
    matchPercent: match.matchPercent,
    verdict: match.verdict,
    adjustedDistance: match.adjustedDistance,
    rankMargin: match.rankMargin,
    blurb: match.blurb,
  };
}

function winnerBanner(winner: CloserTwinWinner): string {
  switch (winner) {
    case "a":
      return closerTwinLabel("a");
    case "b":
      return closerTwinLabel("b");
    case "tie":
      return closerTwinLabel("tie");
    default: {
      const _exhaustive: never = winner;
      return _exhaustive;
    }
  }
}

export function FriendShareModal({
  open,
  onClose,
  you,
  friend,
}: FriendShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  useLockBodyScroll(open);

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
  const youVerdict = resolveShareVerdict(you.match);
  const friendVerdict = resolveShareVerdict(friend.match);
  const stamp = verdictStampStyle(winner === "b" ? friendVerdict : youVerdict);
  const text = pairShareText({
    winner,
    aName: you.match.name,
    bName: friend.match.name,
    aPercent: you.match.matchPercent,
    bPercent: friend.match.matchPercent,
  });

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await composePairShareImage({
        you: sideFromPerson(you, "You"),
        friend: sideFromPerson(friend, "Friend"),
      });
      await shareOrDownload({
        blob,
        filename: pairShareFilename(),
        title: "Our Twinframe closer twin",
        text,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to generate pair share card", err);
    } finally {
      setDownloading(false);
    }
  }, [friend, text, you]);

  const handleShare = async () => {
    const shareData = {
      title: "Our Twinframe closer twin",
      text,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // Ignored if cancelled
      }
    } else {
      const ok = await copyShareText(`${text} Find your twin at ${window.location.href}`);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6 animate-fade-up">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-white/15 bg-[#121420]/95 text-white shadow-2xl backdrop-blur-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold tracking-tight text-white">
              Share your closer twin
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close pair share card"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          <div
            className="relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-b from-[#0e1017] to-[#07080b] px-4 py-4 text-center shadow-xl"
            style={{ boxShadow: `inset 0 0 80px ${stamp.glow}` }}
          >
            <p className="text-[11px] font-bold tracking-[0.28em] text-white">TWINFRAME</p>
            <p className="mt-1 text-[10px] font-semibold tracking-[0.18em] text-white/50">
              YOU  VS  FRIEND
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <PairPreview
                person={you}
                tag="YOU"
                highlight={winner === "a"}
                accent={verdictStampStyle(youVerdict).fill}
              />
              <PairPreview
                person={friend}
                tag="FRIEND"
                highlight={winner === "b"}
                accent={verdictStampStyle(friendVerdict).fill}
              />
            </div>

            <div
              className="mx-auto mt-4 inline-block -rotate-[6deg] rounded-md border-[3px] px-3 py-1 text-[11px] font-black uppercase tracking-widest"
              style={{
                color: stamp.fill,
                borderColor: stamp.fill,
                background: stamp.wash,
              }}
            >
              {closerTwinStamp(winner)}
            </div>

            <p className="mt-4 text-xs leading-snug text-white/70">{winnerBanner(winner)}</p>
            <p className="mt-2 font-mono text-[8px] tracking-wider text-white/45">
              MATCHED WITH ON-DEVICE EDGEFACE 512-D BIOMETRICS
            </p>
          </div>
        </div>

        <div className="flex gap-3 border-t border-white/10 bg-white/[0.02] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button variant="secondary" size="md" onClick={handleShare} className="flex-1 gap-2">
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
            <span>{copied ? "Link Copied!" : "Share Link"}</span>
          </Button>

          <Button
            variant="primary"
            size="md"
            onClick={handleDownload}
            disabled={downloading}
            className="flex-1 gap-2"
          >
            <Download className="h-4 w-4" />
            <span>{downloading ? "Saving..." : "Save Image"}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function PairPreview({
  person,
  tag,
  highlight,
  accent,
}: {
  person: FriendSharePerson;
  tag: string;
  highlight: boolean;
  accent: string;
}) {
  const match = person.match;
  const verdict = resolveShareVerdict(match);
  const first = match.name.split(" ")[0] ?? match.name;

  return (
    <div className="space-y-2">
      <div className="flex justify-center gap-1.5">
        <div
          className="relative h-16 w-16 overflow-hidden rounded-xl border bg-black/40"
          style={{ borderColor: highlight ? accent : "rgba(255,255,255,0.2)" }}
        >
          {person.previewUrl ? (
            <img src={person.previewUrl} alt={tag} className="h-full w-full object-cover object-top" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[9px] text-white/50">
              {tag}
            </div>
          )}
        </div>
        <div
          className="relative h-16 w-16 overflow-hidden rounded-xl border bg-black/40"
          style={{ borderColor: highlight ? accent : "rgba(255,255,255,0.2)" }}
        >
          <CelebrityPortrait
            initials={match.initials}
            accentHue={match.accentHue}
            photoUrl={match.photoUrl}
            photoUrl192={match.photoUrl192}
            fallbackUrl={match.fallbackPhotoUrl}
            size="md"
            alt={match.name}
            className="h-full w-full rounded-none"
          />
        </div>
      </div>
      <p className="text-lg font-extrabold tabular-nums leading-none" style={{ color: accent }}>
        {Math.round(match.matchPercent)}%
      </p>
      <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: accent }}>
        {verdictLabel(verdict)}
      </p>
      <p className="truncate text-[10px] font-semibold text-white/80">{first}</p>
    </div>
  );
}
