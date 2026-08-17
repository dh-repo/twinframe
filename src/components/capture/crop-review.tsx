import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, ZoomIn, Move, Users, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FaceCandidateUI {
  id: number;
  label: string;
  box: { x: number; y: number; width: number; height: number }; // normalized percentage (0-100)
  unscaledBox: { x: number; y: number; width: number; height: number };
  isPrimary: boolean;
  score: number;
  /** Small face preview for the picker chips */
  thumbUrl?: string;
}

export interface CropReviewProps {
  imageSrc: string;
  fileName?: string;
  onApprove: (
    blob: Blob,
    selectedBox?: { x: number; y: number; width: number; height: number },
  ) => void;
  onRetake: () => void;
}

/** Crop a small square thumb of a face box from the source image. */
function makeFaceThumb(
  img: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
  size = 72,
): string | undefined {
  try {
    const pad = 0.25;
    const side = Math.max(box.width, box.height) * (1 + pad * 2);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    let sx = cx - side / 2;
    let sy = cy - side / 2;
    sx = Math.max(0, Math.min(img.naturalWidth - side, sx));
    sy = Math.max(0, Math.min(img.naturalHeight - side, sy));
    const crop = Math.min(side, img.naturalWidth - sx, img.naturalHeight - sy);
    if (crop <= 1) return undefined;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, crop, crop, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return undefined;
  }
}

