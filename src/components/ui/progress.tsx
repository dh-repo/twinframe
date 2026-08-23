import { cn } from "@/lib/utils/cn";

export function Progress({
  value,
  className,
  barClassName,
  "aria-label": ariaLabel,
}: {
  value: number;
  className?: string;
  barClassName?: string;
  /** Accessible name — progressbars without one fail axe `aria-progressbar-name`. */
  "aria-label"?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle",
        className,
      )}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full bg-match transition-[width] duration-500 ease-out",
          barClassName,
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
