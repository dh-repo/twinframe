import { classifyGoldCase } from "./lookalike-gold.mjs";

/** @param {{ id?: string, acceptableTopIds?: string[] }} c */
export function identityCelebId(c) {
  const labeled = c?.acceptableTopIds?.[0];
  if (typeof labeled === "string" && labeled.length > 0) return labeled;
  return String(c?.id ?? "").replace(/^identity-/i, "");
}

export function roundDescriptor(descriptor) {
  return Array.from(descriptor).map((x) => Math.round(Number(x) * 1e5) / 1e5);
}

/**
 * Replace identity-regression query vectors with the shipped gallery row
 * (AdaFace-512 enrolled self-vector). Does not invent civilian rows.
 *
 * @param {{ cases?: object[] }} set
 * @param {{ id: string, descriptor: number[] }[]} gallery
 */
export function refreshIdentitySeeds(set, gallery) {
  const byId = new Map(gallery.map((row) => [row.id, row]));
  const cases = Array.isArray(set.cases) ? set.cases : [];
  let refreshed = 0;
  const missing = [];

  for (const c of cases) {
    if (classifyGoldCase(c) !== "identity-regression") continue;
    const celebId = identityCelebId(c);
    const row = byId.get(celebId);
    if (!row?.descriptor?.length) {
      missing.push(celebId);
      continue;
    }
    c.queryDescriptor = roundDescriptor(row.descriptor);
    c.encodedFrom = "public/celebs/embeddings.v4.q8.bin";
    c.notes = "Enrolled self-vector regression. Guards Top-1 while open-set policy evolves.";
    refreshed++;
  }

  if (missing.length > 0) {
    throw new Error(`gallery missing identity seeds: ${missing.join(", ")}`);
  }

  return { set, refreshed };
}
