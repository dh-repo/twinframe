import { useState, useEffect, useCallback } from "react";
import { X, Download, Share2, Sparkles, Check } from "lucide-react";
import type { CelebrityMatch } from "@/lib/face/types";
import { verdictLabel } from "@/lib/face/verdict";
import { Button } from "@/components/ui/button";
import { CelebrityPortrait } from "@/components/celebrity-portrait";
import { useLockBodyScroll } from "@/lib/ux/lock-body-scroll";
import {
  shareCardBlurb,
  shareCardFilename,
  shareHeroCaption,
  shareModalTitle,
  sharePairGlyph,
  sharePercentCaption,
  shareTextFromMatch,
  resolveShareVerdict,
} from "@/lib/ux/share-copy";
import { scoreDisplay } from "@/lib/ux/score-display";
import {
  composeShareImage,
  copyShareText,
  shareOrDownload,
  verdictStampStyle,
} from "@/lib/ux/share-image";

export interface ShareCardModalProps {
  open: boolean;
  onClose: () => void;
  topMatch: CelebrityMatch;
  userPhotoUrl: string | null;
}

export function ShareCardModal({
  open,
  onClose,
  topMatch,
  userPhotoUrl,
}: ShareCardModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  useLockBodyScroll(open);

  const verdict = resolveShareVerdict(topMatch);
  const stamp = verdictStampStyle(verdict);
  const scores = scoreDisplay({ ...topMatch, verdict });
  const blurb = shareCardBlurb(topMatch.blurb, verdict);
  const text = shareTextFromMatch(topMatch);
  const celebSrc =
    topMatch.photoUrl192 || topMatch.photoUrl || topMatch.fallbackPhotoUrl || null;
  const celebFirst = topMatch.name.split(" ")[0] ?? topMatch.name;

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await composeShareImage({
        youUrl: userPhotoUrl,
        celebrityName: topMatch.name,
        celebrityPhotoUrl: celebSrc,
        matchPercent: topMatch.matchPercent,
        verdict,
        blurb: topMatch.blurb,
        adjustedDistance: topMatch.adjustedDistance,
        rankMargin: topMatch.rankMargin,
        probabilityCorrect: topMatch.probabilityCorrect,
      });
      const filename = shareCardFilename(topMatch.name);
      await shareOrDownload({
        blob,
        filename,
        title: "My Twinframe match",
        text,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to generate share card", err);
    } finally {
      setDownloading(false);
    }
  }, [celebSrc, text, topMatch, userPhotoUrl, verdict]);

  const handleShare = async () => {
    const shareData = {
      title: "My Twinframe Celebrity Match",
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
              {shareModalTitle(verdict)}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close share card"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          <div
            className="relative aspect-square overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-b from-[#0e1017] to-[#07080b] px-4 py-3 text-center shadow-xl"
            style={{ boxShadow: `inset 0 0 80px ${stamp.glow}` }}
          >
            <p className="text-[11px] font-bold tracking-[0.28em] text-white">TWINFRAME</p>

            <div className="mt-3 flex items-center justify-center gap-3">
              <div className="relative h-24 w-24 overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-md">
                {userPhotoUrl ? (
                  <img
                    src={userPhotoUrl}
                    alt="You"
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-white/50">
                    You
                  </div>
                )}
                <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-white/70">
                  YOU
                </span>
              </div>

              <div
                className={
                  sharePairGlyph(verdict).length > 1
                    ? "flex h-8 w-8 items-center justify-center rounded-full border-2 bg-[#090a0f] text-[8px] font-extrabold tracking-wide"
                    : "flex h-8 w-8 items-center justify-center rounded-full border-2 bg-[#090a0f] text-xs font-bold"
                }
                style={{ borderColor: stamp.fill, color: stamp.fill }}
              >
                {sharePairGlyph(verdict)}
              </div>

              <div className="relative h-24 w-24 overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-md">
                <CelebrityPortrait
                  initials={topMatch.initials}
                  accentHue={topMatch.accentHue}
                  photoUrl={topMatch.photoUrl}
                  photoUrl192={topMatch.photoUrl192}
                  fallbackUrl={topMatch.fallbackPhotoUrl}
                  size="lg"
                  alt={topMatch.name}
                  className="h-full w-full rounded-none"
                />
                <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-white/70">
                  {celebFirst.toUpperCase()}
                </span>
              </div>
            </div>

            {scores.heroPercent != null ? (
              <>
                <p
                  className="mt-3 text-5xl font-extrabold tabular-nums leading-none"
                  style={{ color: stamp.fill }}
                >
                  {scores.heroPercent}%
                </p>
                <p className="mt-1 text-[10px] font-mono font-semibold uppercase tracking-[0.18em] text-white/45">
                  {shareHeroCaption(verdict, true)}
                </p>
              </>
            ) : (
              <p className="mt-3 text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-white/55">
                {shareHeroCaption(verdict, false)}
              </p>
            )}
            <p className="mt-1 text-[10px] font-mono tabular-nums text-white/45">
              {Math.round(scores.similarityPercent)}% {sharePercentCaption(verdict)}
            </p>

            <div
              className="mx-auto mt-3 inline-block -rotate-[7deg] rounded-md border-[3px] px-3 py-1 text-[11px] font-black uppercase tracking-widest"
              style={{
                color: stamp.fill,
                borderColor: stamp.fill,
                background: stamp.wash,
              }}
            >
              {verdictLabel(verdict)}
            </div>

            <p className="mt-3 line-clamp-1 text-[11px] leading-snug text-white/70">{blurb}</p>
            <p className="mt-1 truncate text-sm font-bold text-white">{topMatch.name}</p>
            <p className="mt-2 font-mono text-[8px] tracking-wider text-white/45">
              MATCHED ON-DEVICE WITH ADAFACE IR-101 512-D
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
