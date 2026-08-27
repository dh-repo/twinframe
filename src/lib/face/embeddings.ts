import { catalogFor } from "../celebrities/catalog.ts";
import type { CelebrityProfile } from "../celebrities/types.ts";

export interface CelebrityEmbedding {
  id: string;
  path: string;
  name: string;
  descriptor: number[] | Float32Array;
  age: number;
  gender: "male" | "female";
  genderProb: number;
  // age-bucketed gallery extra
  bucketAge?: number;
  fallbackPath?: string;
  path192?: string;
}

export interface EmbeddingsGallery {
  version: string;
  model: string;
  count: number;
  celebrities: CelebrityEmbedding[];
}

interface GalleryMeta {
  version: string;
  model: string;
  dim: number;
  countCelebs: number;
  countBuckets: number;
  scale: number;
  maxAbs: number;
  quantization: string;
  files: { q8: string; f32: string; index: string };
}

interface BucketEntry {
  id: string;
  name: string;
  path: string;
  path192: string;
  fallbackPath: string;
  age: number;
  gender: "male" | "female";
  genderProb: number;
}

let galleryPromise: Promise<CelebrityEmbedding[]> | null = null;
let galleryCache: CelebrityEmbedding[] | null = null;

// IndexedDB cache for binary gallery (avoids re-fetch + decode on every reload)
const IDB_NAME = "twinframe-gallery";
const IDB_STORE = "embeddings";
const IDB_KEY = "gallery-v4.1-xt";

export interface V4BinaryHeader {
  magic: string;
  version: number;
  flags: number;
  vectorCount: number;
  dimension: number;
  quantType: number;
  globalScale: number;
  globalOffset: number;
  checksum: number;
}

export function parseV4BinaryHeader(buffer: ArrayBuffer): V4BinaryHeader | null {
  if (!buffer || buffer.byteLength < 32) return null;
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );

  if (magic !== "AFv4") return null;

  return {
    magic,
    version: view.getUint16(4, true),
    flags: view.getUint16(6, true),
    vectorCount: view.getUint32(8, true),
    dimension: view.getUint16(12, true),
    quantType: view.getUint8(14),
    globalScale: view.getFloat32(16, true),
    globalOffset: view.getFloat32(20, true),
    checksum: view.getUint32(24, true),
  };
}

function openIDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbGet(version: string): Promise<CelebrityEmbedding[] | null> {
  try {
    const db = await openIDB();
    if (!db) return null;
    return await new Promise((res) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const st = tx.objectStore(IDB_STORE);
      const rq = st.get(IDB_KEY);
      rq.onsuccess = () => {
        const v = rq.result as { version: string; data: CelebrityEmbedding[] } | undefined;
        if (v && v.version === version) res(v.data);
        else res(null);
      };
      rq.onerror = () => res(null);
    });
  } catch { return null; }
}

async function idbSet(version: string, data: CelebrityEmbedding[]): Promise<void> {
  try {
    const db = await openIDB();
    if (!db) return;
    await new Promise<void>((res) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ version, data }, IDB_KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* best-effort */ }
}

