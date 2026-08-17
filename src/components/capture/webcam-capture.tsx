import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ImagePlus, SwitchCamera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { playShutterSound } from "@/lib/utils/feedback";
import { useLockBodyScroll } from "@/lib/ux/lock-body-scroll";
import {
  cameraErrorMessage,
  openCameraStream,
  waitForVideoFrame,
  type CameraFacing,
} from "@/lib/ux/open-camera";
import { isLikelyPhotoFile, normalizeImageFile } from "@/lib/image/heic";

interface WebcamCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (blob: Blob) => void;
  /** Stream acquired in the tap that opened the sheet (iOS gesture-safe). */
  presetStream?: MediaStream | null;
}

const PHOTO_ACCEPT = "image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp";

export function WebcamCapture({
  open,
  onClose,
  onCapture,
  presetStream = null,
}: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facingMode, setFacingMode] = useState<CameraFacing>("user");
  const [capturing, setCapturing] = useState(false);

  useLockBodyScroll(open);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const attach = useCallback(async (stream: MediaStream) => {
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await waitForVideoFrame(video);
    setReady(true);
  }, []);

  const start = useCallback(
    async (facing: CameraFacing) => {
      setError(null);
      setReady(false);
      stop();
      await new Promise((r) => window.setTimeout(r, 150));
      try {
        const stream = await openCameraStream(facing);
        await attach(stream);
      } catch (err) {
        setError(cameraErrorMessage(err));
      }
    },
    [attach, stop],
  );

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    if (presetStream) {
      void attach(presetStream).catch((err) => setError(cameraErrorMessage(err)));
    } else {
      void start(facingMode);
    }
    return () => stop();
    // Only (re)start when the sheet opens. Flip calls start() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready || capturing) return;
    setCapturing(true);
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w < 2 || h < 2) throw new Error("Camera frame not ready");
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      if (facingMode === "user") {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      playShutterSound();
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) throw new Error("Capture failed");
      onCapture(blob);
      onClose();
    } catch {
      setError("Capture failed. Try again or pick a photo.");
    } finally {
      setCapturing(false);
    }
  }, [ready, capturing, facingMode, onCapture, onClose]);

  const onNativeFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!isLikelyPhotoFile(file)) {
        setError("Please choose a photo (JPG, PNG, or HEIC).");
        return;
      }
      try {
        const normalized = await normalizeImageFile(file);
        onCapture(normalized);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that photo.");
      }
    },
    [onCapture, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-bg/85 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture"
    >
      <div className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[var(--radius-2xl)] border border-border bg-bg-elevated shadow-[var(--shadow-soft)] sm:rounded-[var(--radius-2xl)]">
        <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <p className="text-sm font-medium">Camera</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-fg-muted hover:bg-bg-subtle hover:text-fg"
            aria-label="Close camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative aspect-[3/4] max-h-[min(68dvh,560px)] min-h-0 flex-1 overflow-hidden bg-bg sm:aspect-[4/3]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              "absolute inset-0 h-full w-full object-cover",
              facingMode === "user" && "scale-x-[-1]",
              !ready && "opacity-0",
            )}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[58%] w-[62%] max-w-[280px] rounded-full border border-border-strong/80 shadow-[inset_0_0_0_9999px_color-mix(in_oklab,var(--color-bg)_35%,transparent)]" />
          </div>
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-fg-muted shimmer-text">Starting camera…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <CameraOff className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
              <p className="max-w-xs text-pretty text-sm text-fg-muted">{error}</p>
              <Button
                type="button"
                variant="primary"
                onClick={() => nativeInputRef.current?.click()}
              >
                <ImagePlus className="h-4 w-4" />
                Open phone camera
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Flip camera"
            onClick={() => {
              const next = facingMode === "user" ? "environment" : "user";
              setFacingMode(next);
              void start(next);
            }}
          >
            <SwitchCamera className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={!ready || !!error || capturing}
            onClick={() => void capture()}
            className="max-w-[14rem] flex-1"
          >
            <Camera className="h-5 w-5" />
            {capturing ? "Capturing…" : "Snap"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Use photo library or device camera"
            onClick={() => nativeInputRef.current?.click()}
          >
            <ImagePlus className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <input
        ref={nativeInputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        capture={facingMode === "environment" ? "environment" : "user"}
        className="sr-only"
        onChange={(e) => {
          void onNativeFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
