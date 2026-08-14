#!/usr/bin/env tsx
/**
 * Download a *different* Wikipedia / Commons portrait per celebrity for
 * held-out Rank-1. Writes public/celebs/held-out/<id>/001.jpg + manifest.json.
 *
 * Does not add these images to the gallery — they are query photos only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "public/celebs/index.json");
const OUT_DIR = path.join(ROOT, "public/celebs/held-out");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const UA = "TwinframeHeldOut/1.0 (local accuracy eval; github.com/twinframe) Node.js";

const LIMIT = Number(process.env.HELD_OUT_LIMIT || 204);
const DELAY_MS = Number(process.env.HELD_OUT_DELAY_MS || 280);

interface IndexEntry {
  id: string;
  name: string;
  fallbackPath?: string;
  path?: string;
}

interface ManifestRow {
  id: string;
  name: string;
  imagePath: string;
  sourceUrl: string;
  wikiTitle: string;
}

const SKIP_NAME = /logo|icon|flag|coat|signature|wordmark|poster|soundtrack|\.svg|symbol|map of|diagram/i;

async function wiki(params: Record<string, string>): Promise<any> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error(`wiki ${res.status} ${url.searchParams.get("action")}`);
  return res.json();
}

function fileSha(p: string): string | null {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function enrollPath(entry: IndexEntry): string | null {
  const rel = entry.fallbackPath || entry.path;
  if (!rel) return null;
  const abs = path.join(ROOT, "public", rel.replace(/^\//, ""));
  return fs.existsSync(abs) ? abs : null;
}

async function resolveTitle(name: string): Promise<string | null> {
  const j = await wiki({
    action: "query",
    list: "search",
    srsearch: name,
    srlimit: "3",
    srnamespace: "0",
  });
  const hit = j.query?.search?.[0];
  return hit?.title ?? null;
}

async function pageImageTitle(title: string): Promise<string | null> {
  const j = await wiki({
    action: "query",
    titles: title,
    prop: "pageimages",
    pithumbsize: "320",
    pilicense: "any",
  });
  const page = Object.values(j.query?.pages ?? {})[0] as any;
  return page?.pageimage ? `File:${page.pageimage}` : null;
}

async function pageImages(title: string): Promise<Array<{ url: string; title: string }>> {
  const j = await wiki({
    action: "query",
    titles: title,
    generator: "images",
    gimlimit: "16",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "900",
  });
  const pages = Object.values(j.query?.pages ?? {}) as any[];
  const out: Array<{ url: string; title: string }> = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const mime = String(info.mime || "");
    if (!mime.startsWith("image/") || mime.includes("svg")) continue;
    if (SKIP_NAME.test(p.title || "") || SKIP_NAME.test(info.url || "")) continue;
    const w = Number(info.thumbwidth || info.width || 0);
    const h = Number(info.thumbheight || info.height || 0);
    if (Math.min(w, h) < 160) continue;
    out.push({ url: info.thumburl || info.url, title: p.title });
  }
  return out;
}

async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4_000) return null;
  return buf;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const index = JSON.parse(fs.readFileSync(INDEX, "utf8")) as IndexEntry[];
  const slice = index.slice(0, LIMIT);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const existing: ManifestRow[] = fs.existsSync(MANIFEST)
    ? (JSON.parse(fs.readFileSync(MANIFEST, "utf8")).cases ?? [])
    : [];
  const have = new Set(existing.map((r) => r.id));
  const rows = [...existing];

  let ok = 0;
  let skip = 0;
  let fail = 0;

  console.log(`held-out fetch: ${slice.length} celebs (have ${have.size})`);

  for (const entry of slice) {
    const destDir = path.join(OUT_DIR, entry.id);
    const dest = path.join(destDir, "001.jpg");
    if (have.has(entry.id) && fs.existsSync(dest)) {
      skip++;
      continue;
    }

    try {
      const title = await resolveTitle(entry.name);
      if (!title) {
        console.log(`- no wiki title  ${entry.id}`);
        fail++;
        await sleep(DELAY_MS);
        continue;
      }
      const infobox = await pageImageTitle(title);
      const imgs = await pageImages(title);
      const enroll = enrollPath(entry);
      const enrollSha = enroll ? fileSha(enroll) : null;

      const ordered = [
        ...imgs.filter((i) => infobox && i.title !== infobox),
        ...imgs.filter((i) => !infobox || i.title === infobox),
      ];

      let saved = false;
      for (const cand of ordered) {
        const buf = await download(cand.url);
        if (!buf) continue;
        const sha = crypto.createHash("sha256").update(buf).digest("hex");
        if (enrollSha && sha === enrollSha) continue;
        if (enroll && Math.abs(buf.length - fs.statSync(enroll).size) < 80) continue;
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(dest, buf);
        const rel = `/celebs/held-out/${entry.id}/001.jpg`;
        rows.push({
          id: entry.id,
          name: entry.name,
          imagePath: rel,
          sourceUrl: cand.url,
          wikiTitle: title,
        });
        have.add(entry.id);
        console.log(`+ ${entry.id}  ← ${title}  (${cand.title})`);
        ok++;
        saved = true;
        break;
      }
      if (!saved) {
        console.log(`- no alt image   ${entry.id} (${title})`);
        fail++;
      }
    } catch (e) {
      console.log(`- error ${entry.id}: ${e instanceof Error ? e.message : e}`);
      fail++;
    }
    await sleep(DELAY_MS);
  }

  const unique = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    unique.push(r);
  }
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        version: "1.0.0",
        description: "Held-out query photos (not enrolled). Second Wikipedia image per id.",
        count: unique.length,
        cases: unique,
      },
      null,
      2,
    ),
  );
  console.log(`done ok=${ok} skip=${skip} fail=${fail} manifest=${unique.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