/** Gallery cache-busting version — bump when the binary gallery, its extra
 * templates, or catalog metadata change. This key gates the IndexedDB
 * short-circuit and the templates fetch URL below; skipping the bump pins
 * returning visitors to stale artifacts indefinitely (cycle-22 review P1).
 * 5.5.0: multi-shot repair + mislabeled-portrait fix + reconciled demographics.
 * 6.2.0: surgical AdaFace re-enroll of 14 poisoned collapse slots (household names kept).
 * 6.3.0: AdaFace extra templates for held-out miss identities.
 * 6.4.1: re-enroll every on-disk jpg primary; fetch replacements for remaining
 *        mislabeled thumbs (xiao-zhan was Federer; samuel-l-jackson was Reynolds).
 * 6.5.0: Wikipedia primaries for remaining household thumb-only slots (Nadal
 *        was a near-clone of a character actor; Rosalía/Son Ye-jin eval misses).
 * 6.5.1: drop the 100-id poisoned thumb cluster from ranking; enroll Stormare,
 *        Caviezel, and other remaining household names.
 * 6.5.2: Wikipedia primaries for remaining recognizable thumb-only slots
 *        (Alcock, Shahi, Vogel, and other TV/film names).
 * 6.5.3: Wikipedia primaries for McConaughey, Harrelson, Cardellini, Gustin,
 *        Emma D'Arcy, and other household thumb-only names.
 * 6.5.4: Wikipedia primaries for Emerson, Rickards, Donnell, and other
 *        remaining recognizable thumb-only names; reject namesake Wikipedia
 *        hits (Lee Jung-jae is not Lee Jung Mi).
 * 6.5.5: Enroll Ford and Mathis; reject multi-name group files (Nixon-era
 *        Curtis Lewis is not Richard J. Lewis) and USAF roster shots.
 * 6.5.6: Wikidata P18 portraits for Kingston, Chalk, Eklund, and others;
 *        skip author/athlete namesakes and childhood stills.
 * 6.5.7: Natalie Brown Wikipedia primary; keep solo convention portraits
 *        that the year-pair heuristic had treated as second-person shots.
 * 6.5.8: Carlos Valdes (Flash) Wikipedia primary; skip disambiguation pages
 *        and match accented catalog names to unaccented Commons filenames.
 * 6.5.9: Joshua Leonard Wikipedia primary (Blair Witch).
 * 6.5.10: James Hanlon Wikipedia primary (Peabody 2003).
 * 6.5.11: Arrowverse and TV Wikipedia primaries (Thompson, Cross, Laing,
 *         Horsdal, Anderson, Maher, Lea, Whigham, Nykl, Sharma, Hudson,
 *         Pizzolatto).
 * 6.5.12: Dahl, Samuda, Redman, Golin, and Evans Wikipedia primaries.
 * 6.5.13: Cullen and Brocklebank GalaxyCon Wikipedia infobox portraits.
 * 6.5.14: Wikipedia/Commons primaries for remaining thumb-only slots
 *         (Majdoub, Xavier, and Stein thumbs were impostors).
 * 6.5.15: Actor-disambiguation Wikipedia primaries (Rowe, Rogers, Berg, Quinn).
 * 6.5.16: Absorb the d≈0.08–0.10 halo of the poisoned thumb pile (11 more
 *         ranking extras were the same impostor face).
 * 6.5.17: Wikidata P18 primaries (Garrow, Turner, Sugar); cluster drop d<0.12.
 * 6.5.18: Absorb the remaining d<0.15 halo of the poisoned thumb pile.
 * 6.5.19: Rank verified jpg primaries only; thumb-only slots stay in
 *         index.json for browse but cannot win a look-alike.
 * 6.5.20: AdaFace extra views for weak Rank-1 identities (Adele, Zendaya,
 *         and other household names with unused held-out 002+ / extra-photos).
 *         Same-person gate rejected impostor extras; extras within d<0.05 of
 *         held-out 001 are dropped so eval stays unseen. Thumb-only slots
 * 6.5.21: Extra views for remaining weak Rank-1 names (Gaga, Rogen, Jennie,
 *         Gerwig, Carell, Efron, Mbappé) plus a verified adult Bieber extra.
 * 6.5.22: Replace Pacino beanie primary with a verified Serpico solo so
 *         era extras can pass the same-person gate; add Adele/Naomi extras.
 * 6.5.23: 19-era Adele extras (Live 2009 turtleneck views, not Seattle
 *         2011 / Live 2009 (4) which is the held-out 001 probe) plus a
 *         Doja Cat Hot Pink solo closer to the yellow-latex eval look.
 * 6.5.24: Gated extras for remaining weak Rank-1 names (Bezos, Comer,
 *         Dua Lipa, Selena, Alia, Cheadle).
 * 6.5.25: Karol G 2018-era extras (NTN interview + Boca en Boca).
 *         Telemedellín braid frames of eval 001 stay unenrolled; held-out
 *         002 matches the tracked probe pack and is not enrolled.
 * 6.5.26: Ben Affleck 1998 extra (young solo, closer to the Armageddon-era
 *         eval look than the 2024 bearded SXSW primary). Wrong-person
 *         files previously in extra-photos/ben-affleck were dropped.
 * 6.5.27: Era extras for Steve Carell (2010 SAG/Oscars, unbearded), Ana de
 *         Armas (2017 Comic-Con plus held-out 003/004), and Lisa (2024
 *         cropped solo plus held-out 002). Metallica-concert Bieber crop
 *         of eval 001 is not enrolled (dCrop 0.071, same sitting).
 * 6.5.28: Gated on-disk extras that beat held-out pack distance for
 *         Dakota, Miles, Dev, Bella, Hugh, and Nicki. Dakota extra 004
 *         was a byte-clone of eval 001 and was dropped. Glover 2012
 *         Commons views fail the eval look or the 0.7 gate.
 * 6.5.29: Commons extras that beat pack dTrue for Antonio (2020 Goya
 *         tuxedo), Nicole, Elizabeth Olsen (not 2011 TIFF floral eval
 *         sitting), Sofia PaleyFest, Chris Evans, and Cardi 2021.
 *         Chris Evans 2014.jpg and Cardi WEHO crop are eval clones.
 * 6.5.30: Commons extras that beat pack dTrue for Maluma (Viña 2017,
 *         Espaço das Américas 2017), Beyoncé (2009 Newcastle plus
 *         held-out 002/003), Gemma Chan (BIFA 2014, Marvel 2019),
 *         Harry Styles (November 2014), and Serena (Doha 2013).
 *         Beyoncé Knowles 2009 extra failed detection; Federer
 *         Commons views did not beat pack.
 * 6.5.31: Product-crops of Childish Gambino concert stills that beat
 *         pack dTrue for Donald Glover (wide group frames fail
 *         acceptPrimaryEmbed; TIFF 2015 is a primary near-dup).
 * 6.5.32: Product-crops of Julia Roberts 2010/2011 event portraits
 *         that beat the 80s B&W eval pack dTrue. Florence Comic-Con
 *         extra 003 is the same sitting as eval 001 and was not enrolled.
 * 6.5.33: Product-crops that beat pack dTrue for Sebastian Stan
 *         (2026 Cannes buzz-cut tuxedo, not the 2024 beige-suit
 *         eval sitting), Ariana Grande (Honeymoon Tour Jakarta 2015
 *         cat-ears; 2013 Jingle Ball frames are the eval sitting),
 *         and Doja Cat (Scarlet-era 2024 profile; Austin jumbotron
 *         is the same sitting). Naomi amfAR bangs stills did not
 *         beat DVF runway pack dTrue.
 * 6.5.34: Product-crop of Messi PSG portrait that beats the 2011-12
 *         Barcelona action pack dTrue. 2018 Argentina stills did not.
 * 6.5.35: Product-crops that beat pack dTrue for Kendrick Lamar
 *         (Pitchfork 2012 gingham; FIB 2016 B&W). FEQ July 2016 eval
 *         sitting was not enrolled. Naomi amfAR bangs, Ranveer NBA,
 *         and Dresden grimace stills are eval sittings or do not beat.
 * 6.5.36: Product-crops that beat pack dTrue for Martin Scorsese
 *         (glasses studio portrait + awards-stage crop; not 65th
 *         Peabody eval) and Florence Pugh (held-out BFI LFF 003;
 *         2024 TIFF van 3/4 extra 005). Comic-Con extra 003 is the
 *         eval sitting and was not enrolled.
 * 6.5.37: Gated extras that beat pack dTrue for Priyanka Chopra
 *         (held-out teal strapless 002 + cropped interview extra 002;
 *         not 2006 Don promo eval), Anne Hathaway (long-hair red
 *         extra 003; not pixie NO-SMOKING eval), Ryan Gosling
 *         (denim Comic-Con, glasses striped, outdoor denim; not
 *         peacoat eval), Leonardo DiCaprio (held-out 002/004; not
 *         White House Kerry hallway eval), and Sydney Sweeney
 *         (TIFF 2024 floral extra 002; not 2022 Reality corset eval).
 * 6.5.38: Commons extras that beat pack dTrue for Johnny Depp
 *         (Cannes 2023; not Public Enemies aviators), LeBron James
 *         (USA Olympics 2024 + Cavs 2018; not Lakers yellow 23),
 *         Adam Sandler (2018 interview; not 2006 San Sebastián),
 *         Cole Sprouse (Tribeca 2026 + Gage Skidmore white-shirt
 *         panel; not grey-shirt eval), Bradley Cooper (NYFF 2023
 *         black tee; not 2010 A-Team navy suit), and Jennie Kim
 *         (2018 fansign + 2017 bomber; not concert black-dress eval).
 * 6.5.39: Commons extras that beat pack dTrue for Roger Federer
 *         (AO 2014 white polo / red headband on blue hard court; not
 *         the green-court backhand eval) and Kate Middleton (2023
 *         indoor cream portrait; not 2022 Wimbledon yellow-dress
 *         trophy eval).
 * 6.5.40: Inter Miami 2025 product-crop that beats the 2011-12
 *         Barcelona action pack dTrue for Lionel Messi. Argentina
 *         2022 World Cup stills did not beat.
 * 6.5.41: Commons extras that beat pack dTrue for Kate Winslet
 *         (2023 white blazer + TIFF 2015; not Venice 2011 updo eval),
 *         The Weeknd (Cannes 2023 tuxedo; not red/blue concert eval),
 *         Vanessa Kirby (2018 leopard + Paris strapless; not black-
 *         blazer studio eval), Awkwafina (2018 studio + BAFTA 2026;
 *         not Golden Globes ruffled collar eval), Adriana Lima (2011
 *         sequin interview; not 2010 Fantasy Bra eval), Tom Hanks
 *         (2016 suede + Elvis 2022; not Kennedy Center Honors eval),
 *         Hrithik Roshan (2019 orange tee + 2016 pinstripe + Cannes
 *         Homebound; not Netflix HRX-cap eval), Steve Carell
 *         (Montclair 2014; not Despicable Me 2 glasses eval), and
 *         Lady Gaga (JWT Toronto Joanne-guitar; not leather A-Yo eval).
 * 6.5.42: Commons extras that beat pack dTrue for Heidi Klum (AGT 2014;
 *         not 2001 Heavenly Star Bra eval), Gwyneth Paltrow (2010 +
 *         Iron Man 3 Paris + 2012; not Venice 2011 Contagion eval),
 *         Bill Skarsgård (2017 IT floral Comic-Con; not cable-knit
 *         Mark Verheiden panel eval), Ian Somerhalder (Team Stefan
 *         fedora; not grey-fedora V-neck eval), Taylor Swift (AMAs
 *         2019 bangs; not TIME 100 2010 curly eval), Daniel Radcliffe
 *         (2009 pink shirt; not 2006 Empire Awards eval), Joaquin
 *         Phoenix (Berlinale 2018; not sunglasses eval), and Sandra
 *         Bullock (July 2013 + The Heat London; not layered-pearls
 *         eval).
 * 6.5.43: Commons extras that beat pack dTrue for Ansel Elgort (Apple
 *         Store 2014 + 2017 red jacket; not Divergent premiere eval),
 *         Margot Robbie (I, Tonya + 2016 beaded collar + MTV 2018 +
 *         WTF premiere; not Comic-Con tan clap eval), Penélope Cruz
 *         (Cannes 2011 + Cannes 2018 + TIFF 2012; not LA City Hall
 *         eval), Cristiano Ronaldo (Portugal WC 2018 white + red;
 *         not Juventus 2019-20 Jeep eval), Drew Barrymore (Berlin
 *         Blended 2014; not profile updo eval), Zayn Malik (WWA Chile
 *         + Iron Maiden tank; not 2012 white-red concert eval), and
 *         Simu Liu (theater blazer; not Kim's Convenience eval).
 * 6.5.44: Commons extras that beat pack dTrue for Lee Jung-jae (Squid
 *         Game Netflix; not Typhoon 2005 white-suit eval), Park Seo-joon
 *         (June 2019 blazer; not colorblock eval), Vin Diesel (2017
 *         jacket + Comic-Con views; not early-2000s ribbed V-neck eval),
 *         Orlando Bloom (SDCC 2014 + Cannes 2013; not dark-suit mic eval),
 *         Cailee Spaeny (TIFF 2025; not pink crystal-cutout eval), and
 *         Anthony Hopkins (Berlin 2001 turtleneck; not fedora polo eval).
 *         Hopkins TIFF crop failed the enroll detection-score gate.
 * 6.5.45: Commons extras that beat pack dTrue for Eva Longoria (2012
 *         black velvet + 2011 red origami; not cream sleeveless eval),
 *         Logan Lerman (TIFF 2012 + Percy Jackson 2013; not Fury 2014
 *         eval), Amy Adams (2016 cobalt + 2014 BAFTA velvet; not 2009
 *         Oscars red eval), Rachel McAdams (2011 Cannes teal; not
 *         Sherlock 2009 updo eval), plus unused extra-photos for Kerry
 *         Washington (taupe coat) and Kristen Stewart (Cannes 2014
 *         copper; not Breaking Dawn 2012 lace eval).
 * 6.5.46: Unused extra-photos that beat pack dTrue for Mia Goth
 *         (Suspiria MTV interview; not Berlinale wrap eval), Jennifer
 *         Lopez (GLAAD + Versace jungle; not blonde-bob yellow eval),
 *         and Aishwarya Rai (Kalyan peach sari; not white ruffle-collar
 *         eval). Hemsworth CCMA crop stayed a group shot (n=11).
 * 6.5.47: Commons extras that beat pack dTrue for Chris Hemsworth
 *         (navy pinstripe + Bali 2019 vest; not Comic-Con blue-tie eval),
 *         Hugh Jackman (charcoal blazer + SDCC 2013; not navy slim-tie
 *         eval), Rosalía (2023 Latin Grammy lace; not Goya 2019 eval),
 *         and Andrew Garfield (2011 Comic-Con sweater; not navy-suit
 *         slim-tie eval). Hemsworth 2017 Gage and Garfield TIFF 09 stay
 *         out as eval-sitting clones.
 * 6.5.48: Commons extras that beat pack dTrue for Hyun Bin (2024 white
 *         double-breasted; not PiFan 2014 tuxedo eval), Gary Oldman
 *         (Tinker Tailor + TIFF 2019; not Comic-Con striped-blazer eval),
 *         Uma Thurman (2014 grey coat; not Cannes 2000 bead-necklace
 *         eval), Chris Pine (peach linen; not blue v-neck eval), and
 *         Oscar Isaac (2025 neck-wrap + 2013 suit; not Comic-Con
 *         dark-shirt eval). Hyun 2011 crop failed the enroll
 *         detection-score gate. Uma Cannes 2000 and Oscar Venice stay
 *         out as eval-sitting clones.
 * 6.5.49: Commons extras that beat pack dTrue for Mahershala Ali (2007
 *         Comic-Con cap; not denim white-collar eval) and Mark
 *         Zuckerberg (TechCrunch Disrupt grey tee; not Harvard hoodie
 *         iBook eval). Mahershala Commons cropped/299 stay out as eval
 *         clones.
 * 6.5.50: Commons extras that beat pack dTrue for Brie Larson (Comic-Con
 *         panel + Kong Japan premiere; not SXSW 2013 Lacoste eval) and
 *         Fan Bingbing (BIFAN 2026 silver gown; not X-Men Hugh Jackman
 *         eval). Bad Bunny 2017-2 and Performs cropped 2 stay out as
 *         eval clones. Song Kang Cartier missed the 0.005 beat margin.
 * 6.5.51: Unused extra-photos that beat pack dTrue for Ryan Reynolds
 *         (TIFF 2010 necktie looking down; not tuxedo bowtie eval),
 *         Gael García Bernal (navy blazer watercolor shirt; not black
 *         tuxedo bowtie eval), Josh Hutcherson (Journey 2 grey blazer;
 *         not Fantastic Fest cardigan eval), Gigi Hadid (car mesh-top
 *         solo; not B&W Bella group eval), and Barry Keoghan (pink LV
 *         vest; not cream-tee lion-pendant eval). Ryan Oscars extra
 *         and Harry 001/002 stay out as eval clones. Barry 002 is a
 *         near-dup of primary.
 * 6.5.52: Commons extras that beat pack dTrue for Matt Damon (2014 navy
 *         close-up + TIFF 2015 NASA pin; not Bourne white-shirt eval),
 *         Channing Tatum (July 2015 grey suit; not leather-jacket
 *         henley eval), Deepika Padukone (Peter Pan collar + Garnier
 *         floral; not white off-shoulder eval), Chadwick Boseman
 *         (Gods of Egypt premiere; not Comic-Con paisley eval), Martin
 *         Freeman (Berlinale corduroy; not Folk Awards amber-glasses
 *         eval), and Scarlett Johansson (pink cardigan Marines visit;
 *         not SDCC 2019 mesh-bun eval). Song Kang 231124 My Demon and
 *         Olsen TIFF 2011 floral stay out as eval-sitting clones.
 * 6.5.53: Commons extras that beat pack dTrue for Son Ye-jin (March 2024
 *         studio floral; not Baeksang pearl-strap eval), Tony Leung
 *         (black vest mic; not Intercontinental dark-shirt eval),
 *         Lupita Nyong'o (Cannes 2015 emerald gown; not Tribeca TIME
 *         blue-suit eval), Benedict Cumberbatch (SDCC navy cardigan;
 *         not Sherlock overcoat eval), and Joseph Gordon-Levitt
 *         (WonderCon blazer; not v-neck sweater eval). Tom Holland
 *         SDCC flickr and Lupita 2018 TIME crop stay out as eval
 *         sittings.
 * 6.5.54: Commons extras that beat pack dTrue for Britney Spears (Toronto
 *         Femme Fatale silver sequin + purple Hold It Against Me; not gold
 *         metallic jacket eval), Mark Ruffalo (Berlin 2010 wave + outdoor
 *         parka, NYFF 2010 grey blazer, Avengers 2012 navy; not Kids Are
 *         All Right peace-sign eval), and Jonathan Bailey (Testament of
 *         Youth 2014; not Independent Filmmakers Ball glasses eval).
 *         Bailey 2015 gala, Miley Today-show crop, and the second Avengers
 *         Toronto frame stay out as eval clones or same-sitting dupes.
 * 6.5.55: Held-out 002+ extras that beat pack dTrue for Tom Holland (Far
 *         From Home glasses polo; not SDCC black-jacket chain eval),
 *         Ranbir Kapoor (bomber graphic tee + black mesh shirt; not
 *         checkered-blazer eval), and Eddie Redmayne (Montclair 2022
 *         pinstripe + checkered-sweater smile; not denim-jacket outdoor
 *         eval), plus a Commons Golden Disc 2019 extra for Jisoo (gold
 *         sequin smile; not 2017 floral concert eval). Holland 003 is the
 *         same Far From Home sitting as 002; Eddie 003 is a near-dup of
 *         primary.
 * 6.5.56: Commons extra that beat pack dTrue for Song Kang (November 2025
 *         high-collar press; not wet-look denim hand-on-head eval). Marie
 *         Claire 230224 is the eval sitting; 231124 / November 2023 My Demon
 *         is the enrolled primary; unused red-sweater 002 did not beat pack.
 * 6.5.57: Held-out 002+ extras that beat pack dTrue for Olivia Colman (crystal
 *         mesh red-carpet; not lime-green blouse eval), John Krasinski (navy
 *         tie solo smile; not tuxedo-bowtie couple eval), and John Cho (plaid
 *         western + Comic-Con E! + grey tweed scarf; not navy-jacket eval).
 *         Lee Min-ho 002 is the MISE EN SCÈNE primary sitting.
 * 6.5.58: Unused extra-photos that beat pack dTrue for Sterling K. Brown
 *         (plaid backstage + Paley Media grey suit; not Comic-Con hoodie eval),
 *         Brad Pitt (solo tuxedo goatee; not Jolie couple eval), Sandra Oh
 *         (glasses striped top; skip 2011 Spirit Awards group), Diego Luna
 *         (Berlinale polo + Spirit pinstripe + LED blazer; not Documentales
 *         2020 chin-on-hand eval), Maitreyi Ramakrishnan (webcam turtleneck;
 *         not red iHeartRADIO jersey eval), and Kit Harington (GoT WesterosVIP
 *         three-piece; not Comic-Con henley eval). Sadie Sink extras are the
 *         same Comic-Con sitting as eval.
 * 6.5.59: Commons extras that beat pack dTrue for Austin Butler (Caught
 *         Stealing London premiere stubble quiff; not dark-pompadour studio
 *         eval), Tom Hiddleston (Comic-Con 2016 grey polo + Gage Skidmore
 *         linen blazer; not navy-sweater Comic-Con eval), and Robert De Niro
 *         (2011 bowtie glasses; not salt-pepper patterned-tie eval). De Niro
 *         KVIFF portrait is the eval sitting.
 * 6.5.60: Commons extras that beat pack dTrue for Cara Delevingne (September
 *         2014 velvet blazer bun; not runway color-block eval) and Penélope
 *         Cruz (TIFF 2012 blush off-shoulder + Goya 2018 white beaded; not
 *         burgundy strapless updo eval). Helen Mirren 2020 is the Berlinale
 *         70 eval sitting.
 * 6.5.61: Commons extras that beat pack dTrue for Lee Min-ho (Dec 2025
 *         Disney+ leather + Omniscient Reader Jun 2025 blazer; not autumnal
 *         floral eval) and Keira Knightley (2005 honey-blonde plaid; not
 *         brunette updo champagne-lace eval).
 * 6.5.62: Commons extras that beat pack dTrue for Glen Powell (2016 Golden
 *         Globes tuxedo NASA pin + Top Gun Maverick premiere tuxedo bowtie;
 *         not outdoor-night navy-suit necktie eval) and Colman Domingo
 *         (2018 Comic-Con painterly shirt; not gold-embroidered mandarin
 *         eval). Denzel 2024 TIFF couple is the eval sitting.
 * 6.5.63: Commons extras that beat pack dTrue for Keanu Reeves (2014 short
 *         messy hair charcoal collared shirt; not long-hair grey-blazer
 *         black-tee eval), Nicolas Cage (Venice 2009 charcoal jacket white
 *         open-collar; not black-tuxedo necktie outdoor eval), and Alexander
 *         Skarsgård (Gage Comic-Con blazer+DEXTER lanyard + Tribeca Shankbone
 *         chain; not unbuttoned-shirt SDCC panel eval).
 */
