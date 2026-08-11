/**
 * Lightweight metadata for the expanded FaceNet gallery.
 * IDs match public/celebs embeddings. Falls back to heuristics for unknown ids.
 */

export interface CatalogEntry {
  knownFor: string;
  tags: string[];
  accentHue: number;
}

const ACTOR = "Actor";
const ARTIST = "Artist";
const ATHLETE = "Athlete";
const PUBLIC = "Public figure";
const MODEL = "Model";

/** Hand-curated overrides for popular names. */
const CURATED: Record<string, CatalogEntry> = {
  "brad-pitt": { knownFor: ACTOR, tags: ["classic", "angular"], accentHue: 42 },
  "george-clooney": { knownFor: ACTOR, tags: ["classic", "silver"], accentHue: 210 },
  "denzel-washington": { knownFor: ACTOR, tags: ["intense", "classic"], accentHue: 28 },
  "idris-elba": { knownFor: ACTOR, tags: ["broad jaw"], accentHue: 18 },
  "ryan-gosling": { knownFor: ACTOR, tags: ["soft features"], accentHue: 200 },
  "timothee-chalamet": { knownFor: ACTOR, tags: ["angular", "youthful"], accentHue: 25 },
  "tom-holland": { knownFor: ACTOR, tags: ["boyish"], accentHue: 12 },
  "michael-b-jordan": { knownFor: ACTOR, tags: ["defined jaw"], accentHue: 8 },
  "chris-hemsworth": { knownFor: ACTOR, tags: ["square jaw"], accentHue: 38 },
  "keanu-reeves": { knownFor: ACTOR, tags: ["long face"], accentHue: 220 },
  "pedro-pascal": { knownFor: ACTOR, tags: ["warm eyes"], accentHue: 22 },
  "henry-cavill": { knownFor: ACTOR, tags: ["hero jaw"], accentHue: 205 },
  "zendaya": { knownFor: ACTOR, tags: ["high cheekbones"], accentHue: 340 },
  "scarlett-johansson": { knownFor: ACTOR, tags: ["full lips"], accentHue: 12 },
  "margot-robbie": { knownFor: ACTOR, tags: ["classic oval"], accentHue: 45 },
  "rihanna": { knownFor: ARTIST, tags: ["full features"], accentHue: 350 },
  "beyonce": { knownFor: ARTIST, tags: ["radiant"], accentHue: 45 },
  "the-weeknd": { knownFor: ARTIST, tags: ["angular"], accentHue: 0 },
  "dua-lipa": { knownFor: ARTIST, tags: ["cat eyes"], accentHue: 280 },
  "harry-styles": { knownFor: ARTIST, tags: ["soft features"], accentHue: 330 },
  "taylor-swift": { knownFor: ARTIST, tags: ["bright"], accentHue: 15 },
  "ariana-grande": { knownFor: ARTIST, tags: ["youthful"], accentHue: 320 },
  "billie-eilish": { knownFor: ARTIST, tags: ["soft features"], accentHue: 160 },
  "lady-gaga": { knownFor: ARTIST, tags: ["expressive"], accentHue: 300 },
  "adele": { knownFor: ARTIST, tags: ["classic"], accentHue: 25 },
  "selena-gomez": { knownFor: ARTIST, tags: ["bright eyes"], accentHue: 5 },
  "leonardo-dicaprio": { knownFor: ACTOR, tags: ["classic"], accentHue: 30 },
  "robert-downey-jr": { knownFor: ACTOR, tags: ["sharp"], accentHue: 20 },
  "tom-hanks": { knownFor: ACTOR, tags: ["warm"], accentHue: 40 },
  "will-smith": { knownFor: ACTOR, tags: ["bright smile"], accentHue: 15 },
  "dwayne-johnson": { knownFor: ACTOR, tags: ["broad"], accentHue: 25 },
  "ryan-reynolds": { knownFor: ACTOR, tags: ["sharp smile"], accentHue: 200 },
  "hugh-jackman": { knownFor: ACTOR, tags: ["strong jaw"], accentHue: 35 },
  "christian-bale": { knownFor: ACTOR, tags: ["angular"], accentHue: 10 },
  "cillian-murphy": { knownFor: ACTOR, tags: ["sharp eyes"], accentHue: 210 },
  "benedict-cumberbatch": { knownFor: ACTOR, tags: ["long face"], accentHue: 15 },
  "jason-momoa": { knownFor: ACTOR, tags: ["broad features"], accentHue: 18 },
  "tom-hardy": { knownFor: ACTOR, tags: ["rugged"], accentHue: 22 },
  "angelina-jolie": { knownFor: ACTOR, tags: ["full lips"], accentHue: 350 },
  "jennifer-aniston": { knownFor: ACTOR, tags: ["classic"], accentHue: 35 },
  "julia-roberts": { knownFor: ACTOR, tags: ["wide smile"], accentHue: 12 },
  "sandra-bullock": { knownFor: ACTOR, tags: ["warm"], accentHue: 25 },
  "meryl-streep": { knownFor: ACTOR, tags: ["expressive"], accentHue: 30 },
  "cate-blanchett": { knownFor: ACTOR, tags: ["sculpted"], accentHue: 200 },
  "nicole-kidman": { knownFor: ACTOR, tags: ["classic"], accentHue: 8 },
  "charlize-theron": { knownFor: ACTOR, tags: ["angular"], accentHue: 40 },
  "blake-lively": { knownFor: ACTOR, tags: ["bright"], accentHue: 20 },
  "emma-watson": { knownFor: ACTOR, tags: ["youthful"], accentHue: 210 },
  "natalie-portman": { knownFor: ACTOR, tags: ["fine features"], accentHue: 0 },
  "anya-taylor-joy": { knownFor: ACTOR, tags: ["wide eyes"], accentHue: 50 },
  "brie-larson": { knownFor: ACTOR, tags: ["bright"], accentHue: 15 },
  "kristen-stewart": { knownFor: ACTOR, tags: ["angular"], accentHue: 240 },
  "keira-knightley": { knownFor: ACTOR, tags: ["fine features"], accentHue: 30 },
  "halle-berry": { knownFor: ACTOR, tags: ["classic"], accentHue: 20 },
  "michelle-yeoh": { knownFor: ACTOR, tags: ["elegant"], accentHue: 5 },
  "gong-li": { knownFor: ACTOR, tags: ["sculpted"], accentHue: 0 },
  "shah-rukh-khan": { knownFor: ACTOR, tags: ["classic"], accentHue: 25 },
  "deepika-padukone": { knownFor: ACTOR, tags: ["striking eyes"], accentHue: 320 },
  "jackie-chan": { knownFor: ACTOR, tags: ["expressive"], accentHue: 15 },
  "rami-malek": { knownFor: ACTOR, tags: ["wide eyes"], accentHue: 200 },
  "paul-rudd": { knownFor: ACTOR, tags: ["boyish"], accentHue: 30 },
  "kevin-hart": { knownFor: ARTIST, tags: ["expressive"], accentHue: 18 },
  "adam-sandler": { knownFor: ACTOR, tags: ["warm"], accentHue: 40 },
  "johnny-depp": { knownFor: ACTOR, tags: ["angular"], accentHue: 25 },
  "kim-kardashian": { knownFor: PUBLIC, tags: ["defined"], accentHue: 10 },
  "lebron-james": { knownFor: ATHLETE, tags: ["powerful"], accentHue: 15 },
  "cristiano-ronaldo": { knownFor: ATHLETE, tags: ["sharp jaw"], accentHue: 200 },
  "lionel-messi": { knownFor: ATHLETE, tags: ["compact"], accentHue: 30 },
  "barack-obama": { knownFor: PUBLIC, tags: ["classic"], accentHue: 210 },
  "michelle-obama": { knownFor: PUBLIC, tags: ["warm"], accentHue: 25 },
  "elon-musk": { knownFor: PUBLIC, tags: ["soft features"], accentHue: 200 },
  "david-beckham": { knownFor: ATHLETE, tags: ["classic"], accentHue: 20 },
  "oprah-winfrey": { knownFor: PUBLIC, tags: ["radiant"], accentHue: 30 },
  "serena-williams": { knownFor: ATHLETE, tags: ["powerful"], accentHue: 18 },
  "iu": { knownFor: ARTIST, tags: ["fine features"], accentHue: 330 },
  "jennie-kim": { knownFor: ARTIST, tags: ["cat eyes"], accentHue: 0 },
  "drake": { knownFor: ARTIST, tags: ["soft features"], accentHue: 220 },
  "bruno-mars": { knownFor: ARTIST, tags: ["bright smile"], accentHue: 25 },
  "justin-bieber": { knownFor: ARTIST, tags: ["youthful"], accentHue: 40 },
  "ed-sheeran": { knownFor: ARTIST, tags: ["soft features"], accentHue: 15 },
  "matt-damon": { knownFor: ACTOR, tags: ["classic"], accentHue: 35 },
  "jake-gyllenhaal": { knownFor: ACTOR, tags: ["intense"], accentHue: 10 },
  "chris-pratt": { knownFor: ACTOR, tags: ["warm"], accentHue: 30 },
  "bradley-cooper": { knownFor: ACTOR, tags: ["angular"], accentHue: 200 },
  "joaquin-phoenix": { knownFor: ACTOR, tags: ["angular"], accentHue: 15 },
  "morgan-freeman": { knownFor: ACTOR, tags: ["classic"], accentHue: 25 },
};

