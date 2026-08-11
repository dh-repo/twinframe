import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, ZoomIn, Move } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CropReviewProps {
  imageSrc: string;
  fileName?: string;
  onApprove: (blob: Blob) => void;
  onRetake: () => void;
}

export function CropReview({ imageSrc, fileName, onApprove, onRetake }: CropReviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [isApproving, setIsApproving] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, [imageSrc]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    },
    [offset],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const max = 60 * scale;
      setOffset({
        x: Math.max(-max, Math.min(max, dragStart.current.ox + dx)),
        y: Math.max(-max, Math.min(max, dragStart.current.oy + dy)),
      });
    },
    [dragging, scale],
  );
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  const handleApprove = useCallback(async () => {
    if (isApproving) return;
    setIsApproving(true);
    try {
      const img = imgRef.current;
      if (!img) throw new Error("Image not ready");
      const size = 1024;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unsupported");

      // Crop square is 260px in 320 container => scale factor
      // We render the image centered with pan+zoom, then crop the center square
      const containerSize = 320;
      const cropSize = 260;
      // Draw image covering container, then extract crop
      // Simpler: create a temp canvas representing the container view, then crop

      // Compute image draw in container coordinates
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const baseScale = Math.max(containerSize / iw, containerSize / ih);
      const drawScale = baseScale * scale;
      const drawW = iw * drawScale;
      const drawH = ih * drawScale;
      const cx = containerSize / 2 + offset.x;
      const cy = containerSize / 2 + offset.y;

      // Use an offscreen container canvas to replicate what user sees
      const view = document.createElement("canvas");
      view.width = containerSize;
      view.height = containerSize;
      const vctx = view.getContext("2d");
      if (!vctx) throw new Error("Canvas unsupported");
      vctx.fillStyle = "#0a0a0b";
      vctx.fillRect(0, 0, containerSize, containerSize);
      vctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);

      // Crop center square -> final
      const sx = (containerSize - cropSize) / 2;
      const sy = (containerSize - cropSize) / 2;
      ctx.drawImage(view, sx, sy, cropSize, cropSize, 0, 0, size, size);

      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", 0.88),
      );
      if (!blob) throw new Error("Could not create image");
      onApprove(blob);
    } catch (e) {
      console.error(e);
      setIsApproving(false);
    }
  }, [imageSrc, offset, scale, onApprove, isApproving]);

  const qualityHint = (() => {
    if (!imageSize.w) return null;
    const mp = (imageSize.w * imageSize.h) / 1e6;
    if (mp < 0.15) return { tone: "warn" as const, text: "Low resolution — a larger photo gives sharper matches." };
    if (mp > 12) return { tone: "warn" as const, text: "Very large photo — we'll scale it down automatically." };
    return null;
  })();

  return (
    <section className="animate-fade-up space-y-4">
      <div className="rounded-[var(--radius-xl)] border border-border bg-bg-elevated overflow-hidden">
        <div className="px-5 pt-5 sm:px-6">
          <h2 className="text-base font-medium tracking-tight">Adjust your photo</h2>
          <p className="mt-1 text-sm text-fg-muted text-pretty">
            Drag to re-center, pinch or slider to zoom. The square is what we'll match.
          </p>
          {fileName && (
            <p className="mt-1 truncate text-xs text-fg-subtle tabular-nums">{fileName} • {imageSize.w}×{imageSize.h}</p>
          )}
        </div>

        <div className="px-5 py-5 sm:px-6">
          {/* Hidden img for canvas ref (naturalWidth) */}
          <img ref={imgRef} src={imageSrc} alt="" className="hidden" aria-hidden />
          <div
            ref={containerRef}
            className="relative mx-auto h-[320px] w-[320px] max-w-full overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-subtle touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{ cursor: dragging ? "grabbing" : "grab" }}
          >
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${imageSrc})`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: `calc(50% + ${offset.x}px) calc(50% + ${offset.y}px)`,
                backgroundSize: (() => {
                  if (!imageSize.w) return "cover";
                  const base = Math.max(320 / imageSize.w, 320 / imageSize.h);
                  const s = base * scale;
                  return `${imageSize.w * s}px ${imageSize.h * s}px`;
                })(),
              }}
            />

            {/* Overlay outside crop */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[color-mix(in_oklab,#000_55%,transparent)]" />
              {/* Crop square */}
              <div className="absolute left-1/2 top-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border-2 border-white/90 shadow-[0_0_0_9999px_color-mix(in_oklab,#000_55%,transparent),0_8px_30px_color-mix(in_oklab,#000_60%,transparent)] overflow-hidden">
                {/* Corner handles */}
                <div className="absolute left-0 top-0 h-4 w-4 border-l-2 border-t-2 border-white/90 rounded-tl-[6px]" />
                <div className="absolute right-0 top-0 h-4 w-4 border-r-2 border-t-2 border-white/90 rounded-tr-[6px]" />
                <div className="absolute left-0 bottom-0 h-4 w-4 border-l-2 border-b-2 border-white/90 rounded-bl-[6px]" />
                <div className="absolute right-0 bottom-0 h-4 w-4 border-r-2 border-b-2 border-white/90 rounded-br-[6px]" />
                {/* Grid */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border border-white/40" />
                  ))}
                </div>
              </div>
            </div>

            {/* Center hint */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium tracking-wide text-white/90 backdrop-blur">
              Face centered
            </div>
          </div>

          {/* Controls */}
          <div className="mx-auto mt-4 flex max-w-[320px] items-center gap-3">
            <ZoomIn className="h-4 w-4 shrink-0 text-fg-subtle" />
            <input
              type="range"
              min={0.85}
              max={2}
              step={0.02}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="h-1 w-full accent-[var(--color-fg)]"
              aria-label="Zoom"
            />
            <span className="w-9 text-right text-xs tabular-nums text-fg-subtle">{Math.round(scale * 100)}%</span>
          </div>
          <div className="mx-auto mt-2 flex max-w-[320px] items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
            <Move className="h-3 w-3" /> Drag to re-center
          </div>

          {qualityHint && (
            <div className="mx-auto mt-4 max-w-[320px] rounded-[var(--radius-md)] border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs leading-snug text-warn">
              {qualityHint.text}
            </div>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-border bg-bg px-5 py-4 sm:px-6">
          <Button variant="secondary" size="md" onClick={onRetake} className="flex-1" disabled={isApproving}>
            <RotateCcw className="h-4 w-4" />
            Retake
          </Button>
          <Button variant="primary" size="md" onClick={handleApprove} className="flex-[1.4]" disabled={isApproving}>
            <Check className="h-4 w-4" />
            {isApproving ? "Preparing…" : "Approve & Match"}
          </Button>
        </div>
      </div>

      <p className="text-center text-[11px] text-fg-subtle text-pretty">
        Your photo stays on-device. We crop a square around your face for the most accurate embedding.
      </p>
    </section>
  );
}