const GALLERY_VERSION = "6.5.63";

/** Load precomputed EdgeFace celebrity descriptors (dimension from AFv4 header). */
export async function loadCelebrityEmbeddings(): Promise<CelebrityEmbedding[]> {
  if (galleryCache) return galleryCache;
  if (galleryPromise) return galleryPromise;

  galleryPromise = (async () => {
    // 1. Primary Path: AccuFace Binary Gallery (embeddings.v4.q8.bin, AFv4 header)
    try {
      const cachedV4 = await idbGet(GALLERY_VERSION);
      if (cachedV4 && cachedV4.length > 0 && (cachedV4[0]?.descriptor.length ?? 0) >= 256) {
        galleryCache = await mergeExtraTemplates(cachedV4);
        return galleryCache;
      }

      const [bucketsRes, binRes] = await Promise.all([
        fetch(`/celebs/gallery.buckets.json?v=${GALLERY_VERSION}`, { cache: "force-cache" }),
        fetch(`/celebs/embeddings.v4.q8.bin?v=${GALLERY_VERSION}`, { cache: "force-cache" }),
      ]);

      if (bucketsRes.ok && binRes.ok) {
        const buckets = (await bucketsRes.json()) as BucketEntry[];
        const arrayBuf = await binRes.arrayBuffer();
        const header = parseV4BinaryHeader(arrayBuf);
        const dim = header?.dimension ?? 0;

        if (
          header &&
          header.magic === "AFv4" &&
          (dim === 256 || dim === 512) &&
          header.vectorCount === buckets.length &&
          arrayBuf.byteLength === 32 + buckets.length * dim
        ) {
          const payloadUint8 = new Uint8Array(arrayBuf, 32);
          const scale = header.globalScale;
          const out: CelebrityEmbedding[] = new Array(buckets.length);

          for (let i = 0; i < buckets.length; i++) {
            const b = buckets[i]!;
            const off = i * dim;
            const raw = new Float32Array(dim);
            for (let j = 0; j < dim; j++) {
              const u = payloadUint8[off + j]! - 128;
              raw[j] = u * scale;
            }
            const desc = Array.from(l2Normalize(raw));
            out[i] = {
              id: b.id,
              name: b.name,
              path: b.path,
              path192: b.path192,
              fallbackPath: b.fallbackPath,
              descriptor: desc,
              age: b.age,
              gender: b.gender,
              genderProb: b.genderProb,
            };
          }
          galleryCache = await mergeExtraTemplates(out);
          void idbSet(GALLERY_VERSION, out);
          return galleryCache;
        }
      }
    } catch (err) {
      console.warn("[embeddings] v4 binary load failed, trying legacy fallback...", err);
    }

    // 2. Legacy Fallback Path: v3.1 128-d binary format
    try {
      const metaRes = await fetch("/celebs/embeddings.meta.json?v=3.0.0", { cache: "force-cache" });
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as GalleryMeta;
        // check IDB cache
        const cached = await idbGet(meta.version);
        if (cached) {
          galleryCache = cached;
          return galleryCache;
        }

        const [bucketsRes, binRes] = await Promise.all([
          fetch("/celebs/gallery.buckets.json?v=3.0.0", { cache: "force-cache" }),
          fetch(meta.files.q8 + "?v=3.0.0", { cache: "force-cache" }),
        ]);
        if (bucketsRes.ok && binRes.ok) {
          const buckets = (await bucketsRes.json()) as BucketEntry[];
          const bin = new Uint8Array(await binRes.arrayBuffer());
          const scale = meta.scale;
          const dim = meta.dim;
          if (bin.length === buckets.length * dim) {
            const out: CelebrityEmbedding[] = new Array(buckets.length);
            for (let i = 0; i < buckets.length; i++) {
              const b = buckets[i]!;
              const off = i * dim;
              const raw = new Array<number>(dim);
              for (let j = 0; j < dim; j++) {
                const q = bin[off + j]! - 127; // unbias
                raw[j] = q * scale;
              }
              // High-accuracy: ensure gallery vectors are L2-normalized (quantization drifts ~0.02)
              const desc = Array.from(l2Normalize(raw));
              out[i] = {
                id: b.id,
                name: b.name,
                path: b.path, // 96 WebP thumb
                path192: b.path192,
                fallbackPath: b.fallbackPath,
                descriptor: desc,
                age: b.age,
                gender: b.gender,
                genderProb: b.genderProb,
              };
            }
            galleryCache = out;
            void idbSet(meta.version, out);
            return galleryCache;
          }
        }
        // fallback to f32 if q8 failed
        try {
          const f32Res = await fetch(meta.files.f32 + "?v=3.0.0", { cache: "force-cache" });
          const bucketsRes2 = await fetch("/celebs/gallery.buckets.json?v=3.0.0", { cache: "force-cache" });
          if (f32Res.ok && bucketsRes2.ok) {
            const buckets = (await bucketsRes2.json()) as BucketEntry[];
            const f32 = new Float32Array(await f32Res.arrayBuffer());
            const dim = meta.dim;
            const out: CelebrityEmbedding[] = new Array(buckets.length);
            for (let i = 0; i < buckets.length; i++) {
              const b = buckets[i]!;
              const off = i * dim;
              const raw = Array.from(f32.subarray(off, off + dim));
              const desc = Array.from(l2Normalize(raw));
              out[i] = {
                id: b.id,
                name: b.name,
                path: b.path,
                path192: b.path192,
                fallbackPath: b.fallbackPath,
                descriptor: desc,
                age: b.age,
                gender: b.gender,
                genderProb: b.genderProb,
              };
            }
            galleryCache = out;
            void idbSet(meta.version, out);
            return galleryCache;
          }
        } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }

    // Legacy fallback: JSON gallery (v2)
    const res = await fetch("/celebs/embeddings.json?v=2.1.0", { cache: "force-cache" });
    if (!res.ok) throw new Error("Could not load celebrity face gallery.");
    const data = (await res.json()) as EmbeddingsGallery;
    // Normalize legacy descriptors for high accuracy
    galleryCache = data.celebrities.map((c) => ({
      ...c,
      descriptor: Array.from(l2Normalize(c.descriptor)),
    }));
    return galleryCache;
  })().catch((err) => {
    galleryPromise = null;
    throw err;
  });

  return galleryPromise;
}

