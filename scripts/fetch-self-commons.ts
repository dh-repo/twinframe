#!/usr/bin/tsx
/**
 * Fill remaining held-out 001–004 slots via Commons file search.
 * Query photos only — SHA-skips enrolled / control / extra / existing held-out.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TwinframeSelfCommons/1.0 (local identity eval) Node.js";
const DELAY = Number(process.env.SELF_FETCH_DELAY_MS || 800);
const MAX_SLOT = Number(process.env.SELF_MAX_SLOT || 4);

const SKIP =
  /logo|icon|flag|coat|arms|crest|signature|wordmark|poster|soundtrack|\.svg|symbol|map of|diagram|album|cover|cast of|season \d|family|stadium|building|hall of|autograph|holbein|cartouche|michael jackson|r\. kelly|portrait of a young|1962|2pac|tupac|hallstr[oö]m|georgiana|tussauds|wax|school record|lorde|ayesha curry|handprint|walk of fame|black panther|cosplay|costume|mask|hands of|star on|concert from|audience|iPod|barbican|mona lisa|geograph|gangho|16\d\d|1696|stained|window/i;

const ALIAS: Record<string, string[]> = {
  drake: ["Drake (musician)", "Aubrey Drake Graham"],
  "lisa-blackpink": ["Lisa (rapper)", "Lalisa Manobal", "BLACKPINK Lisa"],
  "prince-harry": ["Prince Harry, Duke of Sussex", "Prince Harry"],
  "naomi-osaka": ["Naomi Osaka"],
  "the-weeknd": ["The Weeknd", "Abel Tesfaye"],
  "karol-g": ["Karol G"],
  "regé-jean-page": ["Regé-Jean Page"],
  "penelope-cruz-m": ["Penélope Cruz"],
  reesewitherspoon: ["Reese Witherspoon"],
  "sam-smith": ["Sam Smith (singer)"],
  "stephen-curry": ["Stephen Curry"],
  "kendrick-lamar": ["Kendrick Lamar"],
  "olivia-rodrigo": ["Olivia Rodrigo"],
  "bad-bunny": ["Bad Bunny"],
  "kylian-mbappe": ["Kylian Mbappé"],
  "lee-jung-jae": ["Lee Jung-jae"],
  "liu-yifei": ["Liu Yifei"],
  "park-seo-joon": ["Park Seo-joon"],
  "song-kang": ["Song Kang"],
  "tony-leung": ["Tony Leung Chiu-wai"],
  "zhang-ziyi": ["Zhang Ziyi"],
  "jisoo": ["Jisoo", "Kim Jisoo"],
  "jennie-kim": ["Jennie (singer)", "Jennie Kim"],
};

const buckets = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/celebs/gallery.buckets.json"), "utf8"),
) as Array<{ id: string; name: string; fallbackPath?: string }>;

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

function queriesFor(b: { id: string; name: string }): string[] {
  const extra = ALIAS[b.id] ?? [];
  return [...new Set([b.name, ...extra])];
}

async function searchFiles(query: string) {
  const j = await commons({
    action: "query",
    list: "search",
    srsearch: query,
    srnamespace: "6",
    srlimit: "16",
  });
  return ((j.query?.search ?? []) as Array<{ title: string }>).map((s) => s.title);
}

async function fileInfos(titles: string[]) {
  if (!titles.length) return [];
  const j = await commons({
    action: "query",
    titles: titles.join("|"),
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
      if (/\(\d+\)/.test(t)) s += 1;
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
  const extras = path.join(ROOT, "public/celebs/extra-photos", id);
  const held = path.join(ROOT, "public/celebs/held-out", id);
  const paths = [
    path.join(ROOT, "public/celebs", `${id}.jpg`),
    path.join(ROOT, "public/celebs/control", id, "001.jpg"),
  ];
  if (fs.existsSync(held)) {
    for (const f of fs.readdirSync(held)) {
      if (/\.(jpe?g|png|webp)$/i.test(f)) paths.push(path.join(held, f));
    }
  }
  if (fs.existsSync(extras)) {
    for (const f of fs.readdirSync(extras)) {
      if (/\.(jpe?g|png|webp)$/i.test(f)) paths.push(path.join(extras, f));
    }
  }
  for (const p of paths) {
    const s = fileSha(p);
    if (s) out.add(s);
  }
  return out;
}

function nextSlot(id: string): string | null {
  const d = path.join(ROOT, "public/celebs/held-out", id);
  for (let n = 1; n <= MAX_SLOT; n++) {
    const slot = String(n).padStart(3, "0") + ".jpg";
    if (!fs.existsSync(path.join(d, slot))) return slot;
  }
  return null;
}

const targets = buckets.filter((b) => {
  const primary =
    (b.fallbackPath || "").includes(`/${b.id}.jpg`) ||
    fs.existsSync(path.join(ROOT, "public/celebs", `${b.id}.jpg`));
  return primary && nextSlot(b.id) !== null;
});

const limit = Number(process.env.SELF_COMMONS_LIMIT || 160);
const jobs = targets.slice(0, limit);

async function main() {
  console.log(`commons-fill targets=${jobs.length}`);
  let ok = 0;
  let fail = 0;
  for (const b of jobs) {
    const slot = nextSlot(b.id);
    if (!slot) continue;
    const dest = path.join(ROOT, "public/celebs/held-out", b.id, slot);
    const blocked = blockedFor(b.id);
    process.stdout.write(`${slot.replace(".jpg", "")} ${b.id} … `);
    try {
      const titles: string[] = [];
      for (const q of queriesFor(b)) {
        const found = await searchFiles(q);
        for (const t of found) if (!titles.includes(t)) titles.push(t);
        await new Promise((r) => setTimeout(r, 250));
      }
      const imgs = await fileInfos(titles.slice(0, 24));
      let landed = false;
      for (const img of imgs) {
        const res = await fetch(img.url, { headers: { "User-Agent": UA } });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 8_000) continue;
        const s = sha(buf);
        if (blocked.has(s)) continue;
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
  console.log(`done commons-fill ok=${ok} fail=${fail}`);
}

main();
