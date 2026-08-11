const STEPS = [
  "Loading face recognition model",
  "Detecting & cropping face",
  "Extracting face embedding",
  "Ranking celebrity gallery",
];

export function AnalyzingState({ stepIndex }: { stepIndex: number }) {
  return (
    <section
      className="animate-fade-up rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-7 sm:p-9"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 rounded-full border border-border" />
          <div className="absolute inset-2 rounded-full border border-border-strong animate-pulse-soft" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-1.5 w-1.5 rounded-full bg-fg" />
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-base font-medium shimmer-text">Analyzing face…</h2>
          <p className="text-sm text-fg-muted">
            {STEPS[Math.min(stepIndex, STEPS.length - 1)]}
          </p>
        </div>
        <ol className="w-full max-w-xs space-y-2 text-left">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`flex items-center gap-2.5 text-sm ${
                i <= stepIndex ? "text-fg" : "text-fg-subtle"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] tabular-nums border ${
                  i < stepIndex
                    ? "border-match bg-match-dim text-match"
                    : i === stepIndex
                      ? "border-border-strong bg-bg-subtle"
                      : "border-border"
                }`}
              >
                {i < stepIndex ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path
                      d="M2 5.2L4.1 7.2L8 2.8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
