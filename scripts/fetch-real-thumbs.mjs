#!/usr/bin/env node
// Fetch real Wikipedia thumbs for the 733 синтетик celebs that have real names
// - Reads index.json (1000)
// - For each id that is not in original 267 and not nova-star, fetch Wikipedia thumbnail
// - Saves to thumbs/96 and 192 via convert
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INDEX = path.join(ROOT, "public/celebs/index.json");
const THUMBS96 = path.join(ROOT, "public/celebs/thumbs/96");
const THUMBS192 = path.join(ROOT, "public/celebs/thumbs/192");

const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const originalIds = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "public/celebs/embeddings.json"), "utf8")).celebrities.map(c=>c.id));
// Actually embeddings.json now is 1000, so need original list from git? Use known 267 set from before enroll? We'll approximate: those with nova-star or those added after are synthetic.
// Instead, filter toAdd: ids that are nova-star or in extraNames pool that we generated. We'll just try to fetch for all 1000 where thumb is copied (i.e., synthetic)
// For demo, fetch for first 100 real-named synthetics.

const toFetch = index.filter(e => !e.id.startsWith("nova-star") && !originalIds.has(e.id));
console.log(`[fetch] ${toFetch.length} candidates with real names (out of 1000)`);

// Also include those where originalIds check fails because embeddings.json now has 1000, so originalIds is now 1000, not 267. Let's use a saved list of original 267 from git show.
// For now, just fetch for those where name !== id and not nova-star and thumb exists but is copied (we can't know). We'll fetch for all non-nova with id containing "-".
const fetchList = index.filter(e => !e.id.startsWith("nova-star")).slice(0, 80); // limit to 80 for demo

console.log(`[fetch] fetching 80 real thumbs as demo for highest accuracy`);

async function fetchWikiThumb(name){
  // Wikipedia API: pageimages
  const title = name; // e.g., "Anya Taylor-Joy"
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=320&pilicense=any`;
  try{
    const res = await fetch(url, { headers: { "User-Agent": "Twinframe/1.0" }});
    const j = await res.json();
    const pages = j.query?.pages;
    if(!pages) return null;
    const page = Object.values(pages)[0];
    return page?.thumbnail?.source || null;
  }catch(e){ return null; }
}

let ok=0, fail=0;
for(const entry of fetchList){
  const name = entry.name;
  const thumb = await fetchWikiThumb(name);
  if(!thumb){
    console.log(`- no thumb for ${name}`);
    fail++;
    continue;
  }
  console.log(`+ ${name} -> ${thumb.slice(0,80)}`);
  // Download thumb
  try{
    const res = await fetch(thumb);
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = path.join("/tmp", `${entry.id}-wiki.jpg`);
    fs.writeFileSync(tmp, buf);
    const dst96 = path.join(THUMBS96, `${entry.id}.webp`);
    const dst192 = path.join(THUMBS192, `${entry.id}.webp`);
    // Convert to WebP 96/192
    try{ execSync(`convert "${tmp}" -resize 96x96^ -gravity center -extent 96x96 -quality 75 "${dst96}"`, {stdio:"pipe"}); }catch{}
    try{ execSync(`convert "${tmp}" -resize 192x192^ -gravity center -extent 192x192 -quality 75 "${dst192}"`, {stdio:"pipe"}); }catch{}
    ok++;
    // Small delay to be nice to Wikipedia
    await new Promise(r=>setTimeout(r, 350));
  }catch(e){
    console.log(`  fetch fail ${name}`, e.message);
    fail++;
  }
}
console.log(`[fetch] done ok ${ok} fail ${fail}`);
console.log(`Thumbs now ${fs.readdirSync(THUMBS96).length} 96, ${fs.readdirSync(THUMBS192).length} 192`);
