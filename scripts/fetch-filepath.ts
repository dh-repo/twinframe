#!/usr/bin/tsx
/** Direct Commons FilePath downloads — no API, slower, avoids 429. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TwinframeFilePath/1.0 (local accuracy eval) Node.js";

const JOBS: Array<{ dest: string; files: string[] }> = [
  {
    dest: "held-out/drake/001.jpg",
    files: [
      "Drake July 2016.jpg",
      "Drake 2010.jpg",
      "Drake at Bun-B Concert 2011.jpg",
      "Drake Summer Sixteen Tour.jpg",
    ],
  },
  {
    dest: "held-out/lisa-blackpink/001.jpg",
    files: [
      "Lisa Lalisa Manobal at Emmys 2025.jpg",
      "20240314 Lisa Manoban 12 (cropped).jpg",
      "Blackpink Lisa 190621 2.png",
      "BLACKPINK's Lisa for BULGARI June 2023 04.jpg",
    ],
  },
  {
    dest: "held-out/naomi-osaka/001.jpg",
    files: [
      "Naomi Osaka 2014 crop.jpg",
      "Naomi Osaka (15307217997).jpg",
      "Naomi Osaka (33948760861) (cropped).jpg",
      "NaomiOsaka-smile-2020 (cropped tight).png",
    ],
  },
  {
    dest: "held-out/prince-harry/001.jpg",
    files: [
      "Prince Harry, Duke of Sussex 2020 cropped 02.jpg",
      "Prince Harry 2014.jpg",
      "Prince Harry (17212621769).jpg",
    ],
  },
  {
    dest: "held-out/serena-williams/001.jpg",
    files: [
      "Serena Williams (19421811314).jpg",
      "Serena Williams 2015.jpg",
      "Serena Williams Australian Open 2015.jpg",
      "Serena_Williams_2013.jpg",
    ],
  },
  {
    dest: "held-out/jake-gyllenhaal/002.jpg",
    files: [
      "Jake Gyllenhaal by Gage Skidmore.jpg",
      "Jake Gyllenhaal 2019.jpg",
      "JakeGyllenhaalOct09.jpg",
    ],
  },
  {
    dest: "held-out/chadwick-boseman/003.jpg",
    files: [
      "Chadwick Boseman by Gage Skidmore.jpg",
      "Chadwick Boseman 2017.jpg",
      "ChadwickBosemanDec09.jpg",
    ],
  },
  {
    dest: "held-out/jet-li/003.jpg",
    files: ["Jet Li 2009.jpg", "JetLi08TIFF.jpg", "Jet Li 2010.jpg"],
  },
  {
    dest: "held-out/ed-sheeran/003.jpg",
    files: [
      "Ed Sheeran 2018.jpg",
      "Ed Sheeran (8447802064).jpg",
      "Ed Sheeran 2013.jpg",
    ],
  },
  {
    dest: "held-out/selena-gomez/002.jpg",
    files: [
      "Selena Gomez by Gage Skidmore 2.jpg",
      "Selena Gomez 2019.jpg",
      "SelenaGomez2013.jpg",
    ],
  },
  {
    dest: "held-out/the-weeknd/002.jpg",
    files: [
      "The Weeknd 2018.jpg",
      "The Weeknd Coachella 2018.jpg",
      "Abel Tesfaye 2015.jpg",
    ],
  },
  {
    dest: "held-out/the-weeknd/004.jpg",
    files: [
      "The Weeknd Universal Studios Hollywood.jpg",
      "The Weeknd 2016.jpg",
      "The Weeknd 2015.jpg",
    ],
  },
  {
    dest: "held-out/karol-g/002.jpg",
    files: [
      "Karol G 2019.png",
      "2023-11-16 Gala de los Latin Grammy, 15.jpg",
      "Karol G en 2018.jpg",
    ],
  },
  {
    dest: "held-out/keira-knightley/002.jpg",
    files: [
      "Keira Knightley 2014.jpg",
      "KeiraKnightley08TIFF.jpg",
      "Keira Knightley Cannes 2014.jpg",
    ],
  },
  {
    dest: "held-out/leonardo-dicaprio/002.jpg",
    files: [
      "Leonardo DiCaprio 2016.jpg",
      "LeonardoDiCaprioNov08.jpg",
      "Leonardo DiCaprio 2014.jpg",
    ],
  },
  {
    dest: "held-out/michelle-yeoh/002.jpg",
    files: [
      "Michelle Yeoh 2018.jpg",
      "MichelleYeoh08TIFF.jpg",
      "Michelle Yeoh Cannes 2017.jpg",
    ],
  },
  {
    dest: "held-out/olivia-colman/002.jpg",
    files: [
      "Olivia Colman 2019.jpg",
      "Olivia Colman 2014.jpg",
      "OliviaColmanBAFTA18.jpg",
    ],
  },
  {
    dest: "held-out/olivia-rodrigo/002.jpg",
    files: [
      "Olivia Rodrigo 2021.jpg",
      "Olivia Rodrigo 2023.jpg",
      "Olivia Rodrigo White House 2021.jpg",
    ],
  },
  {
    dest: "held-out/priyanka-chopra/002.jpg",
    files: [
      "Priyanka Chopra 2018.jpg",
      "Priyanka Chopra Jonas 2020.jpg",
      "PriyankaChopra07TIFF.jpg",
    ],
  },
  {
    dest: "control/adele/001.jpg",
    files: [
      "Adele 2016.jpg",
      "Adele 2015.jpg",
      "Adele at BBC Radio 2.jpg",
      "Adele 2012.jpg",
    ],
  },
];

function sha(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function download(file: string): Promise<Buffer | null> {
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}?width=900`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) return null;
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.startsWith("image/")) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length < 8_000 ? null : buf;
}

async function main() {
  for (const job of JOBS) {
    const dest = path.join(ROOT, "public/celebs", job.dest);
    process.stdout.write(`\n${job.dest}\n`);
    let ok = false;
    for (const file of job.files) {
      process.stdout.write(`  ${file} … `);
      try {
        const buf = await download(file);
        if (!buf) {
          console.log("miss");
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        const celebId = job.dest.split("/")[1] ?? job.dest.replace(/\.jpg$/, "");
        const blocked = new Set<string>();
        for (const rel of [
          path.join(ROOT, "public/celebs", `${celebId}.jpg`),
          path.join(ROOT, "public/celebs/control", celebId, "001.jpg"),
        ]) {
          if (rel === dest) continue;
          if (fs.existsSync(rel)) blocked.add(sha(fs.readFileSync(rel)));
        }
        const heldDir = path.join(ROOT, "public/celebs/held-out", celebId);
        if (fs.existsSync(heldDir)) {
          for (const f of fs.readdirSync(heldDir)) {
            const p = path.join(heldDir, f);
            if (p === dest || !/\.(jpe?g|png|webp)$/i.test(f)) continue;
            blocked.add(sha(fs.readFileSync(p)));
          }
        }
        if (blocked.has(sha(buf))) {
          console.log("dup");
          continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        console.log(`OK ${buf.length} ${sha(buf).slice(0, 8)}`);
        ok = true;
        break;
      } catch (e) {
        console.log((e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (!ok) console.log("  FAIL");
    await new Promise((r) => setTimeout(r, 800));
  }
}

main();
