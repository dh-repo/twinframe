import { useState, useRef, useEffect, useCallback } from "react";
import { X, Download, Share2, Sparkles, Check, ScanFace } from "lucide-react";
import type { CelebrityMatch } from "@/lib/face/types";
import { Button } from "@/components/ui/button";
import { CelebrityPortrait } from "@/components/celebrity-portrait";
import { useLockBodyScroll } from "@/lib/ux/lock-body-scroll";
import { honestyBand, honestyShareLabel, shareText } from "@/lib/ux/honesty";

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
  const cardRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const handleDownload = useCallback(async () => {
    if (!cardRef.current) return;
    setDownloading(true);

    try {
      // Use Canvas to render high-res share card
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = 1080;
      const height = 1080;
      canvas.width = width;
      canvas.height = height;

      // Background Gradient
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, "#0e1017");
      grad.addColorStop(1, "#07080b");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Header Branding
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 38px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("TWINFRAME", width / 2, 90);

      ctx.fillStyle = "#818cf8";
      ctx.font = "600 22px monospace";
      const band = honestyBand(
        topMatch.matchPercent,
        topMatch.rankMargin,
        topMatch.attributeConflict,
      );
      ctx.fillText(honestyShareLabel(band).toUpperCase(), width / 2, 130);

      // Load Images
      const loadImg = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });

      const userImgPromise = userPhotoUrl ? loadImg(userPhotoUrl).catch(() => null) : Promise.resolve(null);
      const celebSrc = topMatch.photoUrl192 || topMatch.photoUrl || topMatch.fallbackPhotoUrl || "";
      const celebImgPromise = celebSrc ? loadImg(celebSrc).catch(() => null) : Promise.resolve(null);

      const [userImg, celebImg] = await Promise.all([userImgPromise, celebImgPromise]);

      const photoSize = 360;
      const photoY = 220;

      // Draw User Photo
      const userX = width / 2 - photoSize - 30;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(userX, photoY, photoSize, photoSize, 36);
      ctx.clip();
      if (userImg) {
        ctx.drawImage(userImg, userX, photoY, photoSize, photoSize);
      } else {
        ctx.fillStyle = "#1e2235";
        ctx.fillRect(userX, photoY, photoSize, photoSize);
      }
      ctx.restore();

      // Draw Celeb Photo
      const celebX = width / 2 + 30;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(celebX, photoY, photoSize, photoSize, 36);
      ctx.clip();
      if (celebImg) {
        ctx.drawImage(celebImg, celebX, photoY, photoSize, photoSize);
      } else {
        ctx.fillStyle = "#1e2235";
        ctx.fillRect(celebX, photoY, photoSize, photoSize);
      }
      ctx.restore();

      // Connector Badge
      ctx.beginPath();
      ctx.arc(width / 2, photoY + photoSize / 2, 45, 0, Math.PI * 2);
      ctx.fillStyle = "#090a0f";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#818cf8";
      ctx.stroke();

      ctx.fillStyle = "#818cf8";
      ctx.font = "bold 36px sans-serif";
      ctx.fillText("≈", width / 2, photoY + photoSize / 2 + 12);

      // Match Score Banner
      ctx.fillStyle = "#818cf8";
      ctx.font = "bold 96px sans-serif";
      ctx.fillText(`${topMatch.matchPercent}%`, width / 2, 690);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 44px sans-serif";
      ctx.fillText(topMatch.name, width / 2, 760);

      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.font = "400 28px sans-serif";
      ctx.fillText(topMatch.knownFor, width / 2, 810);

      // Footer
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "500 20px monospace";
      ctx.fillText("MATCHED WITH ON-DEVICE EDGEFACE-M 256-D BIOMETRICS", width / 2, 980);

      const filename = `twinframe-${topMatch.name.toLowerCase().replace(/\s+/g, "-")}-match.png`;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Could not create share image");
      const file = new File([blob], filename, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      const sharePayload: ShareData = {
        files: [file],
        title: "My Twinframe match",
        text: shareText(
          topMatch.name,
          topMatch.matchPercent,
          topMatch.rankMargin,
          topMatch.attributeConflict,
        ),
      };
      if (typeof nav.share === "function" && nav.canShare?.(sharePayload)) {
        await nav.share(sharePayload);
        return;
      }
      const link = document.createElement("a");
      link.download = filename;
      link.href = URL.createObjectURL(blob);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    } catch (err) {
      console.error("Failed to generate share card", err);
    } finally {
      setDownloading(false);
    }
  }, [topMatch, userPhotoUrl]);

  const handleShare = async () => {
    const shareData = {
      title: "My Twinframe Celebrity Match",
      text: shareText(
        topMatch.name,
        topMatch.matchPercent,
        topMatch.rankMargin,
        topMatch.attributeConflict,
      ),
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // Ignored if cancelled
      }
    } else {
      await navigator.clipboard.writeText(
        `${shareText(topMatch.name, topMatch.matchPercent, topMatch.rankMargin, topMatch.attributeConflict)} Find your twin at ${window.location.href}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold tracking-tight text-white">
              Share Your Match
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

        {/* Card Preview Preview */}
        <div className="p-6">
          <div
            ref={cardRef}
            className="relative overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-b from-[#181a27] to-[#0d0e17] p-5 text-center shadow-xl"
          >
            <div className="flex items-center justify-center gap-2 mb-4">
              <ScanFace className="h-4 w-4 text-indigo-400" />
              <span className="text-xs font-mono font-bold tracking-widest text-indigo-300 uppercase">
                TWINFRAME MATCH
              </span>
            </div>

            <div className="flex items-center justify-center gap-3">
              {/* User Avatar */}
              <div className="h-24 w-24 overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-md">
                {userPhotoUrl ? (
                  <img src={userPhotoUrl} alt="You" className="h-full w-full object-cover object-top" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-white/50">You</div>
                )}
              </div>

              {/* Match Icon */}
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/10 text-xs font-bold text-indigo-400">
                ≈
              </div>

              {/* Celeb Avatar */}
              <div className="h-24 w-24 overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-md">
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
              </div>
            </div>

            <div className="mt-4">
              <div className="text-3xl font-extrabold text-indigo-400 tabular-nums">
                {topMatch.matchPercent}%
              </div>
              <p className="text-base font-bold text-white truncate mt-0.5">{topMatch.name}</p>
              <p className="text-xs text-white/60 truncate">{topMatch.knownFor}</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 border-t border-white/10 bg-white/[0.02] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button
            variant="secondary"
            size="md"
            onClick={handleShare}
            className="flex-1 gap-2"
          >
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
