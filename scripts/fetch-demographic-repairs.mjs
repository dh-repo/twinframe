#!/usr/bin/env node
/**
 * One-off: fetch alternate Wikipedia/Commons portraits for celebs whose
 * enrolled encoding produced low-confidence demographics, so the detector can
 * produce a confident read from a clearer source photo.
 *
 *   node scripts/fetch-demographic-repairs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const UA = "TwinframeDemographicRepair/1.0 (local enrollment quality) Node.js";

// Default targets kept for provenance; pass --ids a,b,c to fetch extra views.
const DEFAULT_TARGETS = [
  { id: "greta-lee", query: "Greta Lee", wantGender: "female" },
  { id: "don-cheadle", query: "Don Cheadle", wantGender: "male" },
];
const idsArg = process.argv.indexOf("--ids");
const TARGETS = idsArg >= 0
  ? process.argv[idsArg + 1].split(",").map((id) => ({
      id,
      query: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    }))
  : DEFAULT_TARGETS;
const MAX_NEW_PER_CELEB = Number(process.env.MAX_NEW_PER_CELEB || 2);

async function commons(params) {
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

const SKIP = /logo|icon|flag|coat|arms|crest|signature|poster|\.svg|map|diagram|album|cover|cast of|wax|tussauds|cosplay|costume|handprint|walk of fame|premiere|festival|conference|panel|ceremony|djvu|painting|peasant|statelibqld|elizabeth i|comparator|index\.|1890s|1550/i;

async function main() {
  for (const t of TARGETS) {
    const dir = path.join(CELEBS, "extra-photos", t.id);
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).length;

    const search = await commons({
      action: "query",
      list: "search",
      srsearch: `${t.query} portrait`,
      srnamespace: "6",
      srlimit: "12",
    });
    const titles = (search.query?.search ?? []).map((s) => s.title).filter((title) => !SKIP.test(title));
    if (!titles.length) {
      console.log(`[${t.id}] no candidate files`);
      continue;
    }
    const infos = await commons({
      action: "query",
      titles: titles.slice(0, 10).join("|"),
      prop: "imageinfo",
      iiprop: "url|size|mime",
      iiurlwidth: "900",
    });
    const pages = Object.values(infos.query?.pages ?? {});
    let saved = existing;
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const mime = String(info.mime || "");
      if (!mime.startsWith("image/") || mime.includes("svg")) continue;
      const w = Number(info.thumbwidth || 0);
      const h = Number(info.thumbheight || 0);
      // Prefer upright head-and-shoulders sources.
      if (Math.min(w, h) < 300 || h < w * 0.9) continue;
      const res = await fetch(info.thumburl || info.url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      saved += 1;
      const out = path.join(dir, `${String(saved).padStart(3, "0")}.jpg`);
      fs.writeFileSync(out, buf);
      console.log(`[${t.id}] saved ${out} (${buf.byteLength} bytes) <- ${p.title}`);
      if (saved - existing >= MAX_NEW_PER_CELEB) break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
