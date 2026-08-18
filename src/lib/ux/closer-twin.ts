/** Signals used to decide who is the closer celebrity twin. */
export interface CloserTwinSignals {
  /** Age/gender-adjusted cosine distance — lower is closer. */
  adjustedDistance?: number;
  /** Displayed similarity percent — higher is closer when distance is tied/missing. */
  matchPercent: number;
}

export type CloserTwinWinner = "a" | "b" | "tie";

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Closer twin = lower adjustedDistance.
 * If either side is missing a finite distance, fall back to higher matchPercent.
 * Equal on the active signal → `"tie"`.
 */
export function closerTwin(
  a: CloserTwinSignals,
  b: CloserTwinSignals,
): CloserTwinWinner {
  const aDist = finiteOrNull(a.adjustedDistance);
  const bDist = finiteOrNull(b.adjustedDistance);

  if (aDist !== null && bDist !== null) {
    if (aDist < bDist) return "a";
    if (bDist < aDist) return "b";
  }

  const aPct = finiteOrNull(a.matchPercent) ?? 0;
  const bPct = finiteOrNull(b.matchPercent) ?? 0;
  if (aPct > bPct) return "a";
  if (bPct > aPct) return "b";
  return "tie";
}

export function closerTwinLabel(winner: CloserTwinWinner): string {
  switch (winner) {
    case "a":
      return "Closer twin: You";
    case "b":
      return "Closer twin: Friend";
    case "tie":
      return "It's a tie";
    default: {
      const _exhaustive: never = winner;
      return _exhaustive;
    }
  }
}

export function closerTwinStamp(winner: CloserTwinWinner): string {
  switch (winner) {
    case "a":
      return "Closer Twin: You";
    case "b":
      return "Closer Twin: Friend";
    case "tie":
      return "Tied Twins";
    default: {
      const _exhaustive: never = winner;
      return _exhaustive;
    }
  }
}
