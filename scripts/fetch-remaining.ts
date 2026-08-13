#!/usr/bin/tsx
/**
 * Fetch unused Commons portraits for Weeknd gallery re-enroll,
 * Adele control, unencoded held-out, and empty held-out dirs.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TwinframeRemaining/1.0 (local accuracy eval) Node.js";

type Job = { dest: string; files: string[] };

const JOBS: Job[] = [
  {
    dest: "the-weeknd-new.jpg",
    files: [
      "FEQ July 2018 The Weeknd (44778856382) (cropped).jpg",
      "The Weeknd (253662129).jpeg",
      "The Weeknd Universal Studios Hollywood.jpg",
      "The Weeknd by David Hwang.jpg",
      "The Weeknd (cropped).jpg",
    ],
  },
  {
    dest: "control/adele/001.jpg",
    files: [
      "Adele - Seattle, WA - 8.12.2011 (cropped).jpg",
      "Adele Feb 24 23 (cropped).jpg",
      "Adele.jpg",
      "Adele - Live 2009 (4).jpg",
    ],
  },
  {
    dest: "held-out/adele/001.jpg",
    files: ["Adele - Seattle, WA - 8.12.2011 (cropped).jpg", "Adele - Live 2009 (4).jpg"],
  },
  {
    dest: "held-out/oscar-isaac/001.jpg",
    files: [
      "Oscar Isaac by Gage Skidmore 2.jpg",
      "Oscar Isaac 2015.jpg",
      "OscarIsaac2011.jpg",
      "Oscar Isaac Cannes 2015.jpg",
    ],
  },
  {
    dest: "held-out/george-clooney/001.jpg",
    files: [
      "George Clooney 2016.jpg",
      "GeorgeClooneyOct08.jpg",
      "George Clooney 2012.jpg",
      "George Clooney Cannes 2016.jpg",
    ],
  },
  {
    dest: "held-out/barack-obama/001.jpg",
    files: [
      "President Barack Obama.jpg",
      "Barack Obama 2012.jpg",
      "BarackObama2005portrait.jpg",
      "Barack Obama 2016.jpg",
    ],
  },
  {
    dest: "held-out/gal-gadot/001.jpg",
    files: [
      "Gal Gadot by Gage Skidmore 2.jpg",
      "Gal Gadot 2018.jpg",
      "GalGadot2017.jpg",
      "Gal Gadot Cannes 2018.jpg",
    ],
  },
  {
    dest: "held-out/chris-hemsworth/001.jpg",
    files: [
      "Chris Hemsworth by Gage Skidmore 2.jpg",
      "ChrisHemsworthJun09.jpg",
      "Chris Hemsworth 2016.jpg",
    ],
  },
  {
    dest: "held-out/henry-cavill/001.jpg",
    files: [
      "Henry Cavill by Gage Skidmore.jpg",
      "HenryCavill2013.jpg",
      "Henry Cavill 2018.jpg",
    ],
  },
  {
    dest: "held-out/the-weeknd/001.jpg",
    files: [
      "The Weeknd (253662129).jpeg",
      "The Weeknd Universal Studios Hollywood.jpg",
    ],
  },
  {
    dest: "held-out/idris-elba/001.jpg",
    files: ["Idris Elba 2018.jpg", "IdrisElba2014.jpg", "Idris Elba 2016.jpg"],
  },
  {
    dest: "held-out/keanu-reeves/001.jpg",
    files: ["Keanu Reeves 2019.jpg", "KeanuReevesJun09.jpg", "Keanu Reeves 2015.jpg"],
  },
  {
    dest: "held-out/timothee-chalamet/001.jpg",
    files: [
      "Timothée Chalamet 2018.jpg",
      "Timothee Chalamet 2019.jpg",
      "Timothée Chalamet Cannes 2018.jpg",
    ],
  },
  {
    dest: "held-out/emma-stone/001.jpg",
    files: ["Emma Stone 2018.jpg", "EmmaStone2014.jpg", "Emma Stone Cannes 2015.jpg"],
  },
  {
    dest: "held-out/viola-davis/001.jpg",
    files: ["Viola Davis 2016.jpg", "ViolaDavis2010.jpg", "Viola Davis 2018.jpg"],
  },
  {
    dest: "held-out/angelina-jolie/001.jpg",
    files: ["Angelina Jolie 2014.jpg", "AngelinaJolie2010.jpg", "Angelina Jolie 2019.jpg"],
  },
  {
    dest: "held-out/pedro-pascal/001.jpg",
    files: ["Pedro Pascal by Gage Skidmore.jpg", "Pedro Pascal 2017.jpg", "PedroPascal2014.jpg"],
  },
  {
    dest: "held-out/donald-glover/001.jpg",
    files: ["Donald Glover 2018.jpg", "DonaldGlover2015.jpg", "Childish Gambino 2018.jpg"],
  },
  {
    dest: "held-out/meryl-streep/001.jpg",
    files: ["Meryl Streep 2016.jpg", "MerylStreep2014.jpg", "Meryl Streep 2018.jpg"],
  },
  {
    dest: "held-out/michelle-yeoh/001.jpg",
    files: ["Michelle Yeoh 2018.jpg", "MichelleYeoh2017.jpg", "Michelle Yeoh Cannes 2017.jpg"],
  },
  {
    dest: "held-out/shah-rukh-khan/001.jpg",
    files: ["Shah Rukh Khan 2018.jpg", "Shahrukh Khan 2016.jpg", "Shah Rukh Khan 2014.jpg"],
  },
  {
    dest: "held-out/kendall-jenner/001.jpg",
    files: ["Kendall Jenner 2019.jpg", "KendallJenner2017.jpg", "Kendall Jenner 2015.jpg"],
  },
  {
    dest: "held-out/olivia-colman/001.jpg",
    files: ["Olivia Colman 2019.jpg", "OliviaColman2014.jpg", "Olivia Colman 2018.jpg"],
  },
  {
    dest: "held-out/anya-taylor-joy/001.jpg",
    files: ["Anya Taylor-Joy 2020.jpg", "AnyaTaylorJoy2016.jpg", "Anya Taylor-Joy 2018.jpg"],
  },
  {
    dest: "held-out/julia-roberts/001.jpg",
    files: ["Julia Roberts 2016.jpg", "JuliaRoberts2011.jpg", "Julia Roberts 2018.jpg"],
  },
  {
    dest: "held-out/jake-gyllenhaal/001.jpg",
    files: ["Jake Gyllenhaal 2017.jpg", "JakeGyllenhaal2013.jpg", "Jake Gyllenhaal 2019.jpg"],
  },
  {
    dest: "held-out/jamie-dornan/001.jpg",
    files: ["Jamie Dornan 2016.jpg", "JamieDornan2014.jpg", "Jamie Dornan 2018.jpg"],
  },
  {
    dest: "held-out/hailee-steinfeld/001.jpg",
    files: ["Hailee Steinfeld 2018.jpg", "HaileeSteinfeld2015.jpg", "Hailee Steinfeld 2020.jpg"],
  },
  {
    dest: "held-out/kate-middleton/001.jpg",
    files: [
      "Catherine, Duchess of Cambridge 2018.jpg",
      "Kate Middleton 2017.jpg",
      "Catherine Duchess of Cambridge 2019.jpg",
    ],
  },
  {
    dest: "held-out/tiffany-haddish/001.jpg",
    files: ["Tiffany Haddish 2018.jpg", "TiffanyHaddish2017.jpg", "Tiffany Haddish 2019.jpg"],
  },
  {
    dest: "held-out/jet-li/001.jpg",
    files: ["Jet Li 2010.jpg", "JetLi2009.jpg", "Jet Li 2018.jpg"],
  },
  {
    dest: "held-out/lizzo/001.jpg",
    files: ["Lizzo 2019.jpg", "Lizzo 2020.jpg", "Lizzo 2018.jpg"],
  },
  {
    dest: "held-out/zayn-malik/001.jpg",
    files: ["Zayn Malik 2016.jpg", "ZaynMalik2015.jpg", "Zayn Malik 2018.jpg"],
  },
  {
    dest: "held-out/lionel-messi/001.jpg",
    files: ["Lionel Messi 2018.jpg", "Lionel Messi 2019.jpg", "Messi 2016.jpg"],
  },
  {
    dest: "held-out/kylian-mbappe/001.jpg",
    files: ["Kylian Mbappé 2018.jpg", "Kylian Mbappe 2019.jpg", "Mbappé 2018.jpg"],
  },
  {
    dest: "held-out/stephen-curry/001.jpg",
    files: ["Stephen Curry 2016.jpg", "Stephen Curry 2018.jpg", "Steph Curry 2017.jpg"],
  },
  // empty dirs — famous names
  {
    dest: "held-out/beyonce/001.jpg",
    files: ["Beyoncé 2018.jpg", "Beyonce 2016.jpg", "Beyoncé Knowles 2014.jpg"],
  },
  {
    dest: "held-out/emma-watson/001.jpg",
    files: ["Emma Watson 2013.jpg", "EmmaWatson2011.jpg", "Emma Watson 2017.jpg"],
  },
  {
    dest: "held-out/harry-styles/001.jpg",
    files: ["Harry Styles 2018.jpg", "HarryStyles2017.jpg", "Harry Styles 2020.jpg"],
  },
  {
    dest: "held-out/tom-holland/001.jpg",
    files: ["Tom Holland 2018.jpg", "TomHolland2016.jpg", "Tom Holland 2019.jpg"],
  },
  {
    dest: "held-out/halle-berry/001.jpg",
    files: ["Halle Berry 2017.jpg", "HalleBerry2010.jpg", "Halle Berry 2019.jpg"],
  },
  {
    dest: "held-out/kendrick-lamar/001.jpg",
    files: ["Kendrick Lamar 2018.jpg", "KendrickLamar2016.jpg", "Kendrick Lamar 2015.jpg"],
  },
];

function sha(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function fileSha(p: string): string | null {
  if (!fs.existsSync(p)) return null;
  return sha(fs.readFileSync(p));
}

async function wiki(params: Record<string, string>) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  return res.json();
}

async function resolveFile(title: string) {
  const fileTitle = title.startsWith("File:") ? title : `File:${title}`;
  const j = await wiki({
    action: "query",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "900",
  });
  const page = Object.values(j.query?.pages ?? {})[0] as {
    missing?: boolean;
    imageinfo?: Array<{
      mime?: string;
      url?: string;
      thumburl?: string;
      thumbwidth?: number;
      thumbheight?: number;
    }>;
  };
  if (!page || page.missing || !page.imageinfo?.[0]) return null;
  const info = page.imageinfo[0];
  const mime = String(info.mime || "");
  if (!mime.startsWith("image/") || mime.includes("svg")) return null;
  return { url: info.thumburl || info.url || "", w: info.thumbwidth, h: info.thumbheight };
}

function blockedFor(dest: string): Set<string> {
  const out = new Set<string>();
  const parts = dest.split("/");
  const idGuess =
    dest.startsWith("held-out/") || dest.startsWith("control/")
      ? parts[1]!
      : dest.replace(/-new\.jpg$/, "").replace(/\.jpg$/, "");
  for (const rel of [
    `public/celebs/${idGuess}.jpg`,
    `public/celebs/control/${idGuess}/001.jpg`,
    `public/celebs/held-out/${idGuess}/001.jpg`,
    `public/celebs/the-weeknd.jpg`,
    `public/celebs/control/the-weeknd/001.jpg`,
    `public/celebs/adele.jpg`,
  ]) {
    const s = fileSha(path.join(ROOT, rel));
    if (s) out.add(s);
  }
  const extra = path.join(ROOT, "public/celebs/extra-photos", idGuess);
  if (fs.existsSync(extra)) {
    for (const f of fs.readdirSync(extra)) {
      const s = fileSha(path.join(extra, f));
      if (s) out.add(s);
    }
  }
  return out;
}

async function main() {
  const used = new Set<string>();
  let ok = 0;
  let fail = 0;
  for (const job of JOBS) {
    process.stdout.write(`\n${job.dest}\n`);
    const dest = path.join(ROOT, "public/celebs", job.dest);
    const blocked = blockedFor(job.dest);
    let landed = false;
    for (const file of job.files) {
      process.stdout.write(`  ${file} … `);
      try {
        const info = await resolveFile(file);
        if (!info?.url) {
          console.log("missing");
          continue;
        }
        const res = await fetch(info.url, { headers: { "User-Agent": UA } });
        if (!res.ok) {
          console.log("dl fail");
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 8_000) {
          console.log("tiny");
          continue;
        }
        const s = sha(buf);
        if (blocked.has(s) || used.has(s)) {
          console.log("sha skip");
          continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        used.add(s);
        console.log(`OK ${info.w}x${info.h}`);
        landed = true;
        ok++;
        break;
      } catch (err) {
        console.log(`err ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 180));
    }
    if (!landed) {
      console.log("  FAIL");
      fail++;
    }
  }
  console.log(`\nlanded ${ok}  fail ${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
