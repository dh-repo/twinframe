#!/usr/bin/tsx
/**
 * Download specific Wikimedia Commons portraits for era extras and
 * replacement control queries. SHA-skips enrolled gallery + current control.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TwinframeEraExtras/1.0 (local accuracy eval) Node.js";

type Job = {
  id: string;
  dest: string;
  files: string[];
};

const JOBS: Job[] = [
  {
    id: "tom-hanks",
    dest: "extra-photos/tom-hanks/003.jpg",
    files: [
      "Tom_Hanks_2008.jpg",
      "Tom_Hanks_2011_Shankbone.JPG",
      "TomHanksTIFFSept2011.jpg",
      "Tom_Hanks_at_the_2019_Toronto_International_Film_Festival_(cropped).jpg",
      "Tom_Hanks_2016.jpg",
    ],
  },
  {
    id: "tom-hanks",
    dest: "extra-photos/tom-hanks/004.jpg",
    files: [
      "Tom_Hanks_2011.jpg",
      "TomHanksJan2009.jpg",
      "Tom_Hanks_Cannes_2013.jpg",
      "Tom_Hanks_2014.jpg",
    ],
  },
  {
    id: "emma-stone",
    dest: "extra-photos/emma-stone/002.jpg",
    files: [
      "Emma_Stone_2011.jpg",
      "Emma_Stone_2014_(cropped).jpg",
      "EmmaStoneAAFeb09.jpg",
      "Emma_Stone_2012.jpg",
      "Emma_Stone_2013.jpg",
    ],
  },
  {
    id: "emma-stone",
    dest: "extra-photos/emma-stone/003.jpg",
    files: [
      "Emma_Stone_2014.jpg",
      "Emma_Stone_2018.png",
      "Emma_Stone_2016.jpg",
      "EmmaStoneFeb09.jpg",
    ],
  },
  {
    id: "denzel-washington",
    dest: "control/denzel-washington/001-new.jpg",
    files: [
      "DenzelWashingtonHWOFOct2012.jpg",
      "Denzel_Washington_2013.jpg",
      "Denzel_Washington_Cannes_2014_2.jpg",
      "Denzel_Washington_2016.jpg",
      "Denzel_Washington_2014.jpg",
    ],
  },
  {
    id: "denzel-washington",
    dest: "extra-photos/denzel-washington/003.jpg",
    files: [
      "Denzel_Washington_2018.jpg",
      "DenzelWashingtonFeb09.jpg",
      "Denzel_Washington_2011.jpg",
    ],
  },
  {
    id: "the-weeknd",
    dest: "control/the-weeknd/001-new.jpg",
    files: [
      "The_Weeknd_2018.jpg",
      "The_Weeknd_Cannes_2018.jpg",
      "The_Weeknd_2016.jpg",
      "The_Weeknd_2015.jpg",
      "Abel_Tesfaye_2018.jpg",
      "The_Weeknd_2017.jpg",
    ],
  },
  {
    id: "the-weeknd",
    dest: "extra-photos/the-weeknd/002.jpg",
    files: [
      "The Weeknd Portrait by Brian Ziff.jpg",
      "The Weeknd Cannes 2023.png",
      "The Weeknd (253662129).jpeg",
      "The Weeknd (cropped).jpg",
    ],
  },
  {
    id: "the-weeknd",
    dest: "extra-photos/the-weeknd/003.jpg",
    files: [
      "The Weeknd Cannes 2023.png",
      "The Weeknd Universal Studios Hollywood.jpg",
      "The Weeknd by David Hwang.jpg",
      "FEQ July 2018 The Weeknd (44778856382) (cropped).jpg",
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

async function resolveFile(title: string): Promise<{ url: string; w: number; h: number } | null> {
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
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8_000) return null;
  return buf;
}

function blockedShas(id: string): Set<string> {
  const out = new Set<string>();
  for (const rel of [
    `public/celebs/${id}.jpg`,
    `public/celebs/control/${id}/001.jpg`,
    `public/celebs/control/${id}/001-norm.jpg`,
  ]) {
    const s = fileSha(path.join(ROOT, rel));
    if (s) out.add(s);
  }
  return out;
}

async function main() {
  const usedShas = new Set<string>();
  for (const job of JOBS) {
    const dest = path.join(ROOT, "public/celebs", job.dest);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 8_000) {
      console.log(`skip exists ${job.dest}`);
      usedShas.add(sha(fs.readFileSync(dest)));
      continue;
    }
    const blocked = blockedShas(job.id);
    let landed = false;
    for (const file of job.files) {
      process.stdout.write(`  try ${file} … `);
      try {
        const info = await resolveFile(file);
        if (!info) {
          console.log("missing");
          continue;
        }
        const buf = await download(info.url);
        if (!buf) {
          console.log("download fail");
          continue;
        }
        const s = sha(buf);
        if (blocked.has(s) || usedShas.has(s)) {
          console.log("sha skip");
          continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        usedShas.add(s);
        console.log(`OK ${info.w}x${info.h} → ${job.dest}`);
        landed = true;
        break;
      } catch (err) {
        console.log(`err ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!landed) console.log(`FAIL ${job.id} ${job.dest}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
