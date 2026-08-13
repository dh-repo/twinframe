import { useCallback, useRef, useState } from "react";
import { Camera, FolderUp, UploadCloud, Upload } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { isHeicFile, normalizeImageFile } from "@/lib/image/heic";

interface PhotoUploaderProps {
  onFile: (file: File) => void;
  onCameraClick?: () => void;
  disabled?: boolean;
}

export function PhotoUploader({ onFile, onCameraClick, disabled }: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  const accept = useCallback(
    async (file: File | undefined | null) => {
      if (!file || disabled || preparing) return;
      const looksLikeImage = file.type.startsWith("image/") || isHeicFile(file);
      if (!looksLikeImage) return;

      setPrepareError(null);
      setPreparing(true);
      try {
        const normalized = await normalizeImageFile(file);
        onFile(normalized);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not prepare that photo.";
        setPrepareError(msg);
      } finally {
        setPreparing(false);
      }
    },
    [disabled, onFile, preparing],
  );

  const busy = disabled || preparing;

  return (
    <div className="neon-upload-card-wrapper">
      <div
        className={cn(
          "neon-upload-card-inner relative flex flex-col items-center justify-center p-7 sm:p-9 text-center transition-all duration-300",
          dragging
            ? "border border-indigo-400/80 bg-indigo-950/40 ring-2 ring-indigo-500/50"
            : "border border-white/10",
          busy && "opacity-50 pointer-events-none",
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
          Drag & drop your portrait here.
        </p>

        <p className="mt-1 text-xs text-white/50 sm:text-sm">
          Front-facing, in good light (JPG, PNG, HEIC).
        </p>

        {preparing && (
          <p className="mt-3 text-xs font-medium text-indigo-200/90 sm:text-sm">
            Preparing photo…
          </p>
        )}

        {prepareError && !preparing && (
          <p className="mt-3 max-w-sm text-xs leading-relaxed text-amber-200/90 sm:text-sm text-pretty">
            {prepareError}
          </p>
        )}

        <div className="mt-6 flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:gap-4">
          {onCameraClick && (
            <button
              type="button"
              disabled={busy}
              onClick={onCameraClick}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-black shadow-md transition-all hover:bg-neutral-100 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Camera className="h-4 w-4 stroke-[2.2]" />
              Use My Camera
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-bold text-white shadow-md backdrop-blur-md transition-all hover:bg-white/15 hover:border-white/30 hover:scale-[1.02] active:scale-[0.98]"
          >
            <FolderUp className="h-4 w-4 stroke-[2.2]" />
            Upload File
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif,image/heic,image/heif"
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
