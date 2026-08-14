#!/usr/bin/tsx
/**
 * Fetch a distinct second portrait for primary-gallery celebs that
 * still lack a held-out query. Query photos only — never enrolled.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TwinframeSelfQuery/1.0 (local identity eval) Node.js";
const DELAY = Number(process.env.SELF_FETCH_DELAY_MS || 900);
const SKIP =
  /logo|icon|flag|coat|arms|crest|signature|wordmark|poster|soundtrack|\.svg|symbol|map of|diagram|album|cover|cast of|season \d|family|stadium|building|hall of|autograph|holbein|cartouche|michael jackson|r\. kelly|portrait of a young|1962|2pac|tupac|hallstr[oö]m|georgiana|tussauds|wax|school record|lorde|ayesha curry|handprint|walk of fame|black panther|cosplay|costume|mask/i;

const buckets = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/celebs/gallery.buckets.json"), "utf8"),
) as Array<{ id: string; name: string; fallbackPath?: string }>;
const heldPack = fs.existsSync(path.join(ROOT, "public/celebs/held-out/descriptors.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "public/celebs/held-out/descriptors.json"), "utf8"))
  : { cases: [] };

const haveDesc = new Set(
  (heldPack.cases ?? [])
    .filter((c: { descriptor?: number[] }) => c.descriptor?.length === 128)
    .map((c: { id: string }) => c.id),
);

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
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`wiki ${res.status}`);
    return res.json();
  }
  throw new Error("wiki 429");
}

async function resolveTitle(name: string): Promise<string | null> {
  const j = await wiki({ action: "query", list: "search", srsearch: name, srlimit: "3", srnamespace: "0" });
  return j.query?.search?.[0]?.title ?? null;
}

async function pageImages(title: string) {
  const j = await wiki({
    action: "query",
    titles: title,
    generator: "images",
    gimlimit: "18",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "900",
  });
  const pages = Object.values(j.query?.pages ?? {}) as Array<{
    title?: string;
    imageinfo?: Array<{ mime?: string; url?: string; thumburl?: string; thumbwidth?: number; thumbheight?: number }>;
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
    const ap = a.h >= a.w * 0.9 ? 0 : 1;
    const bp = b.h >= b.w * 0.9 ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ac = /cropped|portrait|gage/i.test(a.title) ? 0 : 1;
    const bc = /cropped|portrait|gage/i.test(b.title) ? 0 : 1;
    return ac - bc;
  });
  return out;
}

const targets = buckets.filter((b) => {
  const primary =
    (b.fallbackPath || "").includes(`/${b.id}.jpg`) ||
    fs.existsSync(path.join(ROOT, "public/celebs", `${b.id}.jpg`));
  if (!primary) return false;
  if (haveDesc.has(b.id)) return false;
  return true;
});

async function main() {
  console.log(`self-query fetch targets=${targets.length}`);
  let ok = 0;
  let fail = 0;
  for (const b of targets) {
    const dest = path.join(ROOT, "public/celebs/held-out", b.id, "001.jpg");
    const blocked = new Set<string>();
    for (const rel of [
      path.join(ROOT, "public/celebs", `${b.id}.jpg`),
      path.join(ROOT, "public/celebs/control", b.id, "001.jpg"),
      dest,
    ]) {
      const s = fileSha(rel);
      if (s) blocked.add(s);
    }
    process.stdout.write(`${b.id} … `);
    try {
      const title = await resolveTitle(b.name);
      if (!title) {
        console.log("no wiki");
        fail++;
        await new Promise((r) => setTimeout(r, DELAY));
        continue;
      }
      const imgs = await pageImages(title);
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
  console.log(`done 001 ok=${ok} fail=${fail}`);

  // Second distinct query photo for celebs that already have an encoded 001.
  const second = buckets.filter((b) => {
    const primary =
      (b.fallbackPath || "").includes(`/${b.id}.jpg`) ||
      fs.existsSync(path.join(ROOT, "public/celebs", `${b.id}.jpg`));
    if (!primary) return false;
    const one = path.join(ROOT, "public/celebs/held-out", b.id, "001.jpg");
    const two = path.join(ROOT, "public/celebs/held-out", b.id, "002.jpg");
    return fs.existsSync(one) && !fs.existsSync(two);
  }).slice(0, Number(process.env.SELF_FETCH_002_LIMIT || 150));

  console.log(`self-query 002 targets=${second.length}`);
  let ok2 = 0;
  let fail2 = 0;
  for (const b of second) {
    const dest = path.join(ROOT, "public/celebs/held-out", b.id, "002.jpg");
    const blocked = new Set<string>();
    for (const rel of [
      path.join(ROOT, "public/celebs", `${b.id}.jpg`),
      path.join(ROOT, "public/celebs/control", b.id, "001.jpg"),
      path.join(ROOT, "public/celebs/held-out", b.id, "001.jpg"),
    ]) {
      const s = fileSha(rel);
      if (s) blocked.add(s);
    }
    process.stdout.write(`002 ${b.id} … `);
    try {
      const title = await resolveTitle(b.name);
      if (!title) {
        console.log("no wiki");
        fail2++;
        await new Promise((r) => setTimeout(r, DELAY));
        continue;
      }
      const imgs = await pageImages(title);
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
        ok2++;
        landed = true;
        break;
      }
      if (!landed) {
        console.log("no alt");
        fail2++;
      }
    } catch (e) {
      console.log((e as Error).message);
      fail2++;
    }
    await new Promise((r) => setTimeout(r, DELAY));
  }
  console.log(`done 002 ok=${ok2} fail=${fail2}`);

  const third = buckets
    .filter((b) => {
      const d = path.join(ROOT, "public/celebs/held-out", b.id);
      return fs.existsSync(path.join(d, "001.jpg")) && fs.existsSync(path.join(d, "002.jpg")) && !fs.existsSync(path.join(d, "003.jpg"));
    })
    .slice(0, Number(process.env.SELF_FETCH_003_LIMIT || 120));

  console.log(`self-query 003 targets=${third.length}`);
  let ok3 = 0;
  let fail3 = 0;
  for (const b of third) {
    const dest = path.join(ROOT, "public/celebs/held-out", b.id, "003.jpg");
    const blocked = new Set<string>();
    for (const rel of [
      path.join(ROOT, "public/celebs", `${b.id}.jpg`),
      path.join(ROOT, "public/celebs/control", b.id, "001.jpg"),
      path.join(ROOT, "public/celebs/held-out", b.id, "001.jpg"),
      path.join(ROOT, "public/celebs/held-out", b.id, "002.jpg"),
    ]) {
      const s = fileSha(rel);
      if (s) blocked.add(s);
    }
    process.stdout.write(`003 ${b.id} … `);
    try {
      const title = await resolveTitle(b.name);
      if (!title) {
        console.log("no wiki");
        fail3++;
        await new Promise((r) => setTimeout(r, DELAY));
        continue;
      }
      const imgs = await pageImages(title);
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
        ok3++;
        landed = true;
        break;
      }
      if (!landed) {
        console.log("no alt");
        fail3++;
      }
    } catch (e) {
      console.log((e as Error).message);
      fail3++;
    }
    await new Promise((r) => setTimeout(r, DELAY));
  }
  console.log(`done 003 ok=${ok3} fail=${fail3}`);

  const fourth = buckets
    .filter((b) => {
      const d = path.join(ROOT, "public/celebs/held-out", b.id);
      return (
        fs.existsSync(path.join(d, "001.jpg")) &&
        fs.existsSync(path.join(d, "002.jpg")) &&
        fs.existsSync(path.join(d, "003.jpg")) &&
        !fs.existsSync(path.join(d, "004.jpg"))
      );
    })
    .slice(0, Number(process.env.SELF_FETCH_004_LIMIT || 70));

  console.log(`self-query 004 targets=${fourth.length}`);
  let ok4 = 0;
  let fail4 = 0;
  for (const b of fourth) {
    const dest = path.join(ROOT, "public/celebs/held-out", b.id, "004.jpg");
    const blocked = new Set<string>();
    for (const rel of [
      path.join(ROOT, "public/celebs", `${b.id}.jpg`),
      path.join(ROOT, "public/celebs/control", b.id, "001.jpg"),
      path.join(ROOT, "public/celebs/held-out", b.id, "001.jpg"),
      path.join(ROOT, "public/celebs/held-out", b.id, "002.jpg"),
      path.join(ROOT, "public/celebs/held-out", b.id, "003.jpg"),
    ]) {
      const s = fileSha(rel);
      if (s) blocked.add(s);
    }
    process.stdout.write(`004 ${b.id} … `);
    try {
      const title = await resolveTitle(b.name);
      if (!title) {
        console.log("no wiki");
        fail4++;
        await new Promise((r) => setTimeout(r, DELAY));
        continue;
      }
      const imgs = await pageImages(title);
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
        ok4++;
        landed = true;
        break;
      }
      if (!landed) {
        console.log("no alt");
        fail4++;
      }
    } catch (e) {
      console.log((e as Error).message);
      fail4++;
    }
    await new Promise((r) => setTimeout(r, DELAY));
  }
  console.log(`done 004 ok=${ok4} fail=${fail4}`);
}

main();
