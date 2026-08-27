import { createFileRoute } from "@tanstack/react-router";
import { MatchRevealCard } from "@/components/results/match-reveal-card";
import {
  HONESTY_FIXTURES,
  REFUSE_BODY,
  REFUSE_HEADING,
} from "@/lib/ux/lookalike-honesty-fixtures";

export const Route = createFileRoute("/lookalike-honesty-verify")({
  component: LookalikeHonestyVerifyPage,
});

function LookalikeHonestyVerifyPage() {
  return (
    <main className="app-shell bg-[#090a0f] text-white">
      <div className="app-content mx-auto w-full max-w-xl space-y-8 px-4 py-8">
        <header className="space-y-2">
          <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/45">
            QA fixture — not a product surface
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Look-alike honesty fixtures</h1>
          <p className="text-sm text-white/70">
            Hero percent is calibrated gallery-ID chance. Distant Twin must not hero a Hill
            score. Refuse must not show a celebrity percent.
          </p>
        </header>

        {HONESTY_FIXTURES.map((fixture) => (
          <section
            key={fixture.id}
            data-honesty-case={fixture.id}
            className="space-y-3"
          >
            <h2 className="text-sm font-medium text-white/80">{fixture.title}</h2>
            {fixture.match ? (
              <MatchRevealCard
                topMatch={fixture.match}
                youUrl={null}
                className="opacity-100 scale-100"
              />
            ) : (
              <div className="rounded-[var(--radius-xl)] border border-warn/40 bg-bg-elevated px-5 py-4">
                <h3 className="text-sm font-medium text-white">{REFUSE_HEADING}</h3>
                <p className="mt-1 text-xs leading-relaxed text-white/70">{REFUSE_BODY}</p>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
