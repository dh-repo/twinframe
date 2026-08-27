import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cosineDistance, l2Normalize } from "./lib/gallery-binary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTRAS = path.join(ROOT, "public/celebs/extra-templates.json");

describe("shipped extra templates", () => {
  const pack = JSON.parse(fs.readFileSync(EXTRAS, "utf8"));

  it("is AdaFace-512 and no longer an empty EdgeFace stub", () => {
    assert.match(String(pack.model), /AdaFace/i);
    assert.equal(pack.dim, 512);
    assert.ok(pack.templates.length >= 130, `expected extras, got ${pack.templates.length}`);
    for (const t of pack.templates) {
      assert.equal(t.descriptor.length, 512, t.id);
      assert.ok(t.source && !t.source.includes("held-out/001"), `eval probe enrolled as extra: ${t.source}`);
    }
  });

  it("covers weak Rank-1 household names with gated extra views", () => {
    const byId = new Map();
    for (const t of pack.templates) {
      byId.set(t.id, (byId.get(t.id) ?? 0) + 1);
    }
    assert.ok((byId.get("adele") ?? 0) >= 5, "Adele 19-era extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "adele" && t.source === "extra-photos/adele/003.jpg"),
      "Adele Live 2009 turtleneck extra missing",
    );
    assert.ok((byId.get("doja-cat") ?? 0) >= 5, "Doja extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "doja-cat" && t.source === "extra-photos/doja-cat/003.jpg"),
      "Doja Scarlet-era 2024 extra missing",
    );
    assert.ok((byId.get("zendaya") ?? 0) >= 3, "Zendaya extras missing");
    assert.ok((byId.get("justin-bieber") ?? 0) >= 1, "Bieber extras missing");
    assert.ok((byId.get("lady-gaga") ?? 0) >= 1, "Gaga extras missing");
    assert.ok((byId.get("al-pacino") ?? 0) >= 2, "Pacino extras missing");
    assert.ok((byId.get("jeff-bezos") ?? 0) >= 1, "Bezos extras missing");
    assert.ok((byId.get("jodie-comer") ?? 0) >= 1, "Comer extras missing");
    assert.ok((byId.get("dua-lipa") ?? 0) >= 3, "Dua extras missing");
    assert.ok((byId.get("selena-gomez") ?? 0) >= 1, "Selena extras missing");
    assert.ok((byId.get("alia-bhatt") ?? 0) >= 2, "Alia extras missing");
    assert.ok((byId.get("don-cheadle") ?? 0) >= 1, "Cheadle extras missing");
    assert.ok((byId.get("karol-g") ?? 0) >= 3, "Karol G 2018-era extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "karol-g" && t.source === "extra-photos/karol-g/003.jpg"),
      "Karol G 2018 NTN interview extra missing",
    );
    assert.ok((byId.get("ben-affleck") ?? 0) >= 1, "Ben Affleck 1998 extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "ben-affleck" && t.source === "extra-photos/ben-affleck/002.jpg"),
      "Ben Affleck 1998 extra missing",
    );
    assert.ok((byId.get("steve-carell") ?? 0) >= 3, "Steve Carell 2010-era extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "steve-carell" && t.source === "extra-photos/steve-carell/003.jpg"),
      "Steve Carell 2010 extra missing",
    );
    assert.ok((byId.get("ana-de-armas") ?? 0) >= 3, "Ana de Armas extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "ana-de-armas" && t.source === "extra-photos/ana-de-armas/004.jpg"),
      "Ana de Armas 2017 Comic-Con extra missing",
    );
    assert.ok((byId.get("lisa-blackpink") ?? 0) >= 2, "Lisa extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "lisa-blackpink" && t.source === "extra-photos/lisa-blackpink/001.jpg"),
      "Lisa 2024 cropped extra missing",
    );
    assert.ok((byId.get("dakota-johnson") ?? 0) >= 2, "Dakota extras missing");
    assert.ok((byId.get("miles-teller") ?? 0) >= 2, "Miles extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "miles-teller" && t.source === "held-out/miles-teller/004.jpg"),
      "Miles Teller panel extra missing",
    );
    assert.ok((byId.get("dev-patel") ?? 0) >= 2, "Dev Patel extras missing");
    assert.ok((byId.get("bella-hadid") ?? 0) >= 2, "Bella extras missing");
    assert.ok((byId.get("hugh-grant") ?? 0) >= 1, "Hugh Grant extra missing");
    assert.ok((byId.get("nicki-minaj") ?? 0) >= 1, "Nicki extra missing");
    assert.ok((byId.get("antonio-banderas") ?? 0) >= 1, "Antonio Banderas 2020 extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "antonio-banderas" && t.source === "extra-photos/antonio-banderas/001.jpg"),
      "Antonio Banderas 2020 Goya extra missing",
    );
    assert.ok((byId.get("nicole-kidman") ?? 0) >= 3, "Nicole Kidman extras missing");
    assert.ok((byId.get("elizabeth-olsen") ?? 0) >= 2, "Elizabeth Olsen extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "elizabeth-olsen" && t.source === "extra-photos/elizabeth-olsen/001.jpg"),
      "Elizabeth Olsen 2018 extra missing",
    );
    assert.ok((byId.get("sofia-vergara") ?? 0) >= 1, "Sofia Vergara PaleyFest extra missing");
    assert.ok((byId.get("chris-evans") ?? 0) >= 2, "Chris Evans extras missing");
    assert.ok((byId.get("cardi-b") ?? 0) >= 1, "Cardi B 2021 extra missing");
    assert.ok((byId.get("maluma") ?? 0) >= 2, "Maluma 2017 extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "maluma" && t.source === "extra-photos/maluma/006.jpg"),
      "Maluma Viña 2017 extra missing",
    );
    assert.ok((byId.get("beyonce") ?? 0) >= 2, "Beyoncé extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "beyonce" && t.source === "extra-photos/beyonce/004.jpg"),
      "Beyoncé Newcastle 2009 extra missing",
    );
    assert.ok((byId.get("gemma-chan") ?? 0) >= 2, "Gemma Chan extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "gemma-chan" && t.source === "extra-photos/gemma-chan/001.jpg"),
      "Gemma Chan BIFA 2014 extra missing",
    );
    assert.ok((byId.get("harry-styles") ?? 0) >= 1, "Harry Styles extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "harry-styles" && t.source === "extra-photos/harry-styles/003.jpg"),
      "Harry Styles November 2014 extra missing",
    );
    assert.ok((byId.get("serena-williams") ?? 0) >= 1, "Serena extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "serena-williams" && t.source === "extra-photos/serena-williams/006.jpg"),
      "Serena Doha 2013 extra missing",
    );
    assert.ok((byId.get("donald-glover") ?? 0) >= 4, "Glover concert extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "donald-glover" && t.source === "extra-photos/donald-glover/001.jpg"),
      "Glover concert product-crop extra missing",
    );
    assert.ok((byId.get("julia-roberts") ?? 0) >= 4, "Julia Roberts extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "julia-roberts" && t.source === "extra-photos/julia-roberts/001.jpg"),
      "Julia Roberts 2011 Shankbone extra missing",
    );
    assert.ok((byId.get("ariana-grande") ?? 0) >= 3, "Ariana Jakarta extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "ariana-grande" && t.source === "extra-photos/ariana-grande/001.jpg"),
      "Ariana Honeymoon Tour Jakarta extra missing",
    );
    assert.ok((byId.get("sebastian-stan") ?? 0) >= 4, "Sebastian Stan extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "sebastian-stan" && t.source === "extra-photos/sebastian-stan/001.jpg"),
      "Sebastian Stan 2026 Cannes extra missing",
    );
    assert.ok((byId.get("lionel-messi") ?? 0) >= 4, "Messi extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "lionel-messi" && t.source === "extra-photos/lionel-messi/001.jpg"),
      "Messi PSG extra missing",
    );
    assert.ok(
      pack.templates.some((t) => t.id === "lionel-messi" && t.source === "extra-photos/lionel-messi/002.jpg"),
      "Messi Inter Miami extra missing",
    );
    assert.ok((byId.get("kendrick-lamar") ?? 0) >= 4, "Kendrick concert extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "kendrick-lamar" && t.source === "extra-photos/kendrick-lamar/001.jpg"),
      "Kendrick Pitchfork 2012 extra missing",
    );
    assert.ok(
      pack.templates.some((t) => t.id === "kendrick-lamar" && t.source === "extra-photos/kendrick-lamar/003.jpg"),
      "Kendrick FIB 2016 extra missing",
    );
    assert.ok((byId.get("martin-scorsese") ?? 0) >= 2, "Scorsese extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "martin-scorsese" && t.source === "extra-photos/martin-scorsese/001.jpg"),
      "Scorsese glasses studio extra missing",
    );
    assert.ok((byId.get("florence-pugh") ?? 0) >= 3, "Florence extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "florence-pugh" && t.source === "held-out/florence-pugh/003.jpg"),
      "Florence BFI LFF held-out extra missing",
    );
    assert.ok(
      pack.templates.some((t) => t.id === "florence-pugh" && t.source === "extra-photos/florence-pugh/005.jpg"),
      "Florence 2024 TIFF extra missing",
    );
    assert.ok((byId.get("priyanka-chopra") ?? 0) >= 2, "Priyanka extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "priyanka-chopra" && t.source === "held-out/priyanka-chopra/002.jpg"),
      "Priyanka teal strapless extra missing",
    );
    assert.ok(
      pack.templates.some((t) => t.id === "priyanka-chopra" && t.source === "extra-photos/priyanka-chopra/002.jpg"),
      "Priyanka interview extra missing",
    );
    assert.ok((byId.get("anne-hathaway") ?? 0) >= 1, "Anne Hathaway extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "anne-hathaway" && t.source === "extra-photos/anne-hathaway/003.jpg"),
      "Anne Hathaway long-hair extra missing",
    );
    assert.ok((byId.get("ryan-gosling") ?? 0) >= 3, "Ryan Gosling extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "ryan-gosling" && t.source === "held-out/ryan-gosling/002.jpg"),
      "Ryan Gosling denim Comic-Con extra missing",
    );
    assert.ok((byId.get("leonardo-dicaprio") ?? 0) >= 2, "Leonardo extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "leonardo-dicaprio" && t.source === "held-out/leonardo-dicaprio/002.jpg"),
      "Leonardo held-out 002 extra missing",
    );
    assert.ok((byId.get("sydney-sweeney") ?? 0) >= 1, "Sydney Sweeney extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "sydney-sweeney" && t.source === "extra-photos/sydney-sweeney/002.jpg"),
      "Sydney Sweeney TIFF 2024 floral extra missing",
    );
    assert.ok((byId.get("johnny-depp") ?? 0) >= 1, "Johnny Depp extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "johnny-depp" && t.source === "extra-photos/johnny-depp/005.jpg"),
      "Johnny Depp Cannes 2023 extra missing",
    );
    assert.ok((byId.get("lebron-james") ?? 0) >= 2, "LeBron extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "lebron-james" && t.source === "extra-photos/lebron-james/005.jpg"),
      "LeBron Olympics 2024 extra missing",
    );
    assert.ok((byId.get("adam-sandler") ?? 0) >= 1, "Adam Sandler extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "adam-sandler" && t.source === "extra-photos/adam-sandler/003.jpg"),
      "Adam Sandler 2018 extra missing",
    );
    assert.ok((byId.get("cole-sprouse") ?? 0) >= 2, "Cole Sprouse extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "cole-sprouse" && t.source === "extra-photos/cole-sprouse/001.jpg"),
      "Cole Sprouse Tribeca 2026 extra missing",
    );
    assert.ok((byId.get("bradley-cooper") ?? 0) >= 1, "Bradley Cooper extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "bradley-cooper" && t.source === "extra-photos/bradley-cooper/001.jpg"),
      "Bradley Cooper NYFF 2023 extra missing",
    );
    assert.ok((byId.get("jennie-kim") ?? 0) >= 5, "Jennie extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "jennie-kim" && t.source === "extra-photos/jennie-kim/001.jpg"),
      "Jennie 2018 fansign extra missing",
    );
    assert.ok((byId.get("roger-federer") ?? 0) >= 1, "Federer extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "roger-federer" && t.source === "extra-photos/roger-federer/008.jpg"),
      "Federer AO 2014 extra missing",
    );
    assert.ok((byId.get("kate-middleton") ?? 0) >= 3, "Kate extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "kate-middleton" && t.source === "extra-photos/kate-middleton/001.jpg"),
      "Kate 2023 portrait extra missing",
    );
    assert.ok((byId.get("kate-winslet") ?? 0) >= 2, "Kate Winslet extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "kate-winslet" && t.source === "extra-photos/kate-winslet/001.jpg"),
      "Kate Winslet 2023 extra missing",
    );
    assert.ok((byId.get("the-weeknd") ?? 0) >= 1, "The Weeknd extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "the-weeknd" && t.source === "extra-photos/the-weeknd/006.jpg"),
      "The Weeknd Cannes 2023 extra missing",
    );
    assert.ok((byId.get("vanessa-kirby") ?? 0) >= 2, "Vanessa Kirby extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "vanessa-kirby" && t.source === "extra-photos/vanessa-kirby/001.jpg"),
      "Vanessa Kirby 2018 extra missing",
    );
    assert.ok((byId.get("awkwafina") ?? 0) >= 2, "Awkwafina extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "awkwafina" && t.source === "extra-photos/awkwafina/001.jpg"),
      "Awkwafina 2018 extra missing",
    );
    assert.ok((byId.get("adriana-lima") ?? 0) >= 1, "Adriana Lima extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "adriana-lima" && t.source === "extra-photos/adriana-lima/004.jpg"),
      "Adriana Lima 2011 extra missing",
    );
    assert.ok((byId.get("tom-hanks") ?? 0) >= 2, "Tom Hanks extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "tom-hanks" && t.source === "extra-photos/tom-hanks/001.jpg"),
      "Tom Hanks 2016 extra missing",
    );
    assert.ok((byId.get("hrithik-roshan") ?? 0) >= 3, "Hrithik extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "hrithik-roshan" && t.source === "extra-photos/hrithik-roshan/001.jpg"),
      "Hrithik 2019 extra missing",
    );
    assert.ok((byId.get("steve-carell") ?? 0) >= 4, "Steve Carell extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "steve-carell" && t.source === "extra-photos/steve-carell/005.jpg"),
      "Steve Carell 2014 extra missing",
    );
    assert.ok((byId.get("lady-gaga") ?? 0) >= 2, "Gaga extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "lady-gaga" && t.source === "extra-photos/lady-gaga/006.jpg"),
      "Lady Gaga JWT Toronto extra missing",
    );
    assert.ok((byId.get("heidi-klum") ?? 0) >= 1, "Heidi Klum extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "heidi-klum" && t.source === "extra-photos/heidi-klum/001.jpg"),
      "Heidi Klum AGT 2014 extra missing",
    );
    assert.ok((byId.get("gwyneth-paltrow") ?? 0) >= 3, "Gwyneth extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "gwyneth-paltrow" && t.source === "extra-photos/gwyneth-paltrow/006.jpg"),
      "Gwyneth 2010 extra missing",
    );
    assert.ok((byId.get("bill-skarsgard") ?? 0) >= 1, "Bill Skarsgård extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "bill-skarsgard" && t.source === "extra-photos/bill-skarsgard/001.jpg"),
      "Bill Skarsgård 2017 floral extra missing",
    );
    assert.ok((byId.get("ian-somerhalder") ?? 0) >= 1, "Ian Somerhalder extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "ian-somerhalder" && t.source === "extra-photos/ian-somerhalder/001.jpg"),
      "Ian Somerhalder Team Stefan extra missing",
    );
    assert.ok((byId.get("taylor-swift") ?? 0) >= 1, "Taylor Swift extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "taylor-swift" && t.source === "extra-photos/taylor-swift/001.jpg"),
      "Taylor Swift AMAs 2019 extra missing",
    );
    assert.ok((byId.get("daniel-radcliffe") ?? 0) >= 1, "Daniel Radcliffe extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "daniel-radcliffe" && t.source === "extra-photos/daniel-radcliffe/006.jpg"),
      "Daniel Radcliffe 2009 extra missing",
    );
    assert.ok((byId.get("joaquin-phoenix") ?? 0) >= 1, "Joaquin Phoenix extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "joaquin-phoenix" && t.source === "extra-photos/joaquin-phoenix/001.jpg"),
      "Joaquin Phoenix Berlinale 2018 extra missing",
    );
    assert.ok((byId.get("sandra-bullock") ?? 0) >= 2, "Sandra Bullock extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "sandra-bullock" && t.source === "extra-photos/sandra-bullock/001.jpg"),
      "Sandra Bullock July 2013 extra missing",
    );
    assert.ok((byId.get("ansel-elgort") ?? 0) >= 2, "Ansel Elgort extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "ansel-elgort" && t.source === "extra-photos/ansel-elgort/004.jpg"),
      "Ansel Elgort Apple Store 2014 extra missing",
    );
    assert.ok((byId.get("margot-robbie") ?? 0) >= 4, "Margot Robbie extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "margot-robbie" && t.source === "extra-photos/margot-robbie/002.jpg"),
      "Margot Robbie I, Tonya extra missing",
    );
    assert.ok((byId.get("penelope-cruz") ?? 0) >= 3, "Penélope Cruz extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "penelope-cruz" && t.source === "extra-photos/penelope-cruz/001.jpg"),
      "Penélope Cruz Cannes 2011 extra missing",
    );
    assert.ok((byId.get("cristiano-ronaldo") ?? 0) >= 2, "Cristiano Ronaldo extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "cristiano-ronaldo" && t.source === "extra-photos/cristiano-ronaldo/001.jpg"),
      "Cristiano Ronaldo Portugal 2018 extra missing",
    );
    assert.ok((byId.get("drew-barrymore") ?? 0) >= 2, "Drew Barrymore extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "drew-barrymore" && t.source === "extra-photos/drew-barrymore/002.jpg"),
      "Drew Barrymore Berlin 2014 extra missing",
    );
    assert.ok((byId.get("zayn-malik") ?? 0) >= 2, "Zayn Malik extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "zayn-malik" && t.source === "extra-photos/zayn-malik/001.jpg"),
      "Zayn Malik WWA Chile extra missing",
    );
    assert.ok((byId.get("simu-liu") ?? 0) >= 1, "Simu Liu extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "simu-liu" && t.source === "extra-photos/simu-liu/001.jpg"),
      "Simu Liu theater extra missing",
    );
    assert.ok((byId.get("lee-jung-jae") ?? 0) >= 1, "Lee Jung-jae extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "lee-jung-jae" && t.source === "extra-photos/lee-jung-jae/001.jpg"),
      "Lee Jung-jae Squid Game extra missing",
    );
    assert.ok((byId.get("park-seo-joon") ?? 0) >= 1, "Park Seo-joon extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "park-seo-joon" && t.source === "extra-photos/park-seo-joon/001.jpg"),
      "Park Seo-joon 2019 extra missing",
    );
    assert.ok((byId.get("vin-diesel") ?? 0) >= 3, "Vin Diesel extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "vin-diesel" && t.source === "extra-photos/vin-diesel/003.jpg"),
      "Vin Diesel 2017 extra missing",
    );
    assert.ok((byId.get("orlando-bloom") ?? 0) >= 2, "Orlando Bloom extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "orlando-bloom" && t.source === "extra-photos/orlando-bloom/001.jpg"),
      "Orlando Bloom SDCC 2014 extra missing",
    );
    assert.ok((byId.get("cailee-spaeny") ?? 0) >= 1, "Cailee Spaeny extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "cailee-spaeny" && t.source === "extra-photos/cailee-spaeny/001.jpg"),
      "Cailee Spaeny TIFF 2025 extra missing",
    );
    assert.ok((byId.get("anthony-hopkins") ?? 0) >= 1, "Anthony Hopkins extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "anthony-hopkins" && t.source === "extra-photos/anthony-hopkins/002.jpg"),
      "Anthony Hopkins Berlin 2001 extra missing",
    );
    assert.ok((byId.get("eva-longoria") ?? 0) >= 2, "Eva Longoria extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "eva-longoria" && t.source === "extra-photos/eva-longoria/001.jpg"),
      "Eva Longoria 2012 extra missing",
    );
    assert.ok((byId.get("logan-lerman") ?? 0) >= 2, "Logan Lerman extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "logan-lerman" && t.source === "extra-photos/logan-lerman/001.jpg"),
      "Logan Lerman TIFF 2012 extra missing",
    );
    assert.ok((byId.get("amy-adams") ?? 0) >= 2, "Amy Adams extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "amy-adams" && t.source === "extra-photos/amy-adams/001.jpg"),
      "Amy Adams 2016 extra missing",
    );
    assert.ok((byId.get("rachel-mcadams") ?? 0) >= 1, "Rachel McAdams extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "rachel-mcadams" && t.source === "extra-photos/rachel-mcadams/001.jpg"),
      "Rachel McAdams 2011 Cannes extra missing",
    );
    assert.ok((byId.get("kerry-washington") ?? 0) >= 1, "Kerry Washington extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "kerry-washington" && t.source === "extra-photos/kerry-washington/002.jpg"),
      "Kerry Washington taupe-coat extra missing",
    );
    assert.ok((byId.get("kristen-stewart") ?? 0) >= 1, "Kristen Stewart extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "kristen-stewart" && t.source === "extra-photos/kristen-stewart/002.jpg"),
      "Kristen Stewart Cannes 2014 extra missing",
    );
    assert.ok((byId.get("mia-goth") ?? 0) >= 1, "Mia Goth extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "mia-goth" && t.source === "extra-photos/mia-goth/005.jpg"),
      "Mia Goth Suspiria extra missing",
    );
    assert.ok((byId.get("jennifer-lopez") ?? 0) >= 2, "Jennifer Lopez extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "jennifer-lopez" && t.source === "extra-photos/jennifer-lopez/001.jpg"),
      "Jennifer Lopez GLAAD extra missing",
    );
    assert.ok((byId.get("aishwarya-rai") ?? 0) >= 1, "Aishwarya Rai extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "aishwarya-rai" && t.source === "extra-photos/aishwarya-rai/004.jpg"),
      "Aishwarya Rai Kalyan extra missing",
    );
    assert.ok((byId.get("chris-hemsworth") ?? 0) >= 2, "Chris Hemsworth extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "chris-hemsworth" && t.source === "extra-photos/chris-hemsworth/001.jpg"),
      "Chris Hemsworth pinstripe extra missing",
    );
    assert.ok((byId.get("hugh-jackman") ?? 0) >= 2, "Hugh Jackman extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "hugh-jackman" && t.source === "extra-photos/hugh-jackman/001.jpg"),
      "Hugh Jackman suit extra missing",
    );
    assert.ok((byId.get("rosalia") ?? 0) >= 1, "Rosalía extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "rosalia" && t.source === "extra-photos/rosalia/001.jpg"),
      "Rosalía 2023 Latin Grammy extra missing",
    );
    assert.ok((byId.get("andrew-garfield") ?? 0) >= 1, "Andrew Garfield extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "andrew-garfield" && t.source === "extra-photos/andrew-garfield/001.jpg"),
      "Andrew Garfield 2011 extra missing",
    );
    assert.ok((byId.get("hyun-bin") ?? 0) >= 1, "Hyun Bin extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "hyun-bin" && t.source === "extra-photos/hyun-bin/002.jpg"),
      "Hyun Bin 2024 extra missing",
    );
    assert.ok((byId.get("gary-oldman") ?? 0) >= 2, "Gary Oldman extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "gary-oldman" && t.source === "extra-photos/gary-oldman/001.jpg"),
      "Gary Oldman Tinker Tailor extra missing",
    );
    assert.ok((byId.get("uma-thurman") ?? 0) >= 1, "Uma Thurman extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "uma-thurman" && t.source === "extra-photos/uma-thurman/001.jpg"),
      "Uma Thurman 2014 extra missing",
    );
    assert.ok((byId.get("chris-pine") ?? 0) >= 1, "Chris Pine extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "chris-pine" && t.source === "extra-photos/chris-pine/001.jpg"),
      "Chris Pine peach-linen extra missing",
    );
    assert.ok((byId.get("oscar-isaac") ?? 0) >= 2, "Oscar Isaac extras missing");
    assert.ok(
      pack.templates.some((t) => t.id === "oscar-isaac" && t.source === "extra-photos/oscar-isaac/001.jpg"),
      "Oscar Isaac 2025 extra missing",
    );
    assert.equal(byId.has("leon-rippy"), false, "thumb-only namesake must not gain extras");
  });

  it("does not enroll a byte-duplicate of any held-out 001 eval probe", () => {
    const leaks = [];
    for (const t of pack.templates) {
      const extra = path.join(ROOT, "public/celebs", t.source);
      const probe = path.join(ROOT, "public/celebs/held-out", t.id, "001.jpg");
      if (!fs.existsSync(extra) || !fs.existsSync(probe)) continue;
      const a = fs.readFileSync(extra);
      const b = fs.readFileSync(probe);
      if (a.equals(b)) leaks.push(`${t.id}:${t.source}`);
    }
    assert.deepEqual(leaks, [], `eval probe leaked into extras: ${leaks.join(", ")}`);
  });

  it("does not enroll a near-clone of held-out 001", () => {
    const probes = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public/celebs/held-out/descriptors.json"), "utf8"),
    );
    const byId = new Map();
    for (const c of probes.cases ?? []) {
      if (!c.descriptor?.length || c.ok === false) continue;
      const src = String(c.source ?? "");
      if (!src.includes("/001.")) continue;
      byId.set(c.id, l2Normalize(c.descriptor));
    }
    const close = [];
    for (const t of pack.templates) {
      const probe = byId.get(t.id);
      if (!probe) continue;
      const d = cosineDistance(l2Normalize(t.descriptor), probe);
      if (d < 0.05) close.push(`${t.id}:${t.source} d=${d.toFixed(4)}`);
    }
    assert.deepEqual(close, [], `eval near-clone extra: ${close.join("; ")}`);
  });
});