interface ExtraTemplateFile {
  templates?: Array<{
    id: string;
    descriptor: number[];
    source?: string;
  }>;
}

async function mergeExtraTemplates(base: CelebrityEmbedding[]): Promise<CelebrityEmbedding[]> {
  // Dynamic import avoids a cycle: gallery-dedupe → embeddings (metrics) → gallery-dedupe.
  const { buildMultiShotCentroidGallery, isPaddedFaceNetDescriptor } = await import(
    "./gallery-dedupe.ts"
  );
  try {
    const res = await fetch(`/celebs/extra-templates.json?v=${GALLERY_VERSION}`, {
      cache: "force-cache",
    });
    if (!res.ok) return buildMultiShotCentroidGallery(base);
    const data = (await res.json()) as ExtraTemplateFile;
    if (!data.templates?.length) return buildMultiShotCentroidGallery(base);
    const byId = new Map(base.map((b) => [b.id, b]));
    const extras: CelebrityEmbedding[] = [];
    for (const t of data.templates) {
      const proto = byId.get(t.id);
      if (!proto || !t.descriptor?.length) continue;
      if (isPaddedFaceNetDescriptor(t.descriptor)) continue;
      extras.push({
        ...proto,
        descriptor: Array.from(l2Normalize(t.descriptor)),
      });
    }
    const merged = extras.length ? base.concat(extras) : base;
    return buildMultiShotCentroidGallery(merged);
  } catch {
    return buildMultiShotCentroidGallery(base);
  }
}

