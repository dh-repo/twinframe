import { Progress } from "@/components/ui/progress";

const STEPS = [
  { label: "Loading face recognition model", detail: "FaceNet + gallery" },
  { label: "Detecting & cropping face", detail: "SSD MobileNet · 68 landmarks" },
  { label: "Extracting face embedding", detail: "128-d descriptor" },
  { label: "Ranking celebrity gallery", detail: "792 age-bucketed stars" },
];

export function AnalyzingState({
  stepIndex,
  previewUrl,
  progress,
}: {
  stepIndex: number;
  previewUrl?: string | null;
  progress?: number;
}) {
  const pct = progress ?? Math.min(92, 18 + stepIndex * 24);
  const active = STEPS[Math.min(stepIndex, STEPS.length - 1)]!;
  return (
    <section
      className="animate-fade-up overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-elevated"
      aria-live="polite"
      aria-busy="true"
    >
      {/* Header with preview + progress */}
      <div className="border-b border-border bg-bg-subtle/50 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3.5">
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-border bg-bg">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <div className="h-full w-full animate-pulse-soft bg-bg-subtle" />
            )}
            <div className="absolute inset-0 rounded-full border border-white/10" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium tracking-tight shimmer-text">Analyzing face…</h2>
            <p className="truncate text-xs text-fg-muted">
              {active.label} • {active.detail}
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-fg-muted">{pct}%</span>
        </div>
        <div className="mt-3">
          <Progress value={pct} className="h-1.5" />
        </div>
      </div>

      <div className="p-6 sm:p-7">
        <div className="flex flex-col items-center gap-5 text-center">
          {/* Orbital animation */}
          <div className="relative h-[84px] w-[84px]">
            <div className="absolute inset-0 rounded-full border border-border" />
            <div className="absolute inset-[10px] rounded-full border border-dashed border-border-strong opacity-60" style={{ animation: "spin 4s linear infinite" }} />
            <div className="absolute inset-3 rounded-full border border-border-strong animate-pulse-soft" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-fg shadow-[0_0_12px_color-mix(in_oklab,var(--color-fg)_50%,transparent)]" />
            </div>
            {/* orbiting dot */}
            <div
              className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2"
              style={{ animation: "spin 1.6s linear infinite" }}
            >
              <div className="h-2 w-2 -translate-y-[36px] rounded-full bg-match shadow-[0_0_8px_var(--color-match)]" />
            </div>
          </div>

          <ol className="w-full max-w-xs space-y-2.5 text-left">
            {STEPS.map((s, i) => {
              const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <li
                  key={s.label}
                  className={`flex items-center gap-2.5 text-sm transition-colors ${
                    state === "pending" ? "text-fg-subtle" : "text-fg"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] tabular-nums border transition-[background,border-color] ${
                      state === "done"
                        ? "border-match bg-match text-bg"
                        : state === "active"
                          ? "border-fg bg-fg text-bg animate-pulse-soft"
                          : "border-border bg-transparent"
                    }`}
                  >
                    {state === "done" ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                        <path
                          d="M2 5.2L4.1 7.2L8 2.8"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block leading-tight">{s.label}</span>
                    <span className={`block text-xs leading-tight ${state === "active" ? "text-fg-muted" : "text-fg-subtle"}`}>{s.detail}</span>
                  </span>
                  {state === "active" && (
                    <span className="ml-auto flex gap-1">
                      <span className="h-1 w-1 animate-bounce rounded-full bg-fg-subtle [animation-delay:0ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-fg-subtle [animation-delay:150ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-fg-subtle [animation-delay:300ms]" />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <p className="max-w-xs text-center text-[11px] leading-relaxed text-fg-subtle text-pretty">
            Matching runs on-device — your photo never leaves this device for recognition. High-quality front light gives the most confident match.
          </p>
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </section>
  );
}
