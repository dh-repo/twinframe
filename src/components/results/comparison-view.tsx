import { useState, useRef, useCallback } from "react";
import { CelebrityPortrait } from "@/components/celebrity-portrait";
import { cn } from "@/lib/utils/cn";
import { Sliders, Columns, Sparkles } from "lucide-react";
import type { TraitInsight } from "@/lib/face/types";

export type ComparisonMode = "side-by-side" | "split-slider" | "landmarks";

export interface ComparisonViewProps {
  userPhotoUrl: string | null;
  celebrityPhotoUrl?: string | null;
  celebrityPhoto192Url?: string | null;
  celebrityFallbackUrl?: string | null;
  celebrityName: string;
  celebrityInitials: string;
  accentHue?: number;
  traits?: TraitInsight[];
  className?: string;
}

export function ComparisonView({
  userPhotoUrl,
  celebrityPhotoUrl,
  celebrityPhoto192Url,
  celebrityFallbackUrl,
  celebrityName,
  celebrityInitials,
  accentHue = 180,
  traits = [],
  className,
}: ComparisonViewProps) {
  const [mode, setMode] = useState<ComparisonMode>("side-by-side");
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPos(percentage);
    },
    []
  );

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleMove(e.clientX);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      handleMove(e.clientX);
    }
  };

  const onMouseUp = () => {
    setIsDragging(false);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches[0]) {
      handleMove(e.touches[0].clientX);
    }
  };

  const photoUrl = celebrityPhotoUrl ?? undefined;
  const photoUrl192 = celebrityPhoto192Url ?? undefined;
  const fallbackUrl = celebrityFallbackUrl ?? undefined;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Mode Switcher Tabs */}
      <div className="flex items-center justify-center w-full overflow-x-auto no-scrollbar">
        <div className="inline-flex rounded-lg border border-border bg-bg-subtle p-1 max-w-full overflow-x-auto no-scrollbar" role="tablist" aria-label="Comparison modes">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "side-by-side"}
            onClick={() => setMode("side-by-side")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-2 text-xs font-medium transition-all shrink-0 touch-target-min",
              mode === "side-by-side"
                ? "bg-bg-elevated text-fg shadow-sm font-semibold"
                : "text-fg-subtle hover:text-fg-muted"
            )}
          >
            <Columns className="h-3.5 w-3.5" />
            <span>Side-by-Side</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "split-slider"}
            onClick={() => setMode("split-slider")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-2 text-xs font-medium transition-all shrink-0 touch-target-min",
              mode === "split-slider"
                ? "bg-bg-elevated text-fg shadow-sm font-semibold"
                : "text-fg-subtle hover:text-fg-muted"
            )}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Split Slider</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "landmarks"}
            onClick={() => setMode("landmarks")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-2 text-xs font-medium transition-all shrink-0 touch-target-min",
              mode === "landmarks"
                ? "bg-bg-elevated text-fg shadow-sm font-semibold"
                : "text-fg-subtle hover:text-fg-muted"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Landmarks</span>
          </button>
        </div>
      </div>

      {/* MODE 1: Side-by-Side View */}
      {mode === "side-by-side" && (
        <div className="flex items-center justify-center gap-3 sm:gap-6 px-2 py-2">
          {/* User Face Card */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative h-28 w-28 sm:h-36 sm:w-36 overflow-hidden rounded-2xl border border-border bg-bg-subtle shadow-md">
              {userPhotoUrl ? (
                <img
                  src={userPhotoUrl}
                  alt="Your face"
                  className="h-full w-full object-cover object-top"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-fg-subtle">
                  You
                </div>
              )}
              <span className="absolute bottom-1.5 left-1.5 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted backdrop-blur-sm">
                YOU
              </span>
            </div>
          </div>

          {/* Glowing Match Connector Badge */}
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-match/40 bg-bg text-sm font-semibold text-match shadow-[0_0_12px_color-mix(in_oklab,var(--color-match)_30%,transparent)]"
            aria-hidden
          >
            ≈
          </div>

          {/* Celebrity Portrait Card */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative h-28 w-28 sm:h-36 sm:w-36 overflow-hidden rounded-2xl border border-border bg-bg-subtle shadow-md">
              <CelebrityPortrait
                initials={celebrityInitials}
                accentHue={accentHue}
                photoUrl={photoUrl}
                photoUrl192={photoUrl192}
                fallbackUrl={fallbackUrl}
                size="xl"
                alt={celebrityName}
                className="h-full w-full rounded-none"
              />
              <span className="absolute bottom-1.5 right-1.5 max-w-[80%] truncate rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted backdrop-blur-sm">
                {celebrityName.split(" ")[0]}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: Interactive Split Slider View */}
      {mode === "split-slider" && (
        <div className="space-y-2">
          <div
            ref={containerRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={(e) => {
              setIsDragging(true);
              if (e.touches[0]) handleMove(e.touches[0].clientX);
            }}
            onTouchMove={onTouchMove}
            onTouchEnd={() => setIsDragging(false)}
            className="relative aspect-[4/3] w-full max-w-md mx-auto overflow-hidden rounded-2xl border border-match/30 bg-bg-subtle select-none touch-none cursor-ew-resize shadow-lg"
          >
            {/* Background Layer: Celebrity Face */}
            <div className="absolute inset-0 h-full w-full">
              <CelebrityPortrait
                initials={celebrityInitials}
                accentHue={accentHue}
                photoUrl={photoUrl}
                photoUrl192={photoUrl192}
                fallbackUrl={fallbackUrl}
                size="xl"
                alt={celebrityName}
                className="h-full w-full rounded-none"
              />
              <span className="absolute bottom-2 right-2 rounded bg-bg/85 px-2 py-0.5 text-[11px] font-mono font-medium text-fg-muted backdrop-blur-md z-10">
                {celebrityName}
              </span>
            </div>

            {/* Foreground Layer: User Face (Clipped) */}
            <div
              className="absolute inset-0 h-full w-full z-10 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              {userPhotoUrl ? (
                <img
                  src={userPhotoUrl}
                  alt="Your face"
                  className="h-full w-full object-cover object-top"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-bg-subtle text-xs text-fg-subtle">
                  Your Face
                </div>
              )}
              <span className="absolute bottom-2 left-2 rounded bg-bg/85 px-2 py-0.5 text-[11px] font-mono font-medium text-match backdrop-blur-md z-10">
                YOU
              </span>
            </div>

            {/* Central Draggable Divider Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-match shadow-[0_0_12px_var(--color-match)] z-20 -translate-x-1/2 pointer-events-none"
              style={{ left: `${sliderPos}%` }}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full border-2 border-match bg-bg shadow-xl flex items-center justify-center text-match">
                <span className="text-[10px] font-bold">◄ ►</span>
              </div>
            </div>
          </div>
          <p className="text-center text-[11px] text-fg-subtle">
            Drag slider left or right to morph between faces
          </p>
        </div>
      )}

      {/* MODE 3: Landmark Alignment View */}
      {mode === "landmarks" && (
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-3 sm:gap-6">
            {/* User Face with Landmark Nodes */}
            <div className="relative h-28 w-28 sm:h-36 sm:w-36 overflow-hidden rounded-2xl border border-match/40 bg-bg-subtle shadow-md">
              {userPhotoUrl ? (
                <img src={userPhotoUrl} alt="Your face landmarks" className="h-full w-full object-cover object-top filter brightness-95" />
              ) : (
                <div className="h-full w-full bg-bg-subtle" />
              )}
              {/* Feature Points Overlay */}
              <div className="absolute inset-0 pointer-events-none z-10">
                <div className="absolute top-[38%] left-[36%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)]" />
                <div className="absolute top-[38%] left-[64%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)]" />
                <div className="absolute top-[52%] left-[50%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)]" />
                <div className="absolute top-[68%] left-[50%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)]" />
              </div>
              <span className="absolute bottom-1.5 left-1.5 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-match backdrop-blur-sm">
                YOU_MESH
              </span>
            </div>

            <div className="text-xs font-mono font-bold text-match animate-pulse-soft">
              MATCH_VECTOR ➔
            </div>

            {/* Celebrity Face with Landmark Nodes */}
            <div className="relative h-28 w-28 sm:h-36 sm:w-36 overflow-hidden rounded-2xl border border-match/40 bg-bg-subtle shadow-md">
              <CelebrityPortrait
                initials={celebrityInitials}
                accentHue={accentHue}
                photoUrl={photoUrl}
                photoUrl192={photoUrl192}
                fallbackUrl={fallbackUrl}
                size="xl"
                alt={celebrityName}
                className="h-full w-full rounded-none filter brightness-95"
              />
              <div className="absolute inset-0 pointer-events-none z-10">
                <div className="absolute top-[38%] left-[36%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)]" />
                <div className="absolute top-[38%] left-[64%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)]" />
                <div className="absolute top-[52%] left-[50%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)]" />
                <div className="absolute top-[68%] left-[50%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)]" />
              </div>
              <span className="absolute bottom-1.5 right-1.5 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] font-mono text-match backdrop-blur-sm">
                STAR_MESH
              </span>
            </div>
          </div>

          {/* Trait Feature Callout Badges */}
          {traits.length > 0 && (
            <div className="grid grid-cols-2 gap-2 max-w-md mx-auto pt-1">
              {traits.map((t) => (
                <div key={t.trait} className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs">
                  <span className="text-fg-muted font-medium truncate">{t.label}</span>
                  <span className="font-mono text-match font-semibold ml-2">
                    {Math.round(t.similarity * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
