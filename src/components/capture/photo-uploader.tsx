import { useCallback, useRef, useState } from "react";
import { Camera, FolderUp, UploadCloud, Upload } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { isLikelyPhotoFile, normalizeImageFile } from "@/lib/image/heic";
import { openCameraStream } from "@/lib/ux/open-camera";

interface PhotoUploaderProps {
  onFile: (file: File) => void;
  onCameraClick?: (stream: MediaStream | null) => void;
  disabled?: boolean;
}

const PHOTO_ACCEPT = "image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp";

export function PhotoUploader({ onFile, onCameraClick, disabled }: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    async (file: File | undefined | null) => {
      if (!file || disabled || busy) return;
      setError(null);
      if (!isLikelyPhotoFile(file)) {
        setError("Please choose a photo (JPG, PNG, or HEIC).");
        return;
      }
      setBusy(true);
      try {
        const normalized = await normalizeImageFile(file);
        onFile(normalized);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that photo.");
      } finally {
        setBusy(false);
      }
    },
    [busy, disabled, onFile],
  );

  return (
    <div className="neon-upload-card-wrapper">
      <div
        className={cn(
          "neon-upload-card-inner relative flex flex-col items-center justify-center p-6 sm:p-9 text-center transition-all duration-300",
          dragging
            ? "border border-indigo-400/80 bg-indigo-950/40 ring-2 ring-indigo-500/50"
            : "border border-white/10",
          disabled && "opacity-50 pointer-events-none",
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void accept(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-indigo-400/40 bg-gradient-to-b from-indigo-500/30 to-purple-600/30 text-white shadow-lg shadow-indigo-500/20">
          <div className="animate-cloud-ripple absolute inset-0 rounded-2xl border border-indigo-400/40 pointer-events-none" />
          <UploadCloud className="h-8 w-8 stroke-[1.75]" />
        </div>

        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-white sm:text-2xl">
          <Upload className="h-5 w-5 stroke-[2.2]" />
          Upload Photo
        </h2>

        <p className="mt-1 text-sm font-medium text-white/80 sm:text-base">
          Take a selfie or choose one from your camera roll.
        </p>

        <p className="mt-1 text-xs text-white/50 sm:text-sm">
          Front-facing, in good light (JPG, PNG, HEIC).
        </p>

        <div className="mt-6 flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:gap-4">
          {onCameraClick && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                void (async () => {
                  try {
                    const stream = await openCameraStream("user");
                    onCameraClick?.(stream);
                  } catch {
                    onCameraClick?.(null);
                  }
                })();
              }}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-base font-bold text-black shadow-md transition-all hover:bg-neutral-100 active:scale-[0.98]"
            >
              <Camera className="h-4 w-4 stroke-[2.2]" />
              Use My Camera
            </button>
          )}

          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-5 py-3.5 text-base font-bold text-white shadow-md backdrop-blur-md transition-all hover:bg-white/15 hover:border-white/30 active:scale-[0.98]"
          >
            <FolderUp className="h-4 w-4 stroke-[2.2]" />
            {busy ? "Reading photo…" : "Photo Library"}
          </button>
        </div>

        {error && (
          <p className="mt-4 max-w-sm text-pretty text-sm leading-snug text-amber-200" role="alert">
            {error}
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            void accept(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
