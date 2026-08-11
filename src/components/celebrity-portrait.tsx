import { useState } from "react";
import { cn } from "@/lib/utils/cn";

export function CelebrityPortrait({
  initials,
  accentHue,
  photoUrl,
  size = "md",
  className,
  alt = "",
}: {
  initials: string;
  accentHue: number;
  photoUrl?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dims = {
    sm: "h-11 w-11 text-xs",
    md: "h-14 w-14 text-sm",
    lg: "h-20 w-20 text-lg",
    xl: "h-28 w-28 text-2xl sm:h-32 sm:w-32",
  }[size];

  const showPhoto = Boolean(photoUrl) && !failed;

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
      {showPhoto ? (
        <img
          src={photoUrl}
          alt={alt || initials}
          className="h-full w-full object-cover object-top"
          onError={() => setFailed(true)}
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
