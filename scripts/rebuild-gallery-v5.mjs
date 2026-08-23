#!/usr/bin/env node --experimental-strip-types
/**
 * scripts/rebuild-gallery-v5.mjs
 *
 * Honest gallery rebuild. One consistent engine (face-api FaceNet-128, CPU) embeds
 * every real photo we have, identity-clusters shots per celebrity, builds L2-normalized
 * centroids, and emits gallery.v5.json + a purged index.json + regenerated thumbnails.
 *
 * Commands:
 *   embed      Embed all photos in the real pools (portraits, extra-photos, held-out),
 *              TTA original+flip, resumable sha256 cache -> reports/v5-embed-cache.json
 *   fetch      Download extra Wikipedia photos (second/third shots) for enrolled celebs
 *              and grow the gallery with famous celebs missing real portraits
 *   assemble   Identity-cluster shots, build centroids, write gallery.v5.json + index.json
 *   eval       Honest Rank-1: held-out shots (not in centroid) vs the v5 gallery
 *   thumbnails Regenerate 96/192 webp thumbs from top-level portraits for v5 celebs
 *
 * All phases are idempotent/resumable. No fabricated data: anything that fails face
 * detection or identity clustering is excluded and reported.
 */
import nodeUtil from "node:util";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

Object.defineProperty(Object.prototype, "TextEncoder", { value: globalThis.TextEncoder, configurable: true, writable: true, enumerable: false });
Object.defineProperty(Object.prototype, "TextDecoder", { value: globalThis.TextDecoder, configurable: true, writable: true, enumerable: false });
Object.defineProperty(Object.prototype, "types", { value: nodeUtil.types, configurable: true, writable: true, enumerable: false });

const canvas = (await import("canvas")).default;
const sharp = (await import("sharp")).default;
const faceapi = await import("@vladmandic/face-api/dist/face-api.esm.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const REPORTS = path.join(ROOT, "reports");
const CACHE_PATH = path.join(REPORTS, "v5-embed-cache.json");
const MANIFEST_PATH = path.join(REPORTS, "v5-fetch-manifest.json");
const GALLERY_V5 = path.join(CELEBS, "gallery.v5.json");
const INDEX_JSON = path.join(CELEBS, "index.json");
const MODEL_DIR = path.join(ROOT, "public/models/face-api");
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData, readFile: (p) => fs.promises.readFile(p) });

const UA = "TwinframeGalleryRebuild/1.0 (local accuracy rebuild; contact: damian) Node.js";
const SKIP_FILE = /logo|icon|flag|coat|signature|wordmark|poster|soundtrack|\.svg|symbol|map.of|diagram|emblem|seal.of/i;

// Identity clustering thresholds (cosine distance on L2-normalized FaceNet-128)
const ANCHOR_INCLUDE = 0.5;   // shot vs portrait anchor
const CENTROID_INCLUDE = 0.55; // shot vs refined centroid
const MUTUAL_AGREE = 0.4;     // extras agreeing with each other to override a suspect portrait

// ============================================================
// Shared utilities
// ============================================================
function l2Normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}
function cosineDistance(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(2, 1 - Math.max(-1, Math.min(1, dot))));
}
function averageVectors(vecs) {
  const dim = vecs[0].length;
  const acc = new Float32Array(dim);
  for (const v of vecs) for (let i = 0; i < dim; i++) acc[i] += v[i];
  for (let i = 0; i < dim; i++) acc[i] /= vecs.length;
  return l2Normalize(acc);
}
function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
      done++;
      if (done % 10 === 0 || done === items.length) {
        process.stdout.write(`    ${done}/${items.length}\r`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  console.log("");
  return results;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")); } catch { return {}; }
}
function saveCache(cache) {
  fs.mkdirSync(REPORTS, { recursive: true });
  const tmp = CACHE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, CACHE_PATH);
}

