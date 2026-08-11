import { useCallback, useRef, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface PhotoUploaderProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function PhotoUploader({ onFile, disabled }: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback(
    (file: File | undefined | null) => {
      if (!file || disabled) return;
      if (!file.type.startsWith("image/")) return;
      onFile(file);
    },
    [disabled, onFile],
  );

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-4 rounded-[var(--radius-xl)] border border-dashed p-6 sm:p-8 transition-[border-color,background-color] duration-200",
        dragging
          ? "border-border-strong bg-bg-subtle"
          : "border-border bg-bg-elevated/60",
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
        accept(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-bg-subtle border border-border">
        <ImagePlus className="h-6 w-6 text-fg-muted" strokeWidth={1.5} />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-fg">Drop a photo here</p>
        <p className="text-xs text-fg-muted text-pretty max-w-[16rem]">
          Front-facing, good light, one face. JPG, PNG, or HEIC.
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="min-w-[10rem]"
      >
        <Upload className="h-4 w-4" strokeWidth={1.75} />
        Upload photo
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