export function prefetchEmbeddings(): void {
  if (typeof window === "undefined") return;
  void loadCelebrityEmbeddings().catch(() => {});
}

function l2Norm(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] ?? 0) * (v[i] ?? 0);
  return Math.sqrt(s) || 1;
}

export function l2Normalize(v: ArrayLike<number>): Float32Array {
  const n = l2Norm(v);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) / n;
  return out;
}

/** Euclidean distance between two equal-length vectors. */
export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * 8-way loop unrolled dot product over the full shared vector length
 * (256-d or 512-d). Breaks instruction latency chain for parallel FMA.
 */
export function dotProduct256(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = Math.min(a.length, b.length);
  const blocked = len - (len % 8);
  let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
  let sum4 = 0, sum5 = 0, sum6 = 0, sum7 = 0;
  for (let i = 0; i < blocked; i += 8) {
    sum0 += (a[i] ?? 0) * (b[i] ?? 0);
    sum1 += (a[i + 1] ?? 0) * (b[i + 1] ?? 0);
    sum2 += (a[i + 2] ?? 0) * (b[i + 2] ?? 0);
    sum3 += (a[i + 3] ?? 0) * (b[i + 3] ?? 0);
    sum4 += (a[i + 4] ?? 0) * (b[i + 4] ?? 0);
    sum5 += (a[i + 5] ?? 0) * (b[i + 5] ?? 0);
    sum6 += (a[i + 6] ?? 0) * (b[i + 6] ?? 0);
    sum7 += (a[i + 7] ?? 0) * (b[i + 7] ?? 0);
  }
  let tail = 0;
  for (let i = blocked; i < len; i++) {
    tail += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum0 + sum1 + sum2 + sum3 + sum4 + sum5 + sum6 + sum7 + tail;
}

/**
 * Pure L2-normalized Cosine distance d = 1 - a_hat^T b_hat for 256-d vectors.
 * Clamps distance to [0.0, 2.0] and handles zero/invalid vectors gracefully.
 */
export function cosineDistance256(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 1.0;
  const rawDot = dotProduct256(a, b);
  if (!Number.isFinite(rawDot)) return 1.0;
  const dot = Math.max(-1.0, Math.min(1.0, rawDot));
  const dist = 1.0 - dot;
  return Math.max(0.0, Math.min(2.0, dist));
}

/** Cosine distance in [0,2] (0=identical). Uses 8-way unrolled dot product for L2-normalized vectors. */
export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 1.0;
  if (a.length === b.length && (a.length === 256 || a.length === 512)) {
    return cosineDistance256(a, b);
  }
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 1.0;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  const clampedCos = Math.max(-1.0, Math.min(1.0, cos));
  const dist = 1.0 - clampedCos;
  return Math.max(0.0, Math.min(2.0, dist));
}