// Face portrait pool discovery: which images belong to which celeb
function discoverShots() {
  const shots = new Map(); // id -> [{role, path}]
  const add = (id, role, p) => {
    if (!shots.has(id)) shots.set(id, []);
    shots.get(id).push({ role, path: p });
  };
  for (const f of fs.readdirSync(CELEBS)) {
    if (f.endsWith(".jpg") && f !== "sample_user.jpg") {
      add(f.replace(/\.jpg$/, ""), "portrait", path.join(CELEBS, f));
    }
  }
  for (const dirName of ["extra-photos", "held-out"]) {
    const base = path.join(CELEBS, dirName);
    if (!fs.existsSync(base)) continue;
    for (const id of fs.readdirSync(base)) {
      const dir = path.join(base, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir).sort()) {
        if (IMAGE_RE.test(f)) add(id, dirName === "held-out" ? "heldout" : "extra", path.join(dir, f));
      }
    }
  }
  return shots;
}

// ============================================================
// embed phase
// ============================================================
async function initFaceApi() {
  const tf = faceapi.tf;
  await tf.setBackend("cpu");
  await tf.ready();
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
  await faceapi.nets.ageGenderNet.loadFromDisk(MODEL_DIR);
}

async function embedOne(absPath) {
  const buf = fs.readFileSync(absPath);
  // Downscale huge images for speed; FaceNet crops faces internally
  const meta = await sharp(buf).metadata();
  let workBuf = buf;
  if (meta.width && meta.height && Math.max(meta.width, meta.height) > 1200) {
    workBuf = await sharp(buf).resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  }
  const img = await canvas.loadImage(workBuf);
  const c = canvas.createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const detOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
  const res = await faceapi.detectSingleFace(c, detOpts).withFaceLandmarks().withFaceDescriptor().withAgeAndGender();
  if (!res || !res.descriptor) return null;

  // Flip TTA
  const cf = canvas.createCanvas(img.width, img.height);
  const ctxf = cf.getContext("2d");
  ctxf.translate(img.width, 0);
  ctxf.scale(-1, 1);
  ctxf.drawImage(img, 0, 0);
  let flipDescriptor = null;
  try {
    const resF = await faceapi.detectSingleFace(cf, detOpts).withFaceLandmarks().withFaceDescriptor();
    if (resF?.descriptor) flipDescriptor = Array.from(resF.descriptor);
  } catch { /* flip optional */ }

  return {
    descriptor: Array.from(res.descriptor),
    descriptorFlip: flipDescriptor,
    age: res.age,
    gender: res.gender,
    genderProb: res.genderProbability,
    score: res.detection.score,
    faceBox: {
      w: res.detection.box.width / img.width,
      h: res.detection.box.height / img.height,
    },
    width: img.width,
    height: img.height,
  };
}

async function cmdEmbed(options) {
  console.log("[v5] embed: initializing face-api (CPU)...");
  await initFaceApi();
  const cache = loadCache();
  const shots = discoverShots();
  const tasks = [];
  for (const [id, list] of shots) {
    for (const s of list) {
      const sha = sha256File(s.path);
      if (!cache[sha]) tasks.push({ id, sha, path: s.path, role: s.role });
    }
  }
  console.log(`[v5] embed: ${Object.keys(cache).length} cached, ${tasks.length} to embed`);
  if (options.limit) tasks.splice(options.limit);

  let saveCounter = 0;
  await mapConcurrent(tasks, options.concurrency, async (t) => {
    try {
      const r = await embedOne(t.path);
      cache[t.sha] = r
        ? { id: t.id, role: t.role, source: path.relative(ROOT, t.path), ...r }
        : { id: t.id, role: t.role, source: path.relative(ROOT, t.path), noFace: true };
    } catch (err) {
      cache[t.sha] = { id: t.id, role: t.role, source: path.relative(ROOT, t.path), error: String(err.message || err) };
    }
    if (++saveCounter % 25 === 0) saveCache(cache);
  });
  saveCache(cache);
  const ok = Object.values(cache).filter((c) => c.descriptor).length;
  console.log(`[v5] embed: done. cache=${Object.keys(cache).length} entries (${ok} with descriptors)`);
}

