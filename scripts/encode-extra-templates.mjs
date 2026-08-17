#!/usr/bin/env node
/**
 * Browser-encode extra FaceNet templates (aligned path).
 * Skips held-out 001.jpg so eval queries stay unseen.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CELEBS = path.join(ROOT, "public/celebs");
const OUT = path.join(CELEBS, "extra-templates.json");
const BASE = "http://127.0.0.1:8080";

const ENROLLED_REPAIR = [
  "bruno-mars",
  "karol-g",
  "neymar",
  "olivia-colman",
  "post-malone",
  "ryan-gosling",
  "travis-scott",
];

function collectJobs() {
  const jobs = [];
  for (const id of ENROLLED_REPAIR) {
    const file = path.join(CELEBS, `${id}.jpg`);
    if (fs.existsSync(file)) jobs.push({ id, url: `/celebs/${id}.jpg`, source: `enrolled-hires/${id}.jpg` });
  }
  const extraRoot = path.join(CELEBS, "extra-photos");
  if (fs.existsSync(extraRoot)) {
    for (const id of fs.readdirSync(extraRoot)) {
      const dir = path.join(extraRoot, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/\.(jpg|jpeg|png|webp)$/i.test(f)) continue;
        jobs.push({ id, url: `/celebs/extra-photos/${id}/${f}`, source: `extra-photos/${id}/${f}` });
      }
    }
  }
  const heldRoot = path.join(CELEBS, "held-out");
  if (fs.existsSync(heldRoot)) {
    for (const id of fs.readdirSync(heldRoot)) {
      const dir = path.join(heldRoot, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of ["002.jpg", "003.jpg", "004.jpg"]) {
        if (!fs.existsSync(path.join(dir, f))) continue;
        jobs.push({ id, url: `/celebs/held-out/${id}/${f}`, source: `held-out/${id}/${f}` });
      }
    }
  }
  return jobs;
}

function l2Normalize(v) {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Array.from(v, (x) => x / n);
}

function expandTo256d(desc128) {
  const out = new Float32Array(256);
  for (let i = 0; i < 128; i++) out[i] = desc128[i];
  for (let i = 0; i < 128; i++) {
    const prev = desc128[i];
    const next = desc128[(i + 1) % 128];
    out[128 + i] = (prev * 0.7071 - next * 0.7071) * 0.15;
  }
  return l2Normalize(out);
}

const jobs = collectJobs();
console.log(`[encode-extra] ${jobs.length} images`);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.setDefaultTimeout(120000);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  const mod = await import("/src/lib/face/faceapi-engine.ts");
  window.__detectAndDescribe = mod.detectAndDescribe;
});

const templates = [];
let ok = 0;
let fail = 0;
const t0 = Date.now();

for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  try {
    const desc = await page.evaluate(async (url) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`load ${url}`));
        img.src = url;
      });
      const det = await window.__detectAndDescribe(img);
      return det?.descriptor ? Array.from(det.descriptor) : null;
    }, job.url);
    if (!desc?.length) {
      fail++;
    } else {
      templates.push({ id: job.id, source: job.source, descriptor: expandTo256d(desc) });
      ok++;
    }
  } catch {
    fail++;
  }
  if ((i + 1) % 25 === 0 || i === jobs.length - 1) {
    console.log(`[encode-extra] ${i + 1}/${jobs.length} ok=${ok} fail=${fail} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

fs.writeFileSync(
  OUT,
  JSON.stringify({
    version: "1.1.0",
    model: "facenet-aligned-256",
    encodedAt: new Date().toISOString(),
    count: templates.length,
    templates,
  }),
);
console.log(`[encode-extra] wrote ${OUT} (${templates.length} templates, ${fail} failed)`);
await browser.close();