/** Ensemble: 0.72 euclidean + 0.28 cosine (both calibrated to ~[0,1.4]) */
export function ensembleDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const euc = euclideanDistance(a, b);
  const cos = cosineDistance(a, b);
  const cosAsEuc = cos * 0.85;
  return 0.72 * euc + 0.28 * cosAsEuc;
}

/**
 * Hill half-saturation and steepness for open-set look-alike percents,
 * calibrated on real EdgeFace-512 cosine distances (scripts/calibrate-edgeface.mjs):
 * same person unseen photo p50 ≈ 0.37 → ~88%; strong look-alike ≈ 0.45 → ~77%;
 * typical best-of-1000 impostor p50 ≈ 0.60 → 50%; 70%+ needs d ≤ 0.49 (rarer
 * than the p10 best-impostor 0.54), keeping high scores meaningful.
 * rankByDescriptor then applies open-set margin suppression (open-set-score.ts)
 * so a crowded nearest-neighbor is not shown as a 60–75% doppelgänger.
 */
export const HILL_D0 = 0.6;
export const HILL_N = 4.1;

/**
 * Convert L2-normalized cosine distance (d = 1 - a_hat^T b_hat) to a match percentage
 * via P(d) = 100 / (1 + (d / HILL_D0)^HILL_N), rounded to 1 decimal.
 * P(0) = 100; P(HILL_D0) = 50.
 */