// ============================================================
// fetch phase (Wikipedia)
// ============================================================
async function wiki(params) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error(`wiki ${res.status} ${url.searchParams.get("action")}`);
  return res.json();
}
async function resolveTitle(name) {
  const j = await wiki({ action: "query", list: "search", srsearch: name, srlimit: "3", srnamespace: "0" });
  return j.query?.search?.[0]?.title ?? null;
}
async function imageUrl(fileTitle, width = 640) {
  const j = await wiki({ action: "query", titles: fileTitle, prop: "imageinfo", iiprop: "url|mime", iiurlwidth: String(width) });
  const page = Object.values(j.query?.pages || {})[0];
  const ii = page?.imageinfo?.[0];
  if (!ii || !/^image\//.test(ii.mime || "")) return null;
  return ii.thumburl || ii.url;
}
async function downloadTo(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 8000) return false; // too small to be a portrait
  // Validate + normalize to JPEG via sharp
  try {
    await sharp(buf).rotate().jpeg({ quality: 90 }).toFile(dest);
  } catch {
    return false;
  }
  return true;
}

async function candidateFileTitles(title, celebName) {
  const out = [];
  // 1. Lead page image
  try {
    const j = await wiki({ action: "query", titles: title, prop: "pageimages", piprop: "name", pilicense: "any" });
    const page = Object.values(j.query?.pages || {})[0];
    if (page?.pageimage) out.push(page.pageimage);
  } catch { /* continue */ }
  // 2. Page image list (filtered)
  try {
    const j = await wiki({ action: "query", titles: title, prop: "images", imlimit: "50" });
    const page = Object.values(j.query?.pages || {})[0];
    const nameTokens = celebName.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    for (const im of page?.images || []) {
      const t = im.title || "";
      if (!/\.(jpe?g|png)$/i.test(t)) continue;
      if (SKIP_FILE.test(t)) continue;
      const lower = t.toLowerCase();
      if (nameTokens.some((tok) => lower.includes(tok))) out.push(t);
      if (out.length >= 8) break;
    }
  } catch { /* continue */ }
  return [...new Set(out)];
}

