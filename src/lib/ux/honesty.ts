/** FaceNet mid-scores are not real look-alikes. Shared by results UI + share card. */
export type HonestyBand = "weak" | "soft" | "strong";

export const WEAK_MATCH_MAX = 55;
export const SOFT_MATCH_MAX = 70;

export function honestyBand(matchPercent: number): HonestyBand {
  if (matchPercent < WEAK_MATCH_MAX) return "weak";
  if (matchPercent < SOFT_MATCH_MAX) return "soft";
  return "strong";
}

export function honestyHeadline(band: HonestyBand): string {
  if (band === "weak") return "NEAREST GALLERY NEIGHBOR";
  if (band === "soft") return "POSSIBLE LOOK-ALIKE";
  return "TOP DOPPELGÄNGER MATCH";
}

export function honestyShareLabel(band: HonestyBand): string {
  if (band === "weak") return "Nearest neighbor";
  if (band === "soft") return "Possible look-alike";
  return "Look-alike";
}

export function honestyRating(
  band: HonestyBand,
  confidenceScore: number,
): string {
  if (band === "weak") return "NOT A STRONG MATCH";
  if (band === "soft") return "MODERATE MATCH";
  if (confidenceScore >= 80) return "HIGH CONFIDENCE";
  if (confidenceScore >= 60) return "MODERATE CONFIDENCE";
  return "CALIBRATED MATCH";
}

export function restListHeading(topPercent: number): string {
  return honestyBand(topPercent) === "weak"
    ? "OTHER NEAREST NEIGHBORS"
    : "ALSO CLOSE";
}

export function shareText(name: string, matchPercent: number): string {
  const band = honestyBand(matchPercent);
  const pct = Math.round(matchPercent);
  if (band === "weak") {
    return `Nearest gallery neighbor on Twinframe: ${name} (${pct}% face similarity) — not a strong look-alike.`;
  }
  if (band === "soft") {
    return `Possible look-alike on Twinframe: ${name} at ${pct}% similarity.`;
  }
  return `I matched ${name} at ${pct}% on Twinframe.`;
}

/** Hide age when the estimate is likely junk (cartoons, blur, extreme values). */
export function shouldShowEstimatedAge(
  age: number | null | undefined,
  quality?: { score?: number; sharpness?: number },
  extras?: { youthfulness?: number },
): boolean {
  if (age == null || !Number.isFinite(age)) return false;
  // Never display a child age — the net overshoots kids and it is the wrong label.
  if (age < 16 || age > 80) return false;
  const score = quality?.score ?? 1;
  const sharpness = quality?.sharpness ?? 100;
  if (score < 0.35 || sharpness < 40) return false;
  if (age > 75 && (score < 0.55 || sharpness < 55)) return false;
  const youth = extras?.youthfulness;
  // Age-net often reports ~18–21 for children. High youthfulness + "teen" → hide.
  if (typeof youth === "number" && age <= 22 && youth >= 0.68) return false;
  return true;
}