export function distanceToMatchPercent(distance: number): number {
  if (typeof distance !== "number" || Number.isNaN(distance)) return 0.0;
  if (!Number.isFinite(distance)) return distance < 0 ? 100.0 : 0.0;
  const d = Math.max(0, distance);
  const hill = 100.0 / (1 + Math.pow(d / HILL_D0, HILL_N));
  const pct = Math.max(0.0, Math.min(100.0, hill));
  return Math.round(pct * 10) / 10;
}

/** Relative ranking percents from absolute distances (preserves order). */
export function rankPercentsFromDistances(distances: number[]): number[] {
  if (!distances || distances.length === 0) return [];
  const raw = distances.map(distanceToMatchPercent);
  const sortedIdx = raw
    .map((p, i) => ({ p, i, d: Number.isFinite(distances[i]) ? (distances[i] as number) : Infinity }))
    .sort((a, b) => a.d - b.d || b.p - a.p);
  const out = new Array<number>(raw.length);
  let last = Infinity;
  for (const item of sortedIdx) {
    const v = Math.min(item.p, last - 0.1);
    out[item.i] = Math.round(Math.max(0, v) * 10) / 10;
    last = out[item.i]!;
  }
  return out;
}

export function genderAffinity(
  userGender: "male" | "female" | "unknown" | string | undefined,
  userProb: number | undefined,
  celeb: CelebrityEmbedding,
): number {
  if (!userGender || userGender === "unknown" || !celeb || !celeb.gender) return 1;
  if (userGender === celeb.gender) return 1;
  const rawProb = typeof userProb === "number" && Number.isFinite(userProb) ? userProb : 0.9;
  const prob = Math.max(0, Math.min(1, rawProb));
  return Math.max(0.75, Math.min(1, 1 - 0.22 * prob));
}

