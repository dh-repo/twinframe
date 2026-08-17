#!/usr/bin/env node
/**
 * Decode webp gallery thumbs to PNG via headless Chromium (node-canvas lacks webp).
 * Writes /tmp/twinframe-thumbs-png/<id>.png for ids missing a hi-res jpg.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CELEBS = path.join(ROOT, "public/celebs");
const OUT = "/tmp/twinframe-thumbs-png";
fs.mkdirSync(OUT, { recursive: true });

const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
const need = buckets
  .map((b) => b.id)
  .filter((id) => !fs.existsSync(path.join(CELEBS, `${id}.jpg`)))
  .filter((id) => !fs.existsSync(path.join(OUT, `${id}.png`)))
  .filter((id) => fs.existsSync(path.join(CELEBS, "thumbs/192", `${id}.webp`)));

console.log(`converting ${need.length} thumbs`);
if (need.length === 0) process.exit(0);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });

const CHUNK = 50;
for (let i = 0; i < need.length; i += CHUNK) {
  const ids = need.slice(i, i + CHUNK);
  const results = await page.evaluate(async (idList) => {
    const out = [];
    for (const id of idList) {
      try {
        const res = await fetch(`/celebs/thumbs/192/${id}.webp`);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext("2d").drawImage(bmp, 0, 0);
        out.push({ id, dataUrl: canvas.toDataURL("image/png") });
      } catch (e) {
        out.push({ id, error: String(e) });
      }
    }
    return out;
  }, ids);
  for (const r of results) {
    if (r.dataUrl) {
      fs.writeFileSync(
        path.join(OUT, `${r.id}.png`),
        Buffer.from(r.dataUrl.split(",")[1], "base64"),
      );
    } else {
      console.error("FAIL", r.id, r.error);
    }
  }
  process.stdout.write(`\r${Math.min(i + CHUNK, need.length)}/${need.length}`);
}
console.log("\ndone");
await browser.close();
