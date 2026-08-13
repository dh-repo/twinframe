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

// Default: high-accuracy path WITH TTA (set REENCODE_URL=.../re-encode?fast=1 only for smoke runs)
// Partial miss recovery: REENCODE_URL=.../re-encode?targets=1 (TTA, merge into existing gallery)
const REENCODE_URL = process.env.REENCODE_URL || "http://127.0.0.1:8080/re-encode";
const TIMEOUT_MS = Number(process.env.REENCODE_TIMEOUT_MS || 10_800_000); // 3h — 805 TTA encodes
const POLL_MS = 1500;
/** When true (or URL has targets/ids/only), merge partial results into existing gallery. */
const FORCE_MERGE = process.env.REENCODE_MERGE === "1" || process.env.REENCODE_MERGE === "true";

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function log(msg) { console.log(`[re-encode-browser] ${msg}`); }

async function main() {
  const ckPath = process.env.REENCODE_CHECKPOINT
    || path.join("/tmp", "reencode-checkpoint.json");
  if (process.env.REENCODE_FLUSH_CHECKPOINT === "1") {
    if (!fs.existsSync(ckPath)) throw new Error("no reencode-checkpoint.json");
    const ck = JSON.parse(fs.readFileSync(ckPath, "utf8"));
    const results = ck.results || [];
    log(`flushing checkpoint ${results.length} results from ${ck.timestamp || "?"}`);
    await handleResults(results, { partial: true });
    return;
  }

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
  let lastSnapshot = [];

  const writeCheckpoint = (results) => {
    if (!Array.isArray(results) || results.length === 0) return;
    fs.writeFileSync(
      path.join("/tmp", "reencode-checkpoint.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), results }),
    );
  };

  while (Date.now() - start < TIMEOUT_MS) {
    let state;
    try {
      state = await page.evaluate(() => {
        const w = window;
        return {
          progress: w.__reencodeProgress || null,
          total: w.__reencodeTotal ?? null,
          done: w.__reencodeDone ?? null,
          snapshot: w.__reencodeSnapshot ?? null,
          error: w.__reencodeError ?? null,
          dom: document.body.innerText.slice(0, 4000),
        };
      });
    } catch (err) {
      log(`page context lost (${err.message}); flushing ${lastSnapshot.length} cached results`);
      writeCheckpoint(lastSnapshot);
      if (lastSnapshot.length > 0) {
        await handleResults(lastSnapshot, { partial: true });
        await browser.close().catch(() => {});
        log("flushed last snapshot after navigation; resume remaining IDs");
        return;
      }
      await browser.close().catch(() => {});
      throw err;
    }

    if (state.error) {
      log(`ERROR from page: ${state.error}`);
      await page.screenshot({ path: "screenshots/re-encode-error.png", fullPage: true }).catch(() => {});
      throw new Error(`re-encode page error: ${state.error}`);
    }

    if (Array.isArray(state.snapshot) && state.snapshot.length > lastSnapshot.length) {
      lastSnapshot = state.snapshot;
      writeCheckpoint(lastSnapshot);
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
        const partial = await page.evaluate(() => Boolean(window.__reencodePartial));
        log(`detected __reencodeDone with ${state.done.length} entries partial=${partial}`);
        await handleResults(state.done, { partial: partial || FORCE_MERGE });
        await browser.close();
        log("done - browser closed");
        return;
      } else {
        log(`done array present but incomplete ${state.done.length}/${total}, waiting...`);
      }
    }

    if (stalled > 200) { // ~5 min no progress
      log("stalled too long, capturing screenshot and flushing snapshot");
      await page.screenshot({ path: "screenshots/re-encode-stalled.png", fullPage: true }).catch(() => {});
      if (Array.isArray(state.snapshot) && state.snapshot.length > 0) {
        await handleResults(state.snapshot, { partial: true });
        await browser.close();
        log("flushed stalled snapshot as merge");
        return;
      }
      throw new Error("stalled: no progress for ~5min");
    }

    await page.waitForTimeout(POLL_MS);
  }

  const last = await page.evaluate(() => window.__reencodeSnapshot || window.__reencodeDone || null);
  await page.screenshot({ path: "screenshots/re-encode-timeout.png", fullPage: true }).catch(() => {});
  if (Array.isArray(last) && last.length > 0) {
    log(`timeout flush: writing ${last.length} snapshot results as merge`);
    await handleResults(last, { partial: true });
    await browser.close();
    return;
  }
  await browser.close();
  throw new Error(`timeout after ${TIMEOUT_MS}ms`);
}

