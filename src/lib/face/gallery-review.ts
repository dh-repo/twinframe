/**
 * Human gallery-review decisions. The audit JSON is suspects only —
 * this module applies `drop` to catalog rows. It never touches the binary.
 */

export const REVIEW_DECISIONS = ["drop", "reenroll", "keep"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export interface GalleryReviewFile {
  version: string;
  note?: string;
  sourceAudit?: string;
  decisions: Record<string, ReviewDecision>;
}

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return value === "drop" || value === "reenroll" || value === "keep";
}

export function parseGalleryReview(raw: unknown): GalleryReviewFile {
  if (!raw || typeof raw !== "object") {
    throw new Error("gallery-review.json must be an object");
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.version !== "string" || rec.version.length === 0) {
    throw new Error("gallery-review.json needs a version string");
  }
  if (!rec.decisions || typeof rec.decisions !== "object" || Array.isArray(rec.decisions)) {
    throw new Error("gallery-review.json needs a decisions object");
  }
  const decisions: Record<string, ReviewDecision> = {};
  for (const [id, value] of Object.entries(rec.decisions as Record<string, unknown>)) {
    if (!id.trim()) throw new Error("decision id must be non-empty");
    if (!isReviewDecision(value)) {
      throw new Error(`invalid decision for ${id}: ${String(value)}`);
    }
    decisions[id] = value;
  }
  return {
    version: rec.version,
    note: typeof rec.note === "string" ? rec.note : undefined,
    sourceAudit: typeof rec.sourceAudit === "string" ? rec.sourceAudit : undefined,
    decisions,
  };
}

export function dropIds(decisions: Record<string, ReviewDecision>): string[] {
  return Object.entries(decisions)
    .filter(([, d]) => d === "drop")
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b));
}

export function unsetReviewIds(
  suspectIds: readonly string[],
  decisions: Record<string, ReviewDecision>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of suspectIds) {
    if (seen.has(id) || decisions[id]) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function applyDrops<T extends { id: string }>(
  rows: readonly T[],
  idsToDrop: readonly string[],
): T[] {
  const drop = new Set(idsToDrop);
  return rows.filter((row) => !drop.has(row.id));
}
