/**
 * Reviewed gallery drops applied at load time.
 *
 * Audit output is proposed-only. This module never rewrites embeddings.v4.q8.bin.
 * Only `approved` ids are filtered; `proposed` stays visible for human review.
 * Pair shapes are local so this file does not import gallery-audit (embeddings cycle).
 */

export interface DemotionPairInput {
  a: string;
  b: string;
  distance: number;
  band: "clone" | "identity-range" | "lookalike-range" | "far";
}

export const GALLERY_DEMOTION_REASONS = [
  "exact-clone",
  "identity-range",
  "suspect",
  "reviewed-drop",
] as const;

export type GalleryDemotionReason = (typeof GALLERY_DEMOTION_REASONS)[number];

export interface GalleryDemotionEntry {
  id: string;
  reason: GalleryDemotionReason;
  keep?: string;
  evidence: string;
  reviewedAt?: string;
}

export interface GalleryDemotionSpec {
  version: number;
  note?: string;
  approved: GalleryDemotionEntry[];
  proposed: GalleryDemotionEntry[];
}

export const EMPTY_GALLERY_DEMOTIONS: GalleryDemotionSpec = {
  version: 1,
  approved: [],
  proposed: [],
};

/** Known spelling / alias collisions. Drop the key; keep the value. */
export const CELEB_ID_ALIASES: Readonly<Record<string, string>> = {
  "gwenyth-paltrow": "gwyneth-paltrow",
};

/**
 * Identity-range pairs this close are donor clones or embedding collapse,
 * not ordinary look-alikes. Proposed for review only — never auto-approved.
 * 0.005 is the visually reviewed AdaFace cluster (distinct people, near-zero
 * cosine). 0.01 also pulled in household names (e.g. robert-downey-jr) that
 * must not be auto-listed as drop candidates.
 */
export const NEAR_CLONE_REVIEW_MAX = 0.005;

export function isGalleryDemotionReason(value: string): value is GalleryDemotionReason {
  switch (value) {
    case "exact-clone":
    case "identity-range":
    case "suspect":
    case "reviewed-drop":
      return true;
    default:
      return false;
  }
}

function parseEntry(raw: unknown, role: "approved" | "proposed", index: number): GalleryDemotionEntry {
  if (!raw || typeof raw !== "object") {
    throw new Error(`gallery-demotions ${role}[${index}]: expected object`);
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length === 0) {
    throw new Error(`gallery-demotions ${role}[${index}]: id required`);
  }
  if (typeof row.reason !== "string" || !isGalleryDemotionReason(row.reason)) {
    throw new Error(`gallery-demotions ${role}[${index}]: invalid reason`);
  }
  if (typeof row.evidence !== "string" || row.evidence.length === 0) {
    throw new Error(`gallery-demotions ${role}[${index}]: evidence required`);
  }
  if (row.keep !== undefined && (typeof row.keep !== "string" || row.keep.length === 0)) {
    throw new Error(`gallery-demotions ${role}[${index}]: keep must be a non-empty string`);
  }
  if (row.reviewedAt !== undefined && typeof row.reviewedAt !== "string") {
    throw new Error(`gallery-demotions ${role}[${index}]: reviewedAt must be a string`);
  }
  if (role === "approved" && (typeof row.reviewedAt !== "string" || row.reviewedAt.length === 0)) {
    throw new Error(`gallery-demotions approved[${index}]: reviewedAt required`);
  }
  const entry: GalleryDemotionEntry = {
    id: row.id,
    reason: row.reason,
    evidence: row.evidence,
  };
  if (typeof row.keep === "string") entry.keep = row.keep;
  if (typeof row.reviewedAt === "string") entry.reviewedAt = row.reviewedAt;
  return entry;
}