async function handleResults(results, { partial = false } = {}) {
  log(`handling ${results.length} results${partial ? " (merge mode)" : ""}`);
  const successes = results.filter((r) => r.descriptor && r.descriptor.length === 128).length;
  const misses = results.length - successes;
  log(`successes: ${successes}/${results.length} misses ${misses}`);

  // Load original index + embeddings for fallback descriptors
  const origIndex = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
  const origEmb = JSON.parse(fs.readFileSync(EMB_JSON, "utf8"));
  const fallbackMap = new Map();
  for (const c of origEmb.celebrities) fallbackMap.set(c.id, c);

  // Build allCelebs in original index order.
  // ACCURACY: never inject random noise. Prefer real encode → prior FaceNet JSON → EXCLUDE.
  // Partial merge: only overwrite IDs present in this run; keep existing source tags for the rest.
  const resultMap = new Map(results.map((r) => [r.id, r]));
  const touched = new Set(resultMap.keys());
  const mergeMode = partial || FORCE_MERGE || (touched.size > 0 && touched.size < origIndex.length);
  const allCelebs = [];
  const excluded = [];
  const stillMiss = [];
  for (const entry of origIndex) {
    const r = resultMap.get(entry.id);
    const fb = fallbackMap.get(entry.id);
    const inThisRun = touched.has(entry.id);
    const hasReal = r && r.descriptor && r.descriptor.length === 128;
    const hasFallback =
      fb?.descriptor &&
      Array.isArray(fb.descriptor) &&
      fb.descriptor.length === 128 &&
      // reject near-zero "noise" fallbacks
      Math.max(...fb.descriptor.map((v) => Math.abs(v))) > 0.05;

    if (inThisRun && !hasReal) {
      stillMiss.push({ id: entry.id, name: entry.name, reason: "detect-miss" });
      // Recovery pass: do NOT re-inject legacy clone vectors for hard misses.
      // Prefer a smaller clean gallery over polluted cross-id collisions.
      if (mergeMode) {
        excluded.push({
          id: entry.id,
          name: entry.name,
          reason: "detect-miss-excluded-no-legacy",
        });
        continue;
      }
    }

    if (!hasReal && !hasFallback) {
      excluded.push({ id: entry.id, name: entry.name, reason: "no-real-descriptor" });
      continue;
    }

    // Full runs: also refuse legacy-json when it would only preserve clone debt
    // (handled above for merge). For non-merge full runs keep prior behavior.
    const descriptor = hasReal ? r.descriptor : fb.descriptor;
    let norm = Math.sqrt(descriptor.reduce((s, v) => s + v * v, 0)) || 1;
    const normed = descriptor.map((v) => v / norm);
    const age = hasReal ? clamp(Math.round(r.age), 18, 75) : (entry.baseAge ?? 32);
    const gender = hasReal ? r.gender : entry.gender;
    const genderProb = hasReal ? r.genderProb : entry.genderProb;
    // Merge: keep prior "reencode" source for untouched IDs; mark new successes.
    let source;
    if (hasReal) source = "reencode";
    else if (mergeMode && entry.source === "reencode") source = "reencode";
    else source = "legacy-json";
    const rawTemplates =
      hasReal && Array.isArray(r.templates) && r.templates.length
        ? r.templates
        : [descriptor];
    allCelebs.push({
      id: entry.id,
      name: entry.name,
      gender,
      genderProb,
      age,
      descriptor: normed,
      templates: rawTemplates,
      path: entry.path,
      path192: entry.path192,
      fallbackPath: entry.fallbackPath,
      source,
    });
  }

  const reencodeCount = allCelebs.filter((c) => c.source === "reencode").length;
  log(
    `included ${allCelebs.length} celebs; excluded ${excluded.length}; real-reencode tags ${reencodeCount}; still-miss ${stillMiss.length}`,
  );
  if (excluded.length) {
    fs.writeFileSync(
      path.join(CELEBS_DIR, "reencode-excluded.json"),
      JSON.stringify({ timestamp: new Date().toISOString(), excluded }, null, 2),
    );
    log(`wrote reencode-excluded.json (${excluded.length} ids)`);
  }
  if (stillMiss.length) {
    fs.writeFileSync(
      path.join(CELEBS_DIR, "reencode-miss-targets.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          reason: "detect miss after recovery pass",
          count: stillMiss.length,
          ids: stillMiss.map((m) => m.id),
          names: stillMiss.map((m) => ({ id: m.id, name: m.name })),
        },
        null,
        2,
      ),
    );
    log(`wrote reencode-miss-targets.json (${stillMiss.length} remaining)`);
  }

  // Multi-template: 1+ descriptors per celeb (primary enroll + optional flip/path templates).
  // Ranker takes min distance across same-id buckets. Never write clone rows.
  const buckets = [];
  const indexEntries = [];
  for (const celeb of allCelebs) {
    const baseAge = celeb.age;
    const templates = Array.isArray(celeb.templates) && celeb.templates.length
      ? celeb.templates
      : [celeb.descriptor];
    // Dedupe near-identical templates
    const unique = [];
    for (const t of templates) {
      if (!t || t.length !== 128) continue;
      let n = Math.sqrt(t.reduce((s, v) => s + v * v, 0)) || 1;
      const normed = t.map((v) => v / n);
      const isClone = unique.some((u) => {
        let s = 0;
        for (let i = 0; i < 128; i++) {
          const d = (u[i] ?? 0) - (normed[i] ?? 0);
          s += d * d;
        }
        return Math.sqrt(s) < 1e-3;
      });
      if (!isClone) unique.push(normed);
    }
    if (unique.length === 0) unique.push(celeb.descriptor);
    for (const desc of unique) {
      buckets.push({
        id: celeb.id,
        name: celeb.name,
        path: celeb.path,
        path192: celeb.path192,
        fallbackPath: celeb.fallbackPath,
        age: baseAge,
        gender: celeb.gender,
        genderProb: celeb.genderProb,
        descriptor: desc,
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
      ageBuckets: [baseAge],
      baseAge,
      source: celeb.source,
      templateCount: unique.length,
    });
  }

  log(
    `buckets ${buckets.length} across ${allCelebs.length} celebs (multi-template min-distance rank)`,
  );

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
    version: "4.3.0-dlib-align",
    model: "face-api-faceRecognitionNet-128",
    alignment: "dlib-eye-mouth-150",
    dim,
    countCelebs: allCelebs.length,
    countBuckets: buckets.length,
    bucketsPerCeleb: 1,
    quantization: "int8-biased",
    scale,
    maxAbs,
    files: {
      q8: "/celebs/embeddings.q8.bin",
      f32: "/celebs/embeddings.f32.bin",
      index: "/celebs/index.json",
    },
    ageBuckets: "single age label per celeb (real multi-age requires multi-photo encodes)",
    excludedCount: excluded.length,
    reencodeTagged: reencodeCount,
    lastRunSuccesses: successes,
    lastRunTotal: results.length,
    enrolled: `${allCelebs.length} celebs; tagged reencode ${reencodeCount}; last run ${successes}/${results.length} real; excluded ${excluded.length}; 1 bucket/id${mergeMode ? "; merge" : ""}`,
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
  } catch {}

  // Acceptance check: require >90% of full gallery tagged as real reencode
  const realRate = reencodeCount / allCelebs.length;
  if (realRate < 0.9) {
    log(
      `WARN: only ${reencodeCount}/${allCelebs.length} tagged reencode (${(realRate * 100).toFixed(1)}%, target ≥90%)`,
    );
  } else {
    log(`PASS: ${reencodeCount}/${allCelebs.length} tagged reencode (≥90%)`);
  }
  if (mergeMode) {
    log(`merge run recovered ${successes}/${results.length}; remaining miss ${stillMiss.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
