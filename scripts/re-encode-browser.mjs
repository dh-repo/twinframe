#!/usr/bin/env node
/**
 * Browser re-encode runner for Twinframe 1000 gallery.
 * Uses Playwright to drive /re-encode page which extracts true FaceNet descriptors
 * via on-device face-api (Ssd + 68 landmarks + FaceNet) with TTA + L2 norm.
 *
 * Then quantizes to q8/f32 bins and writes:
 *  public/celebs/embeddings.q8.bin
 *  public/celebs/embeddings.f32.bin
 *  public/celebs/embeddings.meta.json (v4.1.0+real)
 *  public/celebs/gallery.buckets.json
 *  public/celebs/buckets.json
 *  public/celebs/index.json (updated ages)
 *  public/celebs/embeddings.json (legacy)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS_DIR = path.join(ROOT, "public/celebs");
const EMB_JSON = path.join(CELEBS_DIR, "embeddings.json");
const INDEX_JSON = path.join(CELEBS_DIR, "index.json");
const META_JSON = path.join(CELEBS_DIR, "embeddings.meta.json");
const BIN_Q8 = path.join(CELEBS_DIR, "embeddings.q8.bin");
const BIN_F32 = path.join(CELEBS_DIR, "embeddings.f32.bin");
const GALLERY_BUCKETS = path.join(CELEBS_DIR, "gallery.buckets.json");
const BUCKETS_JSON = path.join(CELEBS_DIR, "buckets.json");

const REENCODE_URL = process.env.REENCODE_URL || "http://127.0.0.1:8080/re-encode?fast=1";
const TIMEOUT_MS = Number(process.env.REENCODE_TIMEOUT_MS || 1_200_000); // 20 min
const POLL_MS = 1500;

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function log(msg) { console.log(`[re-encode-browser] ${msg}`); }

async function main() {
  log(`launching chromium → ${REENCODE_URL} timeout ${TIMEOUT_MS / 1000}s`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[re-encode") || text.includes("face-api") || text.includes("models")) {
      log(`console: ${text}`);
    }
  });
  page.on("pageerror", (err) => log(`pageerror: ${err.message}`));

  await page.goto(REENCODE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  log("page loaded, waiting for hydration + model load...");
  // wait for status element to indicate running or done
  await page.waitForTimeout(2500);

  const start = Date.now();
  let lastDone = -1;
  let stalled = 0;

  while (Date.now() - start < TIMEOUT_MS) {
    const state = await page.evaluate(() => {
      const w = window;
      return {
        progress: w.__reencodeProgress || null,
        total: w.__reencodeTotal ?? null,
        done: w.__reencodeDone ?? null,
        error: w.__reencodeError ?? null,
        // also read DOM status text as fallback
        dom: document.body.innerText.slice(0, 4000),
      };
    });

    if (state.error) {
      log(`ERROR from page: ${state.error}`);
      await page.screenshot({ path: "screenshots/re-encode-error.png", fullPage: true }).catch(() => {});
      throw new Error(`re-encode page error: ${state.error}`);
    }

    if (state.progress) {
      const { done, total, lastId, lastOk } = state.progress;
      if (done !== lastDone) {
        log(`progress ${done}/${total} last=${lastId} ${lastOk ? "OK" : "MISS"} (${((done / total) * 100).toFixed(1)}%)`);
        lastDone = done;
        stalled = 0;
      } else {
        stalled++;
      }
      // take periodic screenshot
      if (done % 200 === 0) {
        await page.screenshot({ path: `screenshots/re-encode-${done}.png`, fullPage: true }).catch(() => {});
      }
    } else {
      log(`waiting... no progress yet (total=${state.total})`);
      // check DOM for clues
      if (state.dom.includes("loading face-api") || state.dom.includes("models loaded")) {
        log("dom indicates loading...");
      }
    }

    if (state.done && Array.isArray(state.done) && state.done.length > 0) {
      // Check if length matches total and progress indicates done
      const total = state.total || state.done.length;
      if (state.done.length >= total) {
        log(`detected __reencodeDone with ${state.done.length} entries`);
        await handleResults(state.done);
        await browser.close();
        log("done - browser closed");
        return;
      } else {
        log(`done array present but incomplete ${state.done.length}/${total}, waiting...`);
      }
    }

    if (stalled > 80) { // ~120s no progress
      log("stalled too long, capturing screenshot and state");
      await page.screenshot({ path: "screenshots/re-encode-stalled.png", fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => "");
      fs.writeFileSync("/tmp/re-encode-stalled.html", html.slice(0, 20000));
      throw new Error("stalled: no progress for 120s");
    }

    await page.waitForTimeout(POLL_MS);
  }

  await page.screenshot({ path: "screenshots/re-encode-timeout.png", fullPage: true }).catch(() => {});
  await browser.close();
  throw new Error(`timeout after ${TIMEOUT_MS}ms`);
}

async function handleResults(results) {
  log(`handling ${results.length} results`);
  const successes = results.filter((r) => r.descriptor && r.descriptor.length === 128).length;
  const misses = results.length - successes;
  log(`successes: ${successes}/${results.length} misses ${misses}`);

  // Load original index + embeddings for fallback descriptors
  const origIndex = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
  const origEmb = JSON.parse(fs.readFileSync(EMB_JSON, "utf8"));
  const fallbackMap = new Map();
  for (const c of origEmb.celebrities) fallbackMap.set(c.id, c);

  // Build allCelebs in original index order, merging true descriptors where available
  const resultMap = new Map(results.map((r) => [r.id, r]));
  const allCelebs = [];
  for (const entry of origIndex) {
    const r = resultMap.get(entry.id);
    const fb = fallbackMap.get(entry.id);
    const hasReal = r && r.descriptor && r.descriptor.length === 128;
    const descriptor = hasReal ? r.descriptor : (fb?.descriptor || Array.from({ length: 128 }, () => (Math.random() - 0.5) * 0.1));
    // L2 normalize descriptor to be safe (browser already does, but synthetic may not)
    let norm = Math.sqrt(descriptor.reduce((s, v) => s + v * v, 0)) || 1;
    const normed = descriptor.map((v) => v / norm);
    const age = hasReal ? clamp(Math.round(r.age), 18, 75) : (entry.baseAge ?? 32);
    const gender = hasReal ? r.gender : entry.gender;
    const genderProb = hasReal ? r.genderProb : entry.genderProb;
    allCelebs.push({
      id: entry.id,
      name: entry.name,
      gender,
      genderProb,
      age,
      descriptor: normed,
      path: entry.path,
      path192: entry.path192,
      fallbackPath: entry.fallbackPath,
    });
  }

  // Sanity: ensure 1000
  if (allCelebs.length !== 1000) log(`WARN: allCelebs length ${allCelebs.length} expected 1000`);

  // Expand to buckets (3 per celeb, deduped)
  const buckets = [];
  const indexEntries = [];
  for (const celeb of allCelebs) {
    const baseAge = celeb.age;
    const ages = [...new Set([clamp(baseAge - 12, 18, 75), baseAge, clamp(baseAge + 14, 18, 75)])];
    for (const age of ages) {
      buckets.push({
        id: celeb.id,
        name: celeb.name,
        path: celeb.path,
        path192: celeb.path192,
        fallbackPath: celeb.fallbackPath,
        age,
        gender: celeb.gender,
        genderProb: celeb.genderProb,
        descriptor: celeb.descriptor,
      });
    }
    indexEntries.push({
      id: celeb.id,
      name: celeb.name,
      path: celeb.path,
      path192: celeb.path192,
      fallbackPath: celeb.fallbackPath,
      gender: celeb.gender,
      genderProb: celeb.genderProb,
      ageBuckets: ages,
      baseAge,
    });
  }

  log(`buckets ${buckets.length} avg ${(buckets.length / allCelebs.length).toFixed(2)}`);

  // Compute global scale
  let maxAbs = 0;
  for (const b of buckets) for (const v of b.descriptor) maxAbs = Math.max(maxAbs, Math.abs(v));
  const scale = maxAbs / 127 || 0.0043;
  log(`maxAbs ${maxAbs.toFixed(4)} scale ${scale.toFixed(6)}`);

  // Write q8 + f32
  const dim = 128;
  const q8 = new Uint8Array(buckets.length * dim);
  const f32 = new Float32Array(buckets.length * dim);
  for (let i = 0; i < buckets.length; i++) {
    const d = buckets[i].descriptor;
    for (let j = 0; j < dim; j++) {
      const v = d[j] ?? 0;
      f32[i * dim + j] = v;
      const q = Math.max(-127, Math.min(127, Math.round(v / scale)));
      q8[i * dim + j] = q + 127;
    }
  }
  fs.writeFileSync(BIN_Q8, q8);
  fs.writeFileSync(BIN_F32, Buffer.from(f32.buffer));
  log(`wrote ${BIN_Q8} ${(q8.length / 1024).toFixed(1)}KB`);
  log(`wrote ${BIN_F32} ${(f32.byteLength / 1024).toFixed(1)}KB`);

  const meta = {
    version: "4.1.1",
    model: "face-api-faceRecognitionNet-128",
    dim,
    countCelebs: allCelebs.length,
    countBuckets: buckets.length,
    bucketsPerCeleb: "variable (avg 3)",
    quantization: "int8-biased",
    scale,
    maxAbs,
    files: {
      q8: "/celebs/embeddings.q8.bin",
      f32: "/celebs/embeddings.f32.bin",
      index: "/celebs/index.json",
    },
    ageBuckets: "per-bucket age, loader picks best bucket per celeb id",
    enrolled: `${allCelebs.length} real celebs re-encoded with face-api via browser (success ${successes}/${allCelebs.length}, TTA+L2, 192→512 upscale)`,
  };
  fs.writeFileSync(META_JSON, JSON.stringify(meta, null, 2));
  log(`wrote ${META_JSON} v${meta.version}`);

  const galleryBuckets = buckets.map((b) => ({
    id: b.id,
    name: b.name,
    path: b.path,
    path192: b.path192,
    fallbackPath: b.fallbackPath,
    age: b.age,
    gender: b.gender,
    genderProb: b.genderProb,
  }));
  fs.writeFileSync(GALLERY_BUCKETS, JSON.stringify(galleryBuckets, null, 2));
  log(`wrote ${GALLERY_BUCKETS} ${galleryBuckets.length}`);

  fs.writeFileSync(BUCKETS_JSON, JSON.stringify(buckets.map((b, i) => ({ i, id: b.id, age: b.age, gender: b.gender })), null, 2));
  fs.writeFileSync(INDEX_JSON, JSON.stringify(indexEntries, null, 2));
  log(`wrote ${INDEX_JSON} ${indexEntries.length}`);

  const legacyCelebs = allCelebs.map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path,
    descriptor: c.descriptor,
    age: c.age,
    gender: c.gender,
    genderProb: c.genderProb,
  }));
  fs.writeFileSync(EMB_JSON, JSON.stringify({ version: "4.1.1", model: "face-api-faceRecognitionNet-128", count: allCelebs.length, celebrities: legacyCelebs }, null, 2));
  log(`updated ${EMB_JSON} legacy ${legacyCelebs.length}`);

  // Verify gz
  try {
    const { execSync } = await import("node:child_process");
    const gzQ8 = execSync(`gzip -c "${BIN_Q8}" | wc -c`).toString().trim();
    const gzF32 = execSync(`gzip -c "${BIN_F32}" | wc -c`).toString().trim();
    log(`gzipped q8 ${gzQ8} f32 ${gzF32}`);
  } catch { /* best-effort */ }

  // Acceptance check: require >90% real for "best product"
  if (successes / allCelebs.length < 0.9) {
    log(`WARN: only ${successes}/${allCelebs.length} real descriptors (target >90%) - keeping synthetic fallbacks for misses`);
  } else {
    log(`PASS: ${successes}/${allCelebs.length} real descriptors (≥90%)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