export function parseGalleryDemotions(raw: unknown): GalleryDemotionSpec {
  if (!raw || typeof raw !== "object") {
    throw new Error("gallery-demotions: expected object");
  }
  const spec = raw as Record<string, unknown>;
  if (typeof spec.version !== "number" || !Number.isFinite(spec.version)) {
    throw new Error("gallery-demotions: version must be a number");
  }
  if (!Array.isArray(spec.approved)) {
    throw new Error("gallery-demotions: approved must be an array");
  }
  const proposedRaw = spec.proposed === undefined ? [] : spec.proposed;
  if (!Array.isArray(proposedRaw)) {
    throw new Error("gallery-demotions: proposed must be an array");
  }
  const approved = spec.approved.map((row, i) => parseEntry(row, "approved", i));
  const proposed = proposedRaw.map((row, i) => parseEntry(row, "proposed", i));
  return {
    version: spec.version,
    note: typeof spec.note === "string" ? spec.note : undefined,
    approved,
    proposed,
  };
}

export function approvedDropIds(spec: GalleryDemotionSpec): Set<string> {
  const drop = new Set<string>();
  const keep = new Set<string>();
  for (const entry of spec.approved) {
    drop.add(entry.id);
    if (entry.keep) keep.add(entry.keep);
  }
  for (const id of keep) drop.delete(id);
  return drop;
}

/** Filter approved drop ids. Proposed ids stay. `keep` is never removed. */
export function applyReviewedDemotions<T extends { id: string }>(
  rows: readonly T[],
  spec: GalleryDemotionSpec,
): T[] {
  const drop = approvedDropIds(spec);
  if (drop.size === 0) return rows.slice();
  return rows.filter((row) => !drop.has(row.id));
}

function aliasDropSide(pair: DemotionPairInput): { drop: string; keep: string } | null {
  if (CELEB_ID_ALIASES[pair.a] === pair.b) return { drop: pair.a, keep: pair.b };
  if (CELEB_ID_ALIASES[pair.b] === pair.a) return { drop: pair.b, keep: pair.a };
  return null;
}

/**
 * Build proposed (not approved) review rows from an audit pair list.
 * Exact clones with a known alias pick the misspelling. Tight identity-range
 * pairs are listed for review; ordinary look-alike crowding is ignored.
 */
export function proposeDemotionEntries(pairs: readonly DemotionPairInput[]): GalleryDemotionEntry[] {
  const out: GalleryDemotionEntry[] = [];
  const seen = new Set<string>();

  const push = (entry: GalleryDemotionEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    out.push(entry);
  };

  for (const pair of pairs) {
    if (pair.band === "clone") {
      const alias = aliasDropSide(pair);
      if (alias) {
        push({
          id: alias.drop,
          reason: "exact-clone",
          keep: alias.keep,
          evidence: `clone pair ${pair.a} ↔ ${pair.b} d=${pair.distance}`,
        });
        continue;
      }
      push({
        id: pair.a,
        reason: "exact-clone",
        evidence: `clone pair ${pair.a} ↔ ${pair.b} d=${pair.distance} (both sides need review)`,
      });
      push({
        id: pair.b,
        reason: "exact-clone",
        evidence: `clone pair ${pair.a} ↔ ${pair.b} d=${pair.distance} (both sides need review)`,
      });
      continue;
    }
    if (pair.band === "identity-range" && pair.distance <= NEAR_CLONE_REVIEW_MAX) {
      const alias = aliasDropSide(pair);
      if (alias) {
        push({
          id: alias.drop,
          reason: "identity-range",
          keep: alias.keep,
          evidence: `near-clone pair ${pair.a} ↔ ${pair.b} d=${pair.distance.toFixed(4)}`,
        });
        continue;
      }
      push({
        id: pair.a,
        reason: "identity-range",
        evidence: `near-clone pair ${pair.a} ↔ ${pair.b} d=${pair.distance.toFixed(4)} (proposed only)`,
      });
      push({
        id: pair.b,
        reason: "identity-range",
        evidence: `near-clone pair ${pair.a} ↔ ${pair.b} d=${pair.distance.toFixed(4)} (proposed only)`,
      });
    }
  }
  return out;
}
