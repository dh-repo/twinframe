import { useState } from "react";
import { cn } from "@/lib/utils/cn";

export function CelebrityPortrait({
  initials,
  accentHue,
  photoUrl,
  photoUrl192,
  fallbackUrl,
  size = "md",
  className,
  alt = "",
}: {
  initials: string;
  accentHue: number;
  photoUrl?: string;
  photoUrl192?: string;
  fallbackUrl?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  alt?: string;
}) {
  // Image fallback order: path192 -> path -> initials avatar
  const [stage, setStage] = useState<"192" | "96" | "failed">(() =>
    photoUrl192 ? "192" : photoUrl ? "96" : "failed",
  );

  const currentSrc =
    stage === "192" ? photoUrl192 : stage === "96" ? photoUrl : undefined;

  const dims = {
    sm: "h-11 w-11 text-xs",
    md: "h-14 w-14 text-sm",
    lg: "h-20 w-20 text-lg",
    xl: "h-28 w-28 text-2xl sm:h-32 sm:w-32",
  }[size];

  const showPhoto = Boolean(currentSrc) && stage !== "failed";

  const handleImageError = () => {
    if (stage === "192" && photoUrl) {
      setStage("96");
    } else {
      setStage("failed");
    }
  };

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium tracking-tight text-fg",
        dims,
        className,
      )}
      style={
        showPhoto
          ? {
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, white 14%, transparent)`,
            }
          : {
              background: `linear-gradient(145deg,
                hsl(${accentHue} 12% 22%),
                hsl(${(accentHue + 40) % 360} 10% 14%))`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, white 12%, transparent)`,
            }
      }
    >
      {showPhoto && currentSrc ? (
        <img
          src={currentSrc}
          alt={alt || initials}
          className="h-full w-full object-cover object-top"
          onError={handleImageError}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <>
          <span className="relative z-[1] opacity-90">{initials}</span>
          <span
            className="pointer-events-none absolute inset-0 rounded-full opacity-40"
            style={{
              background: `radial-gradient(circle at 30% 25%,
                hsl(${accentHue} 40% 70% / 0.35), transparent 55%)`,
            }}
          />
        </>
      )}
    </div>
  );
}