const ATHLETE_HINTS = [
  "james", "curry", "durant", "williams", "biles", "osaka", "federer", "nadal",
  "djokovic", "ronaldo", "messi", "neymar", "mbappe", "beckham",
];
const ARTIST_HINTS = [
  "swift", "grande", "eilish", "rodrigo", "gaga", "adele", "beyonce", "rihanna",
  "cardi", "stallion", "doja", "minaj", "sza", "lizzo", "cyrus", "perry",
  "spears", "lopez", "shakira", "drake", "lamar", "malone", "mars", "bieber",
  "sheeran", "mendes", "malik", "styles", "weeknd", "bunny", "lipa", "jennie",
  "jisoo", "rose", "lisa", "iu",
];
const MODEL_HINTS = [
  "hadid", "jenner", "kardashian", "delevingne", "ratajkowski", "lima",
  "bundchen", "crawford", "campbell", "banks", "klum",
];
const PUBLIC_HINTS = [
  "obama", "harris", "musk", "zuckerberg", "bezos", "cook", "gates",
  "prince", "meghan", "kate", "middleton", "oprah", "fallon", "colbert",
  "noah", "letterman",
];

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function catalogFor(id: string): CatalogEntry {
  if (CURATED[id]) return CURATED[id]!;
  const lower = id.toLowerCase();
  let knownFor = ACTOR;
  const tags: string[] = [];
  if (ATHLETE_HINTS.some((h) => lower.includes(h))) knownFor = ATHLETE;
  else if (MODEL_HINTS.some((h) => lower.includes(h))) knownFor = MODEL;
  else if (PUBLIC_HINTS.some((h) => lower.includes(h))) knownFor = PUBLIC;
  else if (ARTIST_HINTS.some((h) => lower.includes(h))) knownFor = ARTIST;
  return { knownFor, tags, accentHue: hashHue(id) };
}
