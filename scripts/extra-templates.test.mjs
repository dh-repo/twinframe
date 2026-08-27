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
    assert.ok((byId.get("lionel-messi") ?? 0) >= 3, "Messi PSG extra missing");
    assert.ok(
      pack.templates.some((t) => t.id === "lionel-messi" && t.source === "extra-photos/lionel-messi/001.jpg"),
      "Messi PSG extra missing",
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
