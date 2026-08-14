#!/usr/bin/tsx
/**
 * Replace weak primary portraits + fetch extra-photos for identity misses.
 * SHA-skips enrolled / control / held-out / existing extras. Never enrolls eval photos.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TwinframeGalleryRepair/1.0 (local identity eval) Node.js";

type Job = { dest: string; files: string[] };

const JOBS: Job[] = [
  {
    dest: "olivia-colman.jpg",
    files: [
      "Olivia Colman at Moet BIFA 2014 (cropped).jpg",
      "Olivia Colman (2014).jpg",
      "OliviaColmanBAFTA18.jpg",
      "Olivia Colman 2022 (cropped ).jpg",
    ],
  },
  {
    dest: "the-weeknd.jpg",
    files: [
      "The Weeknd by David Hwang.jpg",
      "The Weeknd Cannes 2023.png",
      "The Weeknd (253662129).jpeg",
      "The Weeknd 2015.jpg",
    ],
  },
  {
    dest: "ariana-grande.jpg",
    files: [
      "Ariana Grande Grammys 2020.jpg",
      "Ariana Grande 2018.jpg",
      "Ariana Grande 2015.jpg",
      "Ariana Grande Dangerous Woman Tour 2017.jpg",
      "Ariana Grande 2016 (cropped).png",
    ],
  },
  {
    dest: "prince-harry.jpg",
    files: [
      "Duke of Sussex in 2019.jpg",
      "Prince Harry Trooping the Colour cropped.JPG",
      "Prince Harry 2014.jpg",
      "Prince Harry (17396840192).jpg",
    ],
  },
  {
    dest: "serena-williams.jpg",
    files: [
      "Serena Williams at the Australian Open 2015 (headshot).jpg",
      "Serena Williams (7105796277) (cropped).jpg",
      "Serena Williams Tennis Star.jpg",
      "Serena Williams Eastbourne (2011) (cropped).jpg",
    ],
  },
  {
    dest: "kate-middleton.jpg",
    files: [
      "Catherine, Princess of Wales in 2024 (cropped).jpg",
      "Catherine, Princess of Wales in 2022 (cropped).jpg",
      "Kate Middleton 2008 cropped v2.jpg",
      "Catherine, Princess of Wales in 2025 (cropped).jpg",
    ],
  },
  {
    dest: "extra-photos/jisoo/002.jpg",
    files: [
      "Jisoo at Dior Fall 2023.jpg",
      "Jisoo Dior 2023.jpg",
      "Kim Jisoo in 2022.jpg",
      "Jisoo for Dior 2022.jpg",
      "Blackpink Jisoo 190621.png",
    ],
  },
  {
    dest: "extra-photos/dua-lipa/002.jpg",
    files: [
      "Dua Lipa 2023.jpg",
      "Dua Lipa Glastonbury 2024.jpg",
      "Dua Lipa 2018 (cropped).jpg",
      "Dua Lipa Grammys 2021.jpg",
    ],
  },
  {
    dest: "extra-photos/kerry-washington/002.jpg",
    files: [
      "Kerry Washington 2013.jpg",
      "Kerry Washington by Gage Skidmore.jpg",
      "Kerry Washington 2016.jpg",
      "KerryWashingtonFeb09.jpg",
    ],
  },
  {
    dest: "extra-photos/zendaya/002.jpg",
    files: [
      "Zendaya by Gage Skidmore 2.jpg",
      "Zendaya 2019.jpg",
      "Zendaya Cannes 2024.jpg",
      "Zendaya 2016.jpg",
    ],
  },
  {
    dest: "extra-photos/kristen-stewart/002.jpg",
    files: [
      "Kristen Stewart Cannes 2014.jpg",
      "Kristen Stewart 2012.jpg",
      "KristenStewartTIFFSept2012.jpg",
      "Kristen Stewart 2019.jpg",
    ],
  },
  {
    dest: "extra-photos/adriana-lima/002.jpg",
    files: [
      "Adriana Lima 2019.jpg",
      "Adriana Lima Cannes 2017.jpg",
      "Adriana Lima 2014.jpg",
      "AdrianaLima07.jpg",
    ],
  },
  {
    dest: "extra-photos/kendrick-lamar/002.jpg",
    files: [
      "Kendrick Lamar 2018 Pulitzer Prize ceremony (3x4 cropped).jpg",
      "Kendrick Lamar, Bonnaroo 2012-2.jpg",
      "Kendrick Lamar 2013.jpg",
      "Kendrick Lamar by David Hwang.jpg",
    ],
  },
  {
    dest: "extra-photos/song-kang/002.jpg",
    files: [
      "Song Kang (송강) 210823.jpg",
      "Song Kang in 2019 (2).jpg",
      "Song Kang.png",
      "Song Kang in November 2025.jpg",
    ],
  },
  {
    dest: "extra-photos/cardi-b/002.jpg",
    files: [
      "Cardi B 2019.jpg",
      "Cardi B 2018.jpg",
      "Cardi B Grammys 2018.jpg",
      "Cardi B 2021.jpg",
    ],
  },
  {
    dest: "extra-photos/gemma-chan/002.jpg",
    files: [
      "Gemma Chan 2019.jpg",
      "Gemma Chan by Gage Skidmore.jpg",
      "Gemma Chan 2016.jpg",
      "Gemma Chan Cannes.jpg",
    ],
  },
  {
    dest: "extra-photos/gigi-hadid/002.jpg",
    files: [
      "Gigi Hadid 2016.jpg",
      "Gigi Hadid Cannes 2017.jpg",
      "Gigi Hadid 2018.jpg",
      "Gigi Hadid Met Gala 2015.jpg",
    ],
  },
  {
    dest: "extra-photos/jessica-alba/002.jpg",
    files: [
      "Jessica Alba 2013.jpg",
      "Jessica Alba 2011.jpg",
      "JessicaAlba08TIFF.jpg",
      "Jessica Alba 2019.jpg",
    ],
  },
  {
    dest: "extra-photos/florence-pugh/003.jpg",
    files: [
      "Florence Pugh 2019.jpg",
      "Florence Pugh 2020.jpg",
      "Florence Pugh by Gage Skidmore.jpg",
      "Florence Pugh 2022.jpg",
    ],
  },
  {
    dest: "extra-photos/olivia-colman/002.jpg",
    files: [
      "Olivia Colman 2019.jpg",
      "Olivia Colman 2022 (cropped 3).jpg",
      "Olivia Colman BAFTA 2019.jpg",
    ],
  },
];

function sha(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function celebIdFromDest(dest: string): string {
  if (dest.startsWith("extra-photos/")) return dest.split("/")[1]!;
  return dest.replace(/\.[^.]+$/, "");
}

function blockedFor(id: string): Set<string> {
  const out = new Set<string>();
  const add = (p: string) => {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) out.add(sha(fs.readFileSync(p)));
  };
  add(path.join(ROOT, "public/celebs", `${id}.jpg`));
  add(path.join(ROOT, "public/celebs/control", id, "001.jpg"));
  for (const dir of [
    path.join(ROOT, "public/celebs/held-out", id),
    path.join(ROOT, "public/celebs/extra-photos", id),
    path.join(ROOT, "public/celebs/control", id),
  ]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.(jpe?g|png|webp)$/i.test(f)) add(path.join(dir, f));
    }
  }
  return out;
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
  let ok = 0;
  let fail = 0;
  for (const job of JOBS) {
    const dest = path.join(ROOT, "public/celebs", job.dest);
    const id = celebIdFromDest(job.dest);
    const blocked = blockedFor(id);
    if (fs.existsSync(dest) && job.dest.startsWith("extra-photos/")) {
      console.log(`${job.dest} already exists, skip`);
      continue;
    }
    process.stdout.write(`\n${job.dest}\n`);
    let landed = false;
    for (const file of job.files) {
      process.stdout.write(`  ${file} … `);
      try {
        const buf = await download(file);
        if (!buf) {
          console.log("miss");
          await new Promise((r) => setTimeout(r, 700));
          continue;
        }
        if (blocked.has(sha(buf))) {
          console.log("dup");
          continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        console.log(`OK ${buf.length} ${sha(buf).slice(0, 8)}`);
        ok++;
        landed = true;
        break;
      } catch (e) {
        console.log((e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!landed) {
      console.log("  FAIL");
      fail++;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\ndone gallery-repairs ok=${ok} fail=${fail}`);
}

main();
