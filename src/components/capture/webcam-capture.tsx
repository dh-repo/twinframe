import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, SwitchCamera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface WebcamCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (blob: Blob) => void;
}

export function WebcamCapture({ open, onClose, onCapture }: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [capturing, setCapturing] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setReady(false);
    stop();
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera access is not supported in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch (playErr) {
          console.warn("Video play error (handled):", playErr);
        }
        setReady(true);
      }
    } catch {
      setError(
        "Could not open the camera. Check permissions, or upload a photo instead.",
      );
    }
  }, [facingMode, stop]);

  useEffect(() => {
    if (open) void start();
    else stop();
    return () => stop();
  }, [open, start, stop]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready || capturing) return;
    setCapturing(true);
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      // Mirror selfie for natural look
      if (facingMode === "user") {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) throw new Error("Capture failed");
      onCapture(blob);
      onClose();
    } catch {
      setError("Capture failed. Try again or upload a photo.");
    } finally {
      setCapturing(false);
    }
  }, [ready, capturing, facingMode, onCapture, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-bg/80 p-0 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture"
    >
      <div className="flex w-full max-w-lg max-h-[100dvh] flex-col overflow-hidden rounded-t-[var(--radius-2xl)] sm:rounded-[var(--radius-2xl)] border border-border bg-bg-elevated shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-medium">Camera</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-fg-muted hover:text-fg hover:bg-bg-subtle touch-target-min"
            aria-label="Close camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative aspect-[3/4] sm:aspect-[4/3] bg-bg overflow-hidden">
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
          {/* Face guide */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[58%] w-[62%] max-w-[280px] rounded-full border border-border-strong/80 shadow-[inset_0_0_0_9999px_color-mix(in_oklab,var(--color-bg)_35%,transparent)]" />
          </div>
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-fg-muted shimmer-text">Starting camera…</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <CameraOff className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
              <p className="text-sm text-fg-muted text-pretty max-w-xs">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Flip camera"
            onClick={() =>
              setFacingMode((m) => (m === "user" ? "environment" : "user"))
            }
          >
            <SwitchCamera className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={!ready || !!error || capturing}
            onClick={() => void capture()}
            className="flex-1 max-w-[14rem]"
          >
            <Camera className="h-5 w-5" />
            {capturing ? "Capturing…" : "Snap"}
          </Button>
          <div className="w-12" aria-hidden />
        </div>
      </div>
    </div>
  );
}
