#!/usr/bin/tsx
/**
 * Download a small clean control set: one new Wikimedia portrait per famous
 * gallery id, different from the enrolled thumb. Query photos only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public/celebs/control");
const UA = "TwinframeControl/1.0 (local accuracy eval) Node.js";
const SKIP = /logo|icon|flag|coat|signature|sig\.|wordmark|poster|soundtrack|\.svg|symbol|map of|diagram|album|cover|cast of|season \d/i;

const CONTROLS: Array<{ id: string; name: string; wiki?: string }> = [
  { id: "brad-pitt", name: "Brad Pitt" },
  { id: "denzel-washington", name: "Denzel Washington" },
  { id: "idris-elba", name: "Idris Elba" },
  { id: "scarlett-johansson", name: "Scarlett Johansson" },
  { id: "margot-robbie", name: "Margot Robbie" },
  { id: "zendaya", name: "Zendaya" },
  { id: "taylor-swift", name: "Taylor Swift" },
  { id: "leonardo-dicaprio", name: "Leonardo DiCaprio" },
  { id: "tom-hanks", name: "Tom Hanks" },
  { id: "viola-davis", name: "Viola Davis" },
  { id: "angela-bassett", name: "Angela Bassett" },
  { id: "ryan-gosling", name: "Ryan Gosling" },
  { id: "timothee-chalamet", name: "Timothée Chalamet" },
  { id: "ana-de-armas", name: "Ana de Armas" },
  { id: "florence-pugh", name: "Florence Pugh" },
  { id: "keanu-reeves", name: "Keanu Reeves" },
  { id: "jennifer-lawrence", name: "Jennifer Lawrence" },
  { id: "emma-stone", name: "Emma Stone" },
  { id: "chris-hemsworth", name: "Chris Hemsworth" },
  { id: "henry-cavill", name: "Henry Cavill" },
  { id: "gal-gadot", name: "Gal Gadot" },
  { id: "will-smith", name: "Will Smith" },
  { id: "adele", name: "Adele" },
  { id: "the-weeknd", name: "The Weeknd" },
];

async function wiki(params: Record<string, string>) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  return res.json();
}

function sha(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function enrollSha(id: string): string | null {
  const p = path.join(ROOT, "public/celebs", `${id}.jpg`);
  if (!fs.existsSync(p)) return null;
  return sha(fs.readFileSync(p));
}

async function imageList(title: string) {
  const j = await wiki({
    action: "query",
    titles: title,
    generator: "images",
    gimlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "800",
  });
  const pages = Object.values(j.query?.pages ?? {}) as Array<{
    title?: string;
    imageinfo?: Array<{
      mime?: string;
      url?: string;
      thumburl?: string;
      thumbwidth?: number;
      thumbheight?: number;
      width?: number;
      height?: number;
    }>;
  }>;
  const out: Array<{ url: string; title: string; w: number; h: number }> = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const mime = String(info.mime || "");
    if (!mime.startsWith("image/") || mime.includes("svg")) continue;
    if (SKIP.test(p.title || "") || SKIP.test(info.url || "")) continue;
    const w = Number(info.thumbwidth || info.width || 0);
    const h = Number(info.thumbheight || info.height || 0);
    if (Math.min(w, h) < 200) continue;
    out.push({ url: info.thumburl || info.url || "", title: p.title || "", w, h });
  }
  // Prefer portrait-ish, mid-size (less likely a poster/group)
  out.sort((a, b) => {
    const ap = a.h >= a.w * 0.95 ? 0 : 1;
    const bp = b.h >= b.w * 0.95 ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return Math.abs(a.w - 600) - Math.abs(b.w - 600);
  });
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cases: Array<{ id: string; name: string; imagePath: string; sourceUrl: string }> = [];

  for (const c of CONTROLS) {
    const destDir = path.join(OUT, c.id);
    const dest = path.join(destDir, "001.jpg");
    try {
      const imgs = await imageList(c.name);
      const enrolled = enrollSha(c.id);
      let saved = false;
      for (const img of imgs.slice(0, 10)) {
        const res = await fetch(img.url, { headers: { "User-Agent": UA } });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 8000) continue;
        if (enrolled && sha(buf) === enrolled) continue;
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(dest, buf);
        cases.push({
          id: c.id,
          name: c.name,
          imagePath: `/celebs/control/${c.id}/001.jpg`,
          sourceUrl: img.url,
        });
        console.log(`+ ${c.id}  ${img.title}  ${buf.length}b  ${img.w}x${img.h}`);
        saved = true;
        break;
      }
      if (!saved) console.log(`- ${c.id}  no alternate portrait`);
    } catch (e) {
      console.log(`! ${c.id}  ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const manifest = { version: "1.0.0", description: "Clean single-face control queries", count: cases.length, cases };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`wrote ${cases.length} control photos`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
