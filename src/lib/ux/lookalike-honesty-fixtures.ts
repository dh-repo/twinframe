import type { CelebrityMatch } from "../face/types.ts";
import type { VerdictTier } from "../face/verdict.ts";
import { OPEN_SET_MISS_GALLERY } from "../face/lookalike-policy.ts";

export type HonestyFixtureKind = "dead-ringer" | "soft-match" | "distant-twin" | "refuse";

export interface HonestyFixtureCase {
  id: HonestyFixtureKind;
  title: string;
  match: CelebrityMatch | null;
}

const traits: CelebrityMatch["traits"] = [];

function match(partial: {
  celebrityId: string;
  name: string;
  knownFor: string;
  matchPercent: number;
  probabilityCorrect?: number;
  verdict: VerdictTier;
  initials: string;
}): CelebrityMatch {
  return {
    celebrityId: partial.celebrityId,
    name: partial.name,
    knownFor: partial.knownFor,
    matchPercent: partial.matchPercent,
    rawScore: 1 - partial.matchPercent / 100,
    confidenceScore: Math.round((partial.probabilityCorrect ?? 0) * 100),
    traits,
    accentHue: 160,
    initials: partial.initials,
    tags: [],
    photoUrl: `/celebs/${partial.celebrityId}.jpg`,
    photoUrl192: `/celebs/thumbs/192/${partial.celebrityId}.webp`,
    fallbackPhotoUrl: `/celebs/${partial.celebrityId}.jpg`,
    verdict: partial.verdict,
    probabilityCorrect: partial.probabilityCorrect,
  };
}

export const REFUSE_HEADING = "No close look-alike found";
export const REFUSE_BODY = OPEN_SET_MISS_GALLERY;

export const HONESTY_FIXTURES: readonly HonestyFixtureCase[] = [
  {
    id: "dead-ringer",
    title: "Dead Ringer — calibrated P(correct) leads; Hill is similarity",
    match: match({
      celebrityId: "florence-pugh",
      name: "Florence Pugh",
      knownFor: "Actor",
      matchPercent: 88.4,
      probabilityCorrect: 0.821,
      verdict: "dead-ringer",
      initials: "FP",
    }),
  },
  {
    id: "soft-match",
    title: "Soft Match — hero is gallery-ID chance, not a twin score",
    match: match({
      celebrityId: "zendaya",
      name: "Zendaya",
      knownFor: "Actor",
      matchPercent: 65,
      probabilityCorrect: 0.58,
      verdict: "soft-match",
      initials: "Z",
    }),
  },
  {
    id: "distant-twin",
    title: "Distant Twin — never hero a Hill percent",
    match: match({
      celebrityId: "keanu-reeves",
      name: "Keanu Reeves",
      knownFor: "Actor",
      matchPercent: 62,
      probabilityCorrect: 0.19,
      verdict: "distant-twin",
      initials: "KR",
    }),
  },
  {
    id: "refuse",
    title: "Refuse — no celebrity percent",
    match: null,
  },
];
