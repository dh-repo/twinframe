/**
 * Themed gallery packs ("Match me with 90s icons only").
 *
 * Packs are a matching scope, not a results filter: the gallery is subset
 * before scoring so ranks, margins, and percents all describe the pack the
 * user chose.
 */

export type PackId =
  | "all"
  | "nineties-icons"
  | "athletes"
  | "musicians"
  | "actors"
  | "models"
  | "public-figures";

export interface PackDefinition {
  id: PackId;
  label: string;
  blurb: string;
  /** `knownFor` values that qualify. Empty for id-list-only packs. */
  knownFor: readonly string[];
}

export const PACKS: readonly PackDefinition[] = [
  {
    id: "all",
    label: "Everyone",
    blurb: "The full gallery",
    knownFor: [],
  },
  {
    id: "nineties-icons",
    label: "90s Icons",
    blurb: "Faces that ruled the nineties",
    knownFor: [],
  },
  {
    id: "athletes",
    label: "Athletes",
    blurb: "Champions and competitors",
    knownFor: ["Athlete"],
  },
  {
    id: "musicians",
    label: "Musicians",
    blurb: "Singers, rappers, and pop stars",
    knownFor: ["Artist"],
  },
  {
    id: "actors",
    label: "Actors",
    blurb: "Screen and stage",
    knownFor: ["Actor"],
  },
  {
    id: "models",
    label: "Models",
    blurb: "Runway and campaign faces",
    knownFor: ["Model"],
  },
  {
    id: "public-figures",
    label: "Public Figures",
    blurb: "Leaders, hosts, and founders",
    knownFor: ["Public figure"],
  },
];

export const DEFAULT_PACK: PackId = "all";

const PACK_BY_ID = new Map<PackId, PackDefinition>(PACKS.map((p) => [p.id, p]));

export function packDefinition(pack: PackId): PackDefinition | undefined {
  return PACK_BY_ID.get(pack);
}

export function isPackId(value: string): value is PackId {
  return PACK_BY_ID.has(value as PackId);
}

/**
 * Curated id lists for packs that metadata cannot express (era packs).
 * Registered at load time from `public/celebs/packs.json` so the list can grow
 * without a code change; falls back to knownFor-only membership when absent.
 */
const CURATED_PACK_IDS = new Map<PackId, Set<string>>();

export function registerPackIds(pack: PackId, ids: Iterable<string>): void {
  CURATED_PACK_IDS.set(pack, new Set(ids));
}

export function clearRegisteredPackIds(): void {
  CURATED_PACK_IDS.clear();
}

export function registeredPackIds(pack: PackId): ReadonlySet<string> {
  return CURATED_PACK_IDS.get(pack) ?? new Set<string>();
}

export function celebInPack(id: string, knownFor: string, pack: PackId): boolean {
  if (pack === "all") return true;
  const def = PACK_BY_ID.get(pack);
  if (!def) return true;
  const curated = CURATED_PACK_IDS.get(pack);
  if (curated?.has(id)) return true;
  if (def.knownFor.length === 0) return false;
  return def.knownFor.includes(knownFor);
}