export function CropReview({ imageSrc, fileName, onApprove, onRetake }: CropReviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0, moved: false });
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [stageSize, setStageSize] = useState(320);
  const [isApproving, setIsApproving] = useState(false);

  // Multi-face candidate selection states
  const [candidates, setCandidates] = useState<FaceCandidateUI[]>([]);
  const [selectedFaceId, setSelectedFaceId] = useState<number | null>(null);
  const [isDetectingFaces, setIsDetectingFaces] = useState<boolean>(true);
  const [detectStatus, setDetectStatus] = useState<string>("Loading face model…");
  const [detectError, setDetectError] = useState<string | null>(null);

  const centerCropOnBox = useCallback(
    (
      box: { x: number; y: number; width: number; height: number },
      iw: number,
      ih: number,
      zoom = scale,
    ) => {
      if (!iw || !ih) return;
      const containerSize = stageSize || 320;
      const drawScale = Math.max(containerSize / iw, containerSize / ih) * zoom;
      const fcx = box.x + box.width / 2;
      const fcy = box.y + box.height / 2;
      const icx = iw / 2;
      const icy = ih / 2;
      // Offset in container px so face center lands on viewfinder center
      const ox = (icx - fcx) * drawScale;
      const oy = (icy - fcy) * drawScale;
      const max = Math.max(80, 120 * zoom);
      setOffset({
        x: Math.max(-max, Math.min(max, ox)),
        y: Math.max(-max, Math.min(max, oy)),
      });
    },
    [scale, stageSize],
  );

  const centerCropOnBoxRef = useRef(centerCropOnBox);
  useEffect(() => {
    centerCropOnBoxRef.current = centerCropOnBox;
  }, [centerCropOnBox]);

  useEffect(() => {
    let isMounted = true;
    let finished = false;
    setIsDetectingFaces(true);
    setCandidates([]);
    setSelectedFaceId(null);
    setDetectError(null);
    setDetectStatus("Loading face model…");

    // Hard stop so the UI never spins forever (models + detect)
    const safetyTimer = setTimeout(() => {
      if (!isMounted || finished) return;
      finished = true;
      setIsDetectingFaces(false);
      setDetectStatus("Face detection timed out — Retake and try again");
      setDetectError("Automatic face detection took too long.");
    }, 20000);

    const img = new Image();
    img.src = imageSrc;
    img.onload = async () => {
      if (!isMounted || finished) return;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      setImageSize({ w: iw, h: ih });

      const applyList = (list: FaceCandidateUI[]) => {
        if (!isMounted || list.length === 0) return;
        setCandidates(list);
        setDetectError(null);
        const primaryIdx = list.findIndex((c) => c.isPrimary);
        const selIdx = primaryIdx >= 0 ? primaryIdx : 0;
        setSelectedFaceId(selIdx);
        const face = list[selIdx]!.unscaledBox;
        const faceSide = Math.max(face.width, face.height);
        const targetFacePx = Math.min(iw, ih) * 0.45;
        const zoom = Math.min(2, Math.max(1, targetFacePx / Math.max(faceSide, 1)));
        setScale(zoom);
        centerCropOnBoxRef.current(face, iw, ih, zoom);
      };

      try {
        setDetectStatus("Scanning for faces…");
        const { detectCropFaces } = await import(
          "@/lib/face/crop-face-detector"
        );
        if (!isMounted || finished) return;
        const detection = await detectCropFaces(img);
        if (!isMounted || finished) return;
        const list: FaceCandidateUI[] = detection.faces.map((face, idx) => ({
          id: idx,
          label: `Face ${idx + 1}`,
          box: face.normalizedBox,
          unscaledBox: face.box,
          isPrimary: face.isPrimary,
          score: face.score,
          thumbUrl: makeFaceThumb(img, face.box),
        }));

        if (list.length > 0) {
          applyList(list);
          setDetectStatus(
            list.length === 1
              ? "1 face found — adjust if needed"
              : `${list.length} faces found — tap who to match`,
          );
        } else {
          setDetectStatus("No face found — Retake and try another photo");
          setDetectError("Automatic detection could not find a clear face.");
        }
      } catch (e) {
        console.warn("Face candidate detection in CropReview failed:", e);
        if (isMounted && !finished) {
          setDetectError(
            e instanceof Error ? e.message : "Face model failed to load",
          );
          setDetectStatus("Face detection failed — Retake and try again");
        }
      } finally {
        finished = true;
        clearTimeout(safetyTimer);
        if (isMounted) setIsDetectingFaces(false);
      }
    };
    img.onerror = () => {
      finished = true;
      clearTimeout(safetyTimer);
      if (isMounted) {
        setIsDetectingFaces(false);
        setDetectError("Could not load image");
        setDetectStatus("Image failed to load");
      }
    };
    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
    };
  }, [imageSrc]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const w = el.clientWidth;
      if (w > 0) setStageSize(w);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [imageSrc]);

  const handleSelectCandidate = useCallback(
    (c: FaceCandidateUI) => {
      setSelectedFaceId(c.id);
      if (imageSize.w && imageSize.h) {
        const faceSide = Math.max(c.unscaledBox.width, c.unscaledBox.height);
        const targetFacePx = Math.min(imageSize.w, imageSize.h) * 0.45;
        const zoom = Math.min(2, Math.max(1, targetFacePx / Math.max(faceSide, 1)));
        setScale(zoom);
        centerCropOnBox(c.unscaledBox, imageSize.w, imageSize.h, zoom);
      }
    },
    [imageSize, centerCropOnBox],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Don't start a pan when the user is tapping a face reticle
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-face-reticle]")) return;

      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        ox: offset.x,
        oy: offset.y,
        moved: false,
      };
    },
    [offset],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      if (Math.hypot(dx, dy) > 4) dragStart.current.moved = true;
      const max = Math.max(80, 120 * scale);
      setOffset({
        x: Math.max(-max, Math.min(max, dragStart.current.ox + dx)),
        y: Math.max(-max, Math.min(max, dragStart.current.oy + dy)),
      });
    },
    [dragging, scale],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    setDragging(false);
  }, []);

  const handleApprove = useCallback(async () => {
    if (isApproving || isDetectingFaces) return;
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
      (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";

      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const selectedCandidate = candidates.find((c) => c.id === selectedFaceId);

      // Prefer a face-centric crop from the original image when we have a detected
      // face. This is more accurate than the low-res viewfinder rasterization path
      // (especially for group photos / high-res phone images).
      if (selectedCandidate && iw > 0 && ih > 0) {
        const face = selectedCandidate.unscaledBox;
        const pad = 0.45;
        const cx = face.x + face.width / 2;
        const cy = face.y + face.height / 2;
        const side = Math.max(face.width, face.height) * (1 + pad * 2);
        const cropSide = Math.min(side, Math.min(iw, ih));
        let sx = cx - cropSide / 2;
        let sy = cy - cropSide / 2;
        sx = Math.max(0, Math.min(iw - cropSide, sx));
        sy = Math.max(0, Math.min(ih - cropSide, sy));

        ctx.fillStyle = "#0a0a0b";
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, size, size);
      } else {
        // Manual pan/zoom path (no detection): rasterize the square viewfinder
        const containerSize = stageSize || 320;
        const cropSize = Math.round(containerSize * (260 / 320));
        const baseScale = Math.max(containerSize / iw, containerSize / ih);
        const drawScale = baseScale * scale;
        const drawW = iw * drawScale;
        const drawH = ih * drawScale;
        const vcx = containerSize / 2 + offset.x;
        const vcy = containerSize / 2 + offset.y;

        const view = document.createElement("canvas");
        view.width = containerSize;
        view.height = containerSize;
        const vctx = view.getContext("2d");
        if (!vctx) throw new Error("Canvas unsupported");
        vctx.fillStyle = "#0a0a0b";
        vctx.fillRect(0, 0, containerSize, containerSize);
        vctx.drawImage(img, vcx - drawW / 2, vcy - drawH / 2, drawW, drawH);

        const vsx = (containerSize - cropSize) / 2;
        const vsy = (containerSize - cropSize) / 2;
        ctx.drawImage(view, vsx, vsy, cropSize, cropSize, 0, 0, size, size);
      }

      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", 0.92),
      );
      if (!blob) throw new Error("Could not create image");

      // After face-centric crop the selected face fills most of the square, so
      // normalized box is near-center. Pass it so analysis can re-lock if multi-face.
      const selectedBox = selectedCandidate
        ? { x: 20, y: 18, width: 60, height: 64 }
        : undefined;

      onApprove(blob, selectedBox);
    } catch (e) {
      console.error(e);
      setIsApproving(false);
    }
  }, [offset, scale, stageSize, onApprove, isApproving, isDetectingFaces, candidates, selectedFaceId]);

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
          <h2 className="text-base font-medium tracking-tight">Choose a face &amp; adjust</h2>
          <p className="mt-1 text-sm text-fg-muted text-pretty">
            {candidates.length > 1
              ? `We found ${candidates.length} faces — tap the person you want to match.`
              : "Tap a face box, or drag and zoom so your face fills the square."}
          </p>
          {fileName && (
            <p className="mt-1 truncate text-xs text-fg-subtle tabular-nums">{fileName} • {imageSize.w}×{imageSize.h}</p>
          )}
        </div>

        <div className="px-5 py-5 sm:px-6">
          {/* Hidden img for canvas ref (naturalWidth) */}
          <img ref={imgRef} src={imageSrc} alt="" className="hidden" aria-hidden />

          {/* Manual face picker — always visible when faces are detected */}
          {candidates.length > 0 && (
            <div
              className={`mx-auto mb-3.5 max-w-[320px] rounded-[var(--radius-lg)] border p-3 ${
                candidates.length > 1
                  ? "border-match/40 bg-match/10"
                  : "border-white/10 bg-white/5"
              }`}
              role="listbox"
              aria-label="Select face to match"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-tight text-white flex items-center gap-1.5">
                  {candidates.length > 1 ? (
                    <>
                      <Users className="h-3.5 w-3.5 text-match" />
                      Select who to match
                    </>
                  ) : (
                    <>
                      <ScanFace className="h-3.5 w-3.5 text-match" />
                      Face selected
                    </>
                  )}
                </span>
                <span className="text-[11px] text-fg-subtle tabular-nums">
                  {candidates.length} face{candidates.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {candidates.map((c) => {
                  const isSelected = selectedFaceId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelectCandidate(c)}
                      className={`group flex items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-all ${
                        isSelected
                          ? "border-match bg-match/20 shadow-[0_0_14px_color-mix(in_oklab,var(--color-match)_35%,transparent)]"
                          : "border-white/15 bg-black/30 hover:border-white/40 hover:bg-black/50"
                      }`}
                    >
                      <span
                        className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border ${
                          isSelected ? "border-match" : "border-white/20"
                        }`}
                      >
                        {c.thumbUrl ? (
                          <img
                            src={c.thumbUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center bg-white/5 text-[10px] text-white/50">
                            {c.id + 1}
                          </span>
                        )}
                        {isSelected && (
                          <span className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-match/80 to-transparent pb-0.5">
                            <Check className="h-3 w-3 text-bg" strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      <span className="pr-1">
                        <span
                          className={`block text-xs font-semibold ${
                            isSelected ? "text-white" : "text-white/80"
                          }`}
                        >
                          {c.label}
                        </span>
                        <span className="block text-[10px] text-fg-subtle">
                          {isSelected ? "Matching this face" : "Tap to select"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(isDetectingFaces || detectError || (!isDetectingFaces && candidates.length === 0)) && (
            <div
              className={`mx-auto mb-3.5 max-w-[320px] rounded-[var(--radius-lg)] border px-3 py-2.5 text-center text-xs ${
                detectError
                  ? "border-warn/30 bg-warn/10 text-warn"
                  : isDetectingFaces
                    ? "border-white/10 bg-white/5 text-fg-muted"
                    : "border-warn/30 bg-warn/10 text-warn"
              }`}
            >
              {isDetectingFaces ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {detectStatus}
                </span>
              ) : (
                detectStatus
              )}
              {detectError && !isDetectingFaces && (
                <span className="mt-1 block text-[10px] opacity-80">{detectError}</span>
              )}
            </div>
          )}

          <div
            ref={containerRef}
            className="relative mx-auto aspect-square w-full max-w-[min(320px,calc(100vw-2.5rem))] overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg-subtle touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
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
                  const base = Math.max(stageSize / imageSize.w, stageSize / imageSize.h);
                  const s = base * scale;
                  return `${imageSize.w * s}px ${imageSize.h * s}px`;
                })(),
              }}
            />

            {/* Overlay outside crop (under face hits so boxes stay tappable) */}
            <div className="pointer-events-none absolute inset-0 z-[1]">
              <div className="absolute inset-0 bg-[color-mix(in_oklab,#000_55%,transparent)]" />
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border-2 border-white/90 shadow-[0_0_0_9999px_color-mix(in_oklab,#000_55%,transparent),0_8px_30px_color-mix(in_oklab,#000_60%,transparent)] overflow-hidden"
                style={{
                  width: Math.round(stageSize * (260 / 320)),
                  height: Math.round(stageSize * (260 / 320)),
                }}
              >
                <div className="absolute left-0 top-0 h-4 w-4 border-l-2 border-t-2 border-white/90 rounded-tl-[6px]" />
                <div className="absolute right-0 top-0 h-4 w-4 border-r-2 border-t-2 border-white/90 rounded-tr-[6px]" />
                <div className="absolute left-0 bottom-0 h-4 w-4 border-l-2 border-b-2 border-white/90 rounded-bl-[6px]" />
                <div className="absolute right-0 bottom-0 h-4 w-4 border-r-2 border-b-2 border-white/90 rounded-br-[6px]" />
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border border-white/40" />
                  ))}
                </div>
              </div>
            </div>

            {/* Interactive face reticles — above vignette, tappable */}
            {candidates.map((c) => {
              const isSelected = selectedFaceId === c.id;
              if (!imageSize.w || !imageSize.h) return null;
              const containerSize = stageSize || 320;
              const baseScale = Math.max(containerSize / imageSize.w, containerSize / imageSize.h);
              const drawScale = baseScale * scale;
              const drawW = imageSize.w * drawScale;
              const drawH = imageSize.h * drawScale;
              const imgLeft = containerSize / 2 + offset.x - drawW / 2;
              const imgTop = containerSize / 2 + offset.y - drawH / 2;
              const boxLeft = imgLeft + (c.box.x / 100) * drawW;
              const boxTop = imgTop + (c.box.y / 100) * drawH;
              const boxW = Math.max(28, (c.box.width / 100) * drawW);
              const boxH = Math.max(28, (c.box.height / 100) * drawH);

              return (
                <button
                  key={c.id}
                  type="button"
                  data-face-reticle=""
                  aria-label={`Select ${c.label}`}
                  aria-pressed={isSelected}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectCandidate(c);
                  }}
                  className={`absolute z-20 cursor-pointer rounded-lg transition-all duration-200 ${
                    isSelected
                      ? "border-2 border-match bg-match/20 shadow-[0_0_16px_var(--color-match)]"
                      : "border border-dashed border-white/70 bg-black/25 hover:border-white hover:bg-black/40"
                  }`}
                  style={{
                    left: `${boxLeft}px`,
                    top: `${boxTop}px`,
                    width: `${boxW}px`,
                    height: `${boxH}px`,
                  }}
                >
                  <span
                    className={`absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-mono font-medium pointer-events-none ${
                      isSelected
                        ? "bg-match text-bg font-bold"
                        : "bg-black/70 text-white/80 backdrop-blur-sm"
                    }`}
                  >
                    {isSelected ? "✓ " : ""}
                    {c.label}
                  </span>
                </button>
              );
            })}

            {/* Status pill */}
            <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium tracking-wide text-white/90 backdrop-blur">
              {isDetectingFaces
                ? detectStatus
                : selectedFaceId !== null
                  ? `Matching ${candidates.find((c) => c.id === selectedFaceId)?.label ?? "selected face"}`
                  : "Drag to re-center"}
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
              className="h-11 w-full accent-[var(--color-fg)]"
              aria-label="Zoom"
            />
            <span className="w-9 text-right text-xs tabular-nums text-fg-subtle">{Math.round(scale * 100)}%</span>
          </div>
          <div className="mx-auto mt-2 flex max-w-[320px] items-center justify-center gap-1.5 text-[11px] text-fg-subtle">
            <Move className="h-3 w-3" /> Drag photo · tap a face box or thumbnail to select
          </div>

          {qualityHint && (
            <div className="mx-auto mt-4 max-w-[320px] rounded-[var(--radius-md)] border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs leading-snug text-warn">
              {qualityHint.text}
            </div>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-border bg-bg px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <Button variant="secondary" size="md" onClick={onRetake} className="flex-1" disabled={isApproving}>
            <RotateCcw className="h-4 w-4" />
            Retake
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleApprove}
            className="flex-[1.4]"
            disabled={isApproving || isDetectingFaces || candidates.length === 0}
          >
            <Check className="h-4 w-4" />
            {isApproving
              ? "Preparing…"
              : isDetectingFaces
                ? "Finding face…"
                : selectedFaceId !== null && candidates.length > 1
                  ? `Match ${candidates.find((c) => c.id === selectedFaceId)?.label ?? "face"}`
                  : candidates.length === 0
                    ? "No face found"
                    : "Approve & Match"}
          </Button>
        </div>
      </div>

      <p className="text-center text-[11px] text-fg-subtle text-pretty">
        Your photo stays on-device. We crop a square around your face for the most accurate embedding.
      </p>
    </section>
  );
}