function growthList() {
  const realIds = new Set(
    fs.readdirSync(CELEBS).filter((f) => f.endsWith(".jpg") && f !== "sample_user.jpg").map((f) => f.replace(/\.jpg$/, "")),
  );
  const names = [
    "Margot Robbie", "Timothee Chalamet", "Cillian Murphy", "Anya Taylor-Joy", "Florence Pugh",
    "Austin Butler", "Barry Keoghan", "Bella Ramsey", "Brendan Fraser", "Colman Domingo",
    "Greta Gerwig", "Jodie Comer", "Pedro Pascal", "Jenna Ortega", "Ayo Edebiri",
    "Jeremy Allen White", "Jacob Elordi", "Cailee Spaeny", "Paul Mescal", "Daisy Edgar-Jones",
    "Glen Powell", "Sydney Sweeney", "Mikey Madison", "Demi Moore", "Zoe Saldana",
    "Kieran Culkin", "Jeremy Strong", "Sarah Snook", "Aubrey Plaza", "Rami Malek",
    "Diego Luna", "Oscar Isaac", "Dev Patel", "Lupita Nyongo", "Viola Davis",
    "Danielle Deadwyxler", "Fantasia Barrino", "Colman Domingo", "Andrew Scott", "Paul Giamatti",
    "Da'Vine Joy Randolph", "Dominic Sessa", "Emma Stone", "Ryan Gosling", "Emily Blunt",
    "Cate Blanchett", "Tilda Swinton", "Willem Dafoe", "Mads Mikkelsen", "Anya Chalotra",
    "Henry Cavill", "Anya Taylor", "Idris Elba", "John Boyega", "Letitia Wright",
    "Daniel Kaluuya", "Lakeith Stanfield", "Brian Tyree Henry", "Jharrel Jerome", "Stephan James",
    "Regina King", "Mahershala Ali", "Octavia Spencer", "Sterling K Brown", "Don Cheadle",
    "Adam Driver", "Greta Lee", "Teo Yoo", "Song Kang-ho", "Bae Doona",
    "Lee Jung-jae", "Jung Ho-yeon", "Park Seo-joon", "Jun Ji-hyun", "Gong Yoo",
    "Hyun Bin", "Son Ye-jin", "IU", "Lisa Manobal", "Jennie Kim",
    "Rosé Park", "Cha Eun-woo", "Kim Soo-hyun", "Song Hye-kyo", "Lee Min-ho",
    "Wang Yibo", "Xiao Zhan", "Liu Yifei", "Michelle Yeoh", "Awkwafina",
    "Sandra Oh", "Steven Yeun", "Ali Wong", "Simu Liu", "Lana Condor",
    "Maitreyi Ramakrishnan", "Alia Bhatt", "Deepika Padukone", "Priyanka Chopra", "Aishwarya Rai",
    "Ranbir Kapoor", "Hrithik Roshan", "Nawazuddin Siddiqui", "Radhika Apte", "Vicky Kaushal",
    "Anushka Sharma", "Kareena Kapoor", "Shah Rukh Khan", "Samantha Ruth Prabhu", "Vijay Sethupathi",
    "Bad Bunny", "Karol G", "Anitta", "Rosalía", "Maluma",
    "Billie Eilish", "Olivia Rodrigo", "Doja Cat", "SZA", "Dua Lipa",
    "Harry Styles", "Niall Horan", "Zayn Malik", "Selena Gomez", "Ariana Grande",
    "Nicolas Cage", "Willem Dafoe", "Natalie Portman", "Uma Thurman", "Halle Bailey",
    "Simone Ashley", "Jonathan Bailey", "Nicola Coughlan", "Luke Newton", "Claudia Jessie",
    "Lily Collins", "Camila Cabello", "Shawn Mendes", "The Weeknd", "Post Malone",
    "Travis Scott", "Kendrick Lamar", "Frank Ocean", "Tyler the Creator", "A$AP Rocky",
  ];
  const seen = new Set();
  return names
    .map((n) => ({ name: n.replace(/[’']/g, ""), id: slug(n) }))
    .filter((e) => {
      if (realIds.has(e.id) || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
}

async function cmdFetch(options) {
  fs.mkdirSync(path.join(CELEBS, "held-out"), { recursive: true });
  const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) : { fetched: {} };
  const existingIds = new Set(
    fs.readdirSync(CELEBS).filter((f) => f.endsWith(".jpg")).map((f) => f.replace(/\.jpg$/, "")),
  );

  // Part A: extra shots for celebs that already have a portrait
  const needExtras = [...existingIds].filter((id) => {
    const dir = path.join(CELEBS, "held-out", id);
    const n = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => IMAGE_RE.test(f)).length : 0;
    return n < 2 && !manifest.fetched[id]?.extrasDone;
  });
  const extrasQueue = needExtras.slice(0, options.extrasLimit ?? needExtras.length);
  console.log(`[v5] fetch: ${extrasQueue.length} enrolled celebs need extra shots`);
  const index = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
  const nameById = new Map(index.map((e) => [e.id, e.name]));

  for (const id of extrasQueue) {
    const name = nameById.get(id) || id.replace(/-/g, " ");
    try {
      const title = await resolveTitle(name);
      if (!title) { manifest.fetched[id] = { ...(manifest.fetched[id] || {}), extrasDone: true, note: "no wiki title" }; continue; }
      const files = await candidateFileTitles(title, name);
      const dir = path.join(CELEBS, "held-out", id);
      fs.mkdirSync(dir, { recursive: true });
      let have = fs.readdirSync(dir).filter((f) => IMAGE_RE.test(f)).length;
      for (const ft of files) {
        if (have >= 2) break;
        const url = await imageUrl(ft, 640);
        if (!url) continue;
        const dest = path.join(dir, `${String(have + 1).padStart(3, "0")}.jpg`);
        if (await downloadTo(url, dest)) {
          have++;
          manifest.fetched[id] = { ...(manifest.fetched[id] || {}), title, lastExtra: ft };
        }
        await sleep(120);
      }
      manifest.fetched[id] = { ...(manifest.fetched[id] || {}), extrasDone: true, extras: have };
      process.stdout.write(`  extras ${id}: ${have}\r`);
    } catch (err) {
      console.error(`  extras ${id} failed: ${err.message}`);
    }
    saveManifest(manifest);
    await sleep(180);
  }

  // Part B: grow the gallery with famous celebs missing portraits
  const grow = growthList().slice(0, options.growLimit ?? 160);
  console.log(`[v5] fetch: growth candidates: ${grow.length}`);
  let grown = 0;
  for (const entry of grow) {
    if (manifest.fetched[entry.id]?.grown || existingIds.has(entry.id)) continue;
    try {
      const title = await resolveTitle(entry.name);
      if (!title) { manifest.fetched[entry.id] = { note: "no wiki title" }; saveManifest(manifest); continue; }
      const files = await candidateFileTitles(title, entry.name);
      if (!files.length) { manifest.fetched[entry.id] = { title, note: "no images" }; saveManifest(manifest); continue; }
      let got = 0;
      for (const ft of files) {
        const url = await imageUrl(ft, 800);
        if (!url) continue;
        if (got === 0) {
          const dest = path.join(CELEBS, `${entry.id}.jpg`);
          if (await downloadTo(url, dest)) { got++; continue; }
        } else {
          const dir = path.join(CELEBS, "held-out", entry.id);
          fs.mkdirSync(dir, { recursive: true });
          const have = fs.readdirSync(dir).filter((f) => IMAGE_RE.test(f)).length;
          if (have >= 2) break;
          const dest = path.join(dir, `${String(have + 1).padStart(3, "0")}.jpg`);
          if (await downloadTo(url, dest)) got++;
        }
        await sleep(120);
        if (got >= 3) break;
      }
      if (got >= 1) {
        manifest.fetched[entry.id] = { title, grown: true, name: entry.name, shots: got };
        grown++;
        console.log(`  grew ${entry.id} (${got} shots)`);
      } else {
        manifest.fetched[entry.id] = { title, note: "downloads failed" };
      }
    } catch (err) {
      manifest.fetched[entry.id] = { note: `error: ${err.message}` };
    }
    saveManifest(manifest);
    await sleep(200);
  }
  console.log(`[v5] fetch: done. grew ${grown} new celebs.`);
}
function saveManifest(m) {
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 1));
}

// ============================================================
// assemble phase
// ============================================================
function shotVector(entry) {
  if (!entry?.descriptor) return null;
  const vecs = [Float32Array.from(entry.descriptor)];
  if (entry.descriptorFlip) vecs.push(Float32Array.from(entry.descriptorFlip));
  return averageVectors(vecs);
}

function cmdAssemble() {
  const cache = loadCache();
  const bySha = new Map(Object.entries(cache));
  const shots = discoverShots();

  // index shots' embeddings by celeb
  const celebShots = new Map(); // id -> [{role, path, vec, entry}]
  for (const [id, list] of shots) {
    const rows = [];
    for (const s of list) {
      const sha = sha256File(s.path);
      const entry = bySha.get(sha);
      const vec = shotVector(entry);
      rows.push({ role: s.role, path: s.path, vec, entry });
    }
    celebShots.set(id, rows);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
  const metaById = new Map(index.map((e) => [e.id, e]));

  const celebrities = [];
  const rejects = [];
  const suspects = [];

  for (const [id, rows] of [...celebShots.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const portrait = rows.find((r) => r.role === "portrait");
    const extras = rows.filter((r) => r.role !== "portrait" && r.vec);
    const noFaceRows = rows.filter((r) => !r.vec);
    for (const r of noFaceRows) rejects.push({ id, path: path.relative(ROOT, r.path), reason: "no-face" });

    let centroidVecs = [];
    let portraitSuspect = false;

    if (portrait?.vec) {
      const anchor = portrait.vec;
      const included = extras.filter((e) => cosineDistance(e.vec, anchor) <= ANCHOR_INCLUDE);
      centroidVecs = [anchor, ...included.map((e) => e.vec)];
      // refine: second pass around centroid
      let centroid = averageVectors(centroidVecs);
      const included2 = extras.filter((e) => cosineDistance(e.vec, centroid) <= CENTROID_INCLUDE);
      centroidVecs = [anchor, ...included2.map((e) => e.vec)];
      for (const e of extras) {
        if (!centroidVecs.includes(e.vec)) {
          rejects.push({ id, path: path.relative(ROOT, e.path), reason: "identity-mismatch", d: Number(cosineDistance(e.vec, centroid).toFixed(3)) });
        }
      }
      // suspect-portrait check: >=2 extras agree with each other but disagree with portrait
      if (included.length === 0 && extras.length >= 2) {
        const pairD = cosineDistance(extras[0].vec, extras[1].vec);
        if (pairD <= MUTUAL_AGREE && cosineDistance(extras[0].vec, anchor) > 0.6) {
          centroidVecs = extras.map((e) => e.vec);
          portraitSuspect = true;
          suspects.push({ id, pairD });
        }
      }
    } else if (extras.length >= 2) {
      // no usable portrait: build from mutually consistent extras
      const base = extras[0].vec;
      const agreed = extras.filter((e) => cosineDistance(e.vec, base) <= CENTROID_INCLUDE);
      if (agreed.length >= 2) {
        centroidVecs = agreed.map((e) => e.vec);
        portraitSuspect = true;
        suspects.push({ id, note: "portrait missing/no-face; centroid from extras" });
      }
    }

    if (centroidVecs.length === 0) continue; // nothing real -> not enrolled

    const descriptor = averageVectors(centroidVecs);
    const allEntries = rows.filter((r) => r.entry?.descriptor).map((r) => r.entry);
    const ages = allEntries.map((e) => e.age).filter((a) => Number.isFinite(a));
    ages.sort((a, b) => a - b);
    const age = ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : (metaById.get(id)?.baseAge ?? 40);
    const maleVotes = allEntries.filter((e) => e.gender === "male").reduce((s, e) => s + (e.genderProb || 0.5), 0);
    const femaleVotes = allEntries.filter((e) => e.gender === "female").reduce((s, e) => s + (e.genderProb || 0.5), 0);
    const gender = maleVotes === femaleVotes
      ? (metaById.get(id)?.gender ?? "female")
      : maleVotes > femaleVotes ? "male" : "female";
    const totalVotes = maleVotes + femaleVotes || 1;
    const genderProb = Math.min(0.99, Math.max(maleVotes, femaleVotes) / totalVotes);

    const meta = metaById.get(id);
    const manifestRow = JSON.parse(fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, "utf8") : '{"fetched":{}}').fetched[id];
    celebrities.push({
      id,
      name: meta?.name || manifestRow?.name || id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      age,
      gender,
      genderProb: Number(genderProb.toFixed(3)),
      path: `/celebs/thumbs/96/${id}.webp`,
      path192: `/celebs/thumbs/192/${id}.webp`,
      fallbackPath: fs.existsSync(path.join(CELEBS, `${id}.jpg`)) ? `/celebs/${id}.jpg` : undefined,
      shots: centroidVecs.length,
      portraitSuspect,
      descriptor: Array.from(descriptor, (v) => Number(v.toFixed(5))),
    });
  }

  fs.writeFileSync(GALLERY_V5, JSON.stringify({
    version: "5.0.0",
    model: "facenet-128 (vladmandic/face-api), TTA original+flip, identity-clustered centroids",
    dim: 128,
    count: celebrities.length,
    celebrities,
  }));

  // Purged index.json (real celebs only)
  const newIndex = celebrities.map((c) => ({
    id: c.id,
    name: c.name,
    path: c.path,
    path192: c.path192,
    fallbackPath: c.fallbackPath,
    gender: c.gender,
    genderProb: c.genderProb,
    baseAge: c.age,
    ageBuckets: [c.age],
  }));
  fs.writeFileSync(INDEX_JSON, JSON.stringify(newIndex, null, 1));

  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, "v5-build-report.json"), JSON.stringify({
    at: new Date().toISOString(),
    enrolled: celebrities.length,
    multiShot: celebrities.filter((c) => c.shots > 1).length,
    portraitSuspects: suspects,
    rejects: rejects.slice(0, 400),
    rejectCount: rejects.length,
  }, null, 1));

  console.log(`[v5] assemble: enrolled ${celebrities.length} celebs (${celebrities.filter((c) => c.shots > 1).length} multi-shot)`);
  console.log(`[v5] assemble: rejected ${rejects.length} shots (identity mismatch / no face)`);
  console.log(`[v5] assemble: portrait suspects: ${suspects.map((s) => s.id).join(", ") || "none"}`);
}

// ============================================================
// thumbnails phase
// ============================================================
async function cmdThumbnails() {
  const gallery = JSON.parse(fs.readFileSync(GALLERY_V5, "utf8"));
  const d96 = path.join(CELEBS, "thumbs/96");
  const d192 = path.join(CELEBS, "thumbs/192");
  fs.mkdirSync(d96, { recursive: true });
  fs.mkdirSync(d192, { recursive: true });
  let done = 0;
  for (const c of gallery.celebrities) {
    const src = c.fallbackPath ? path.join(ROOT, "public", c.fallbackPath.replace(/^\//, "")) : null;
    if (!src || !fs.existsSync(src)) continue;
    try {
      await sharp(src).resize(96, 96, { fit: "cover" }).webp({ quality: 82 }).toFile(path.join(d96, `${c.id}.webp`));
      await sharp(src).resize(192, 192, { fit: "cover" }).webp({ quality: 85 }).toFile(path.join(d192, `${c.id}.webp`));
      done++;
    } catch { /* keep existing thumb */ }
  }
  console.log(`[v5] thumbnails: regenerated ${done} sets`);
}

// ============================================================
// eval phase (honest Rank-1 on v5)
// ============================================================
function productionScore(query, celebMeta, galleryRows) {
  // Mirrors src/lib/face/match.ts rankByDescriptor (cosine + soft priors)
  const scored = galleryRows.map((g) => {
    const dist = cosineDistance(query.vec, g.vec);
    let gAff = 1;
    if (query.gender && query.gender !== "unknown" && g.gender && query.gender !== g.gender) {
      const p = Math.max(0, Math.min(1, query.genderProb ?? 0.9));
      gAff = Math.max(0.75, Math.min(1, 1 - 0.22 * p));
    }
    const aAff = Number.isFinite(query.age) && Number.isFinite(g.age)
      ? Math.exp(-Math.pow(Math.abs(query.age - g.age) / 28, 2))
      : 1;
    const adjusted = dist / (0.72 + 0.18 * gAff + 0.10 * aAff);
    return { id: g.id, dist, adjusted };
  });
  scored.sort((a, b) => a.adjusted - b.adjusted);
  return scored;
}

function cmdEval() {
  const gallery = JSON.parse(fs.readFileSync(GALLERY_V5, "utf8"));
  const galleryRows = gallery.celebrities.map((c) => ({ id: c.id, age: c.age, gender: c.gender, vec: l2Normalize(c.descriptor) }));
  const cache = loadCache();
  const shots = discoverShots();

  // held-out probes: non-portrait shots NOT used in the centroid.
  // Approximation of assemble clustering: shot included if within CENTROID_INCLUDE of centroid.
  const records = [];
  for (const [id, rows] of shots) {
    const celeb = gallery.celebrities.find((c) => c.id === id);
    if (!celeb) continue;
    const centroid = l2Normalize(celeb.descriptor);
    const probes = rows.filter((r) => {
      if (r.role === "portrait") return false;
      const sha = sha256File(r.path);
      const entry = cache[sha];
      const vec = shotVector(entry);
      return vec && cosineDistance(vec, centroid) > CENTROID_INCLUDE + 0.05; // excluded from centroid
    });
    for (const p of probes) {
      const entry = cache[sha256File(p.path)];
      const vec = shotVector(entry);
      if (!vec) continue;
      const scored = productionScore(
        { vec, age: entry.age, gender: entry.gender, genderProb: entry.genderProb },
        null,
        galleryRows,
      );
      const rank = scored.findIndex((s) => s.id === id) + 1;
      const self = scored.find((s) => s.id === id);
      records.push({ id, rank: rank || Infinity, top1: scored[0]?.id, dTrue: self?.dist ?? Infinity, dTop1: scored[0]?.dist ?? Infinity, source: path.relative(ROOT, p.path) });
    }
  }

  const n = records.length;
  const r1 = records.filter((r) => r.rank === 1).length;
  const r5 = records.filter((r) => r.rank >= 1 && r.rank <= 5).length;
  const mrr = records.reduce((a, r) => a + (Number.isFinite(r.rank) ? 1 / r.rank : 0), 0) / Math.max(1, n);
  console.log("=".repeat(72));
  console.log("  TWINFRAME v5 HELD-OUT RANK-1 (same-engine probes, excluded from centroids)");
  console.log("=".repeat(72));
  console.log(`  probes: ${n}   Rank-1: ${((r1 / Math.max(1, n)) * 100).toFixed(1)}%   Rank-5: ${((r5 / Math.max(1, n)) * 100).toFixed(1)}%   MRR: ${mrr.toFixed(3)}`);
  const misses = records.filter((r) => r.rank !== 1).sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9)).slice(0, 30);
  for (const m of misses) {
    console.log(`    ${m.id.padEnd(26)} rank=${Number.isFinite(m.rank) ? String(m.rank).padStart(3) : "  —"} got=${(m.top1 || "").padEnd(24)} dTrue=${m.dTrue.toFixed(3)} dTop1=${m.dTop1.toFixed(3)}  ${m.source}`);
  }
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, "v5-held-out-eval.json"), JSON.stringify({ at: new Date().toISOString(), probes: n, rank1Pct: (r1 / Math.max(1, n)) * 100, rank5Pct: (r5 / Math.max(1, n)) * 100, mrr, records }, null, 1));
}

// ============================================================
// CLI
// ============================================================
const [cmd, ...rest] = process.argv.slice(2);
const options = { concurrency: 6, limit: 0 };
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--concurrency") options.concurrency = Number(rest[++i]);
  else if (rest[i] === "--limit") options.limit = Number(rest[++i]);
  else if (rest[i] === "--grow-limit") options.growLimit = Number(rest[++i]);
  else if (rest[i] === "--extras-limit") options.extrasLimit = Number(rest[++i]);
}

if (cmd === "embed") await cmdEmbed(options);
else if (cmd === "fetch") await cmdFetch(options);
else if (cmd === "assemble") cmdAssemble();
else if (cmd === "thumbnails") await cmdThumbnails();
else if (cmd === "eval") cmdEval();
else if (cmd === "all") {
  await cmdEmbed(options);
  cmdAssemble();
  await cmdThumbnails();
  cmdEval();
} else {
  console.log("usage: rebuild-gallery-v5.mjs <embed|fetch|assemble|thumbnails|eval|all> [--concurrency N] [--limit N] [--grow-limit N] [--extras-limit N]");
}
