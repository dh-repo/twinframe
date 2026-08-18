import { PACKS, packDefinition, type PackId } from "@/lib/celebrities/packs";
import { cn } from "@/lib/utils/cn";

interface PackPickerProps {
  value: PackId;
  onChange: (pack: PackId) => void;
  disabled?: boolean;
  /** Hide the blurb under the chips (results already show the active pack). */
  compact?: boolean;
}

export function PackPicker({ value, onChange, disabled, compact }: PackPickerProps) {
  const active = packDefinition(value) ?? PACKS[0]!;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap justify-center gap-2">
        {PACKS.map((pack) => {
          const selected = pack.id === value;
          return (
            <button
              key={pack.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => {
                if (!selected) onChange(pack.id);
              }}
              className={cn(
                "min-h-10 rounded-full px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-50",
                selected
                  ? "bg-white text-black font-semibold shadow-sm"
                  : "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white",
              )}
            >
              {pack.label}
            </button>
          );
        })}
      </div>
      {!compact && (
        <p className="text-center text-xs leading-relaxed text-white/55">{active.blurb}</p>
      )}
    </div>
  );
}
