#!/usr/bin/tsx
/**
 * Replace junk eval photos (group shots / wrong person) and fetch a
 * correct Karol G gallery portrait. SHA-skips enrolled + current extras.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TwinframeEvalRepair/1.0 (local accuracy eval) Node.js";

type Job = { dest: string; files: string[]; alsoBlock?: string[] };

const JOBS: Job[] = [
  {
    dest: "karol-g.jpg",
    files: [
      "Karol G, Colombian Reggaeton Artist (cropped).png",
      "Karol G 2019.png",
      "Karol G en 2018.jpg",
      "2023-11-16 Gala de los Latin Grammy, 15.jpg",
    ],
  },
  {
    dest: "held-out/scarlett-johansson/001.jpg",
    files: [
      "Scarlett Johansson by Gage Skidmore 2.jpg",
      "Scarlett Johansson 2019.jpg",
      "ScarlettJohanssonTIFFSept2010.jpg",
      "Scarlett Johansson 2013.jpg",
    ],
  },
  {
    dest: "held-out/chris-evans/001.jpg",
    files: [
      "Chris Evans by Gage Skidmore 2.jpg",
      "Chris Evans SDCC 2014.jpg",
      "Chris Evans 2014.jpg",
      "ChrisEvansJun08.jpg",
    ],
  },
  {
    dest: "held-out/antonio-banderas/001.jpg",
    files: [
      "Antonio Banderas 2019.jpg",
      "AntonioBanderas2014.jpg",
      "Antonio Banderas 2010.jpg",
      "Antonio Banderas Cannes 2019.jpg",
    ],
  },
  {
    dest: "held-out/helena-bonham-carter/001.jpg",
    files: [
      "Helena Bonham Carter 2011.jpg",
      "HelenaBonhamCarterBAFTA2011.jpg",
      "Helena Bonham Carter 2010.jpg",
      "Helena Bonham Carter 2005.jpg",
    ],
  },
  {
    dest: "held-out/kylie-jenner/001.jpg",
    files: [
      "Kylie Jenner1 (cropped).png",
      "Kylie Jenner for Nip + Fab.jpg",
      "Kylie Jenner at Topshop Behind the Scenes.png",
    ],
  },
  {
    dest: "held-out/mark-zuckerberg/001.jpg",
    files: [
      "Mark Zuckerberg F8 2019 Keynote (32830578717) (cropped).jpg",
      "Mark Zuckerberg 2019.jpg",
      "MarkZuckerberg.jpg",
      "Mark Zuckerberg at the 2018 World Economic Forum.jpg",
    ],
  },
  {
    dest: "held-out/sam-smith/001.jpg",
    files: [
      "SamSmith-byPhilipRomano.jpg",
      "Sam Smith 2 (15425586230).jpg",
      "Sam Smith live in the Netherlands.jpg",
      "Sam Smith Lollapalooza 2015-3.jpg",
    ],
  },
  {
    dest: "held-out/denzel-washington/001.jpg",
    files: [
      "Denzel Washington at the 2024 Toronto International Film Festival 04 (cropped).jpg",
      "DenzelWashingtonMay05.jpg",
      "Denzel Washington cropped 02 b.jpg",
      "Denzel Washington at the 2025 Cannes Film Festival.jpg",
    ],
  },
  {
    dest: "held-out/joaquin-phoenix/001.jpg",
    files: [
      "Joaquin Phoenix 2018.jpg",
      "JoaquinPhoenix09TIFF.jpg",
      "Joaquin Phoenix 2014.jpg",
      "Joaquin Phoenix Cannes 2017.jpg",
    ],
  },
  {
    dest: "held-out/tom-hanks/001.jpg",
    files: [
      "Tom Hanks 2016.jpg",
      "Tom_Hanks_2019.jpg",
      "Tom Hanks TIFF 2019.jpg",
      "Tom Hanks 2014.jpg",
    ],
  },
  {
    dest: "held-out/karol-g/001.jpg",
    files: [
      "Karol G en 2018.jpg",
      "Karol G 2019.png",
      "Karol G & Anuel AA en El Salvador 2019.jpg",
    ],
  },
  {
    dest: "control/adele/001.jpg",
    files: [
      "Adele 2016.jpg",
      "Adele One Night Only 2021.png",
      "Adele 2015.jpg",
      "Adele 2012.jpg",
      "Adele at BBC Radio 2.jpg",
    ],
  },
  {
    dest: "control/chris-hemsworth/001.jpg",
    files: [
      "Chris Hemsworth 2019.jpg",
      "Chris Hemsworth by Gage Skidmore 3.jpg",
      "ChrisHemsworthJun09.jpg",
      "Chris Hemsworth 2016.jpg",
    ],
  },
  {
    dest: "control/henry-cavill/001.jpg",
    files: [
      "Henry Cavill 2016.jpg",
      "Henry Cavill by Gage Skidmore 2.jpg",
      "HenryCavill2013.jpg",
      "Henry Cavill 2018.jpg",
    ],
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
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
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
      width?: number;
      height?: number;
    }>;
  };
  if (!page || page.missing || !page.imageinfo?.[0]) return null;
  const info = page.imageinfo[0];
  const mime = String(info.mime || "");
  if (!mime.startsWith("image/") || mime.includes("svg")) return null;
  const w = Number(info.thumbwidth || info.width || 0);
  const h = Number(info.thumbheight || info.height || 0);
  if (Math.min(w, h) < 220) return null;
  return { url: info.thumburl || info.url || "", w, h };
}

async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length < 8_000 ? null : buf;
}

function blockedFor(dest: string): Set<string> {
  const out = new Set<string>();
  const id = dest.split("/")[0]?.replace(/\.jpg$/, "") ?? "";
  const celebId = dest.includes("/") ? dest.split("/")[1] ?? dest.split("/")[0]! : id;
  const guesses = dest.startsWith("held-out/")
    ? dest.split("/")[1]!
    : dest.startsWith("control/")
      ? dest.split("/")[1]!
      : dest.replace(/\.jpg$/, "");
  for (const rel of [
    `public/celebs/${guesses}.jpg`,
    `public/celebs/thumbs/96/${guesses}.webp`,
    `public/celebs/control/${guesses}/001.jpg`,
    `public/celebs/held-out/${guesses}/001.jpg`,
  ]) {
    const s = fileSha(path.join(ROOT, rel));
    if (s) out.add(s);
  }
  const extraDir = path.join(ROOT, "public/celebs/extra-photos", guesses);
  if (fs.existsSync(extraDir)) {
    for (const f of fs.readdirSync(extraDir)) {
      const s = fileSha(path.join(extraDir, f));
      if (s) out.add(s);
    }
  }
  void celebId;
  return out;
}

async function main() {
  const used = new Set<string>();
  for (const job of JOBS) {
    const dest = path.join(ROOT, "public/celebs", job.dest);
    process.stdout.write(`\n${job.dest}\n`);
    const blocked = blockedFor(job.dest);
    let landed = false;
    for (const file of job.files) {
      process.stdout.write(`  ${file} … `);
      try {
        const info = await resolveFile(file);
        if (!info) {
          console.log("missing");
          continue;
        }
        const buf = await download(info.url);
        if (!buf) {
          console.log("dl fail");
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
        break;
      } catch (err) {
        console.log(`err ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!landed) console.log(`  FAIL`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