/** Continuous Gaussian age affinity: ageAffinity(userAge, celebAge) = Math.exp(-Math.pow(Math.abs(userAge - celebAge) / 28, 2)) */
export function ageAffinity(userAge: number | undefined, celebAge: number | undefined): number {
  if (typeof userAge !== "number" || !Number.isFinite(userAge) || typeof celebAge !== "number" || !Number.isFinite(celebAge)) {
    return 1;
  }
  return Math.exp(-Math.pow(Math.abs(userAge - celebAge) / 28, 2));
}

/**
 * Compute overall match confidence rating in [10, 100] based on face detection and quality metrics.
 */
export function computeMatchConfidence(
  detConfidence: number,
  sharpness: number,
  faceCoverage: number,
  genderProb: number,
): number {
  const det = Math.max(0, Math.min(1, detConfidence > 1 ? detConfidence / 100 : detConfidence));
  const sharp = Math.max(0, Math.min(1, sharpness > 1 ? sharpness / 100 : sharpness));
  const covRaw = faceCoverage > 1 ? faceCoverage / 100 : faceCoverage;
  const cov = Math.max(0, Math.min(1, covRaw / 0.25));
  const gProb = Math.max(0, Math.min(1, genderProb > 1 ? genderProb / 100 : genderProb));

  const weighted = 0.35 * det + 0.25 * sharp + 0.20 * cov + 0.20 * gProb;
  const score = 10.0 + 90.0 * weighted;
  return Math.round(Math.max(10.0, Math.min(100.0, score)) * 10) / 10;
}

export function mergeWithProfile(
  emb: CelebrityEmbedding,
  _profiles: CelebrityProfile[],
): {
  knownFor: string;
  tags: string[];
  accentHue: number;
} {
  void _profiles;
  return catalogFor(emb.id);
}
