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

export type PackManifest = Partial<Record<PackId, readonly string[]>>;

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * Register curated id lists from `public/celebs/packs.json`.
 * Unknown keys and non-array values are ignored so the file can grow.
 */
export function applyPackManifest(manifest: unknown): void {
  if (!manifest || typeof manifest !== "object") return;
  for (const [key, value] of Object.entries(manifest as Record<string, unknown>)) {
    if (!isPackId(key)) continue;
    registerCuratedPack(key, asIdList(value));
  }
}

function registerCuratedPack(pack: PackId, ids: readonly string[]): void {
  switch (pack) {
    case "all":
      return;
    case "nineties-icons":
    case "athletes":
    case "musicians":
    case "actors":
    case "models":
    case "public-figures":
      registerPackIds(pack, ids);
      return;
    default: {
      const _exhaustive: never = pack;
      return _exhaustive;
    }
  }
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
