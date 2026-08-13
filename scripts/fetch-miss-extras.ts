#!/usr/bin/tsx
/**
 * Fetch extra-photos for identity-miss celebs via Commons file search.
 * Never writes held-out / control. SHA-skips enrolled + eval + existing extras.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TwinframeMissExtras/1.0 (local identity eval) Node.js";
const DELAY = Number(process.env.SELF_FETCH_DELAY_MS || 700);

const SKIP =
  /logo|icon|flag|coat|arms|crest|signature|wordmark|poster|soundtrack|\.svg|symbol|map of|diagram|album|cover|cast of|season \d|family|stadium|building|hall of|autograph|holbein|cartouche|michael jackson|r\. kelly|portrait of a young|1962|2pac|tupac|hallstr[oö]m|georgiana|tussauds|wax|school record|lorde|ayesha curry|handprint|walk of fame|black panther|cosplay|costume|mask|mona lisa|geograph|gangho|16\d\d|1696|stained|window|watercolor|painting of/i;

const ALIAS: Record<string, string[]> = {
  "ariana-grande": ["Ariana Grande"],
  jisoo: ["Kim Jisoo", "Jisoo BLACKPINK"],
  "the-weeknd": ["The Weeknd", "Abel Tesfaye"],
  "dua-lipa": ["Dua Lipa"],
  "kerry-washington": ["Kerry Washington"],
  zendaya: ["Zendaya"],
  "adriana-lima": ["Adriana Lima"],
  "gemma-chan": ["Gemma Chan"],
  "george-clooney": ["George Clooney"],
  "sam-claflin": ["Sam Claflin"],
  beyonce: ["Beyoncé", "Beyonce"],
  "naomi-osaka": ["Naomi Osaka"],
  "kylian-mbappe": ["Kylian Mbappé"],
  "olivia-rodrigo": ["Olivia Rodrigo"],
  reesewitherspoon: ["Reese Witherspoon"],
  "timothee-chalamet": ["Timothée Chalamet"],
  "donnie-yen": ["Donnie Yen"],
  "chris-evans": ["Chris Evans (actor)"],
  "nicki-minaj": ["Nicki Minaj"],
};

const MISS_IDS = (
  process.env.MISS_IDS ||
  "aaron-taylor-johnson,adele,adriana-lima,alicia-vikander,angela-bassett,anna-sawai,ariana-grande,bella-hadid,beyonce,billie-eilish,cate-blanchett,chris-evans,cristiano-ronaldo,doja-cat,donnie-yen,dua-lipa,dwayne-johnson,emily-blunt,emma-watson,florence-pugh,gary-oldman,gemma-chan,george-clooney,gigi-hadid,harry-styles,heidi-klum,jamie-dornan,jennifer-lawrence,jessica-alba,jisoo,josh-hutcherson,julia-roberts,kate-winslet,keira-knightley,kerry-washington,kevin-hart,kim-kardashian,kylian-mbappe,kylie-jenner,laurence-fishburne,lizzo,margot-robbie,millie-bobby-brown,naomi-osaka,natalie-portman,neymar,nicki-minaj,olivia-rodrigo,priyanka-chopra,reesewitherspoon,ryan-gosling,salma-hayek,sam-claflin,sydney-sweeney,taylor-lautner,taylor-swift,timothee-chalamet,viola-davis,zendaya"
).split(",");

const buckets = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/celebs/gallery.buckets.json"), "utf8"),
) as Array<{ id: string; name: string }>;
const byId = new Map(buckets.map((b) => [b.id, b]));

function sha(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function fileSha(p: string): string | null {
  if (!fs.existsSync(p)) return null;
  return sha(fs.readFileSync(p));
}

async function commons(params: Record<string, string>) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`commons ${res.status}`);
    return res.json();
  }
  throw new Error("commons 429");
}

async function searchFiles(query: string) {
  const j = await commons({
    action: "query",
    list: "search",
    srsearch: query,
    srnamespace: "6",
    srlimit: "14",
  });
  return ((j.query?.search ?? []) as Array<{ title: string }>).map((s) => s.title);
}

async function fileInfos(titles: string[]) {
  if (!titles.length) return [];
  const j = await commons({
    action: "query",
    titles: titles.slice(0, 20).join("|"),
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "900",
  });
  const pages = Object.values(j.query?.pages ?? {}) as Array<{
    title?: string;
    imageinfo?: Array<{
      mime?: string;
      url?: string;
      thumburl?: string;
      thumbwidth?: number;
      thumbheight?: number;
    }>;
  }>;
  const out: Array<{ url: string; title: string; w: number; h: number }> = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const mime = String(info.mime || "");
    if (!mime.startsWith("image/") || mime.includes("svg")) continue;
    if (SKIP.test(p.title || "") || SKIP.test(info.url || "")) continue;
    const w = Number(info.thumbwidth || 0);
    const h = Number(info.thumbheight || 0);
    if (Math.min(w, h) < 220) continue;
    out.push({ url: info.thumburl || info.url || "", title: p.title || "", w, h });
  }
  out.sort((a, b) => {
    const score = (t: string) => {
      let s = 0;
      if (/cropped|portrait|gage|official/i.test(t)) s -= 2;
      return s;
    };
    const ap = a.h >= a.w * 0.85 ? 0 : 1;
    const bp = b.h >= b.w * 0.85 ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return score(a.title) - score(b.title);
  });
  return out;
}

function blockedFor(id: string): Set<string> {
  const out = new Set<string>();
  const paths = [
    path.join(ROOT, "public/celebs", `${id}.jpg`),
    path.join(ROOT, "public/celebs/control", id, "001.jpg"),
  ];
  for (const dir of [
    path.join(ROOT, "public/celebs/held-out", id),
    path.join(ROOT, "public/celebs/extra-photos", id),
    path.join(ROOT, "public/celebs/control", id),
  ]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.(jpe?g|png|webp)$/i.test(f)) paths.push(path.join(dir, f));
    }
  }
  for (const p of paths) {
    const s = fileSha(p);
    if (s) out.add(s);
  }
  return out;
}

function nextExtraSlot(id: string): string {
  const d = path.join(ROOT, "public/celebs/extra-photos", id);
  for (let n = 2; n <= 6; n++) {
    const slot = String(n).padStart(3, "0") + ".jpg";
    if (!fs.existsSync(path.join(d, slot))) return slot;
  }
  return "006.jpg";
}

async function main() {
  const ids = MISS_IDS.map((s) => s.trim()).filter(Boolean);
  console.log(`miss-extras targets=${ids.length}`);
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    const b = byId.get(id);
    if (!b) {
      console.log(`${id} … no bucket`);
      fail++;
      continue;
    }
    const slot = nextExtraSlot(id);
    const dest = path.join(ROOT, "public/celebs/extra-photos", id, slot);
    if (fs.existsSync(dest)) {
      console.log(`${id} ${slot} exists`);
      continue;
    }
    const blocked = blockedFor(id);
    process.stdout.write(`${id} ${slot} … `);
    try {
      const queries = [...new Set([b.name, ...(ALIAS[id] ?? [])])];
      const titles: string[] = [];
      for (const q of queries) {
        for (const t of await searchFiles(q)) if (!titles.includes(t)) titles.push(t);
        await new Promise((r) => setTimeout(r, 200));
      }
      const imgs = await fileInfos(titles);
      let landed = false;
      for (const img of imgs) {
        const res = await fetch(img.url, { headers: { "User-Agent": UA } });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 8_000) continue;
        if (blocked.has(sha(buf))) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        console.log(`OK ${img.w}x${img.h} ${img.title.replace(/^File:/, "")}`);
        ok++;
        landed = true;
        break;
      }
      if (!landed) {
        console.log("no alt");
        fail++;
      }
    } catch (e) {
      console.log((e as Error).message);
      fail++;
    }
    await new Promise((r) => setTimeout(r, DELAY));
  }
  console.log(`done miss-extras ok=${ok} fail=${fail}`);
}

main();
