#!/usr/bin/env node
/**
 * Migrate Twinframe gallery to efficient binary + WebP format.
 * - Reads public/celebs/embeddings.json (267 FaceNet 128-d)
 * - Expands each celeb into 3 age buckets (young/mid/old) sharing same descriptor
 *   → demonstrates age-bucketed matching without needing new photos
 * - Writes:
 *   public/celebs/embeddings.meta.json
 *   public/celebs/embeddings.q8.bin (Int8 quantized, 128 bytes/bucket)
 *   public/celebs/embeddings.f32.bin (Float32 fallback, 512 bytes/bucket)
 *   public/celebs/index.json (updated to WebP thumb paths + ageBuckets)
 * - Converts public/celebs/*.jpg → public/celebs/thumbs/96/*.webp + 192
 *   using ffmpeg/cwebp (fallback to copy if tools missing)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const CELEBS_DIR = path.join(ROOT, "public/celebs");
const EMB_JSON = path.join(CELEBS_DIR, "embeddings.json");
const INDEX_JSON = path.join(CELEBS_DIR, "index.json");
const META_JSON = path.join(CELEBS_DIR, "embeddings.meta.json");
const BIN_Q8 = path.join(CELEBS_DIR, "embeddings.q8.bin");
const BIN_F32 = path.join(CELEBS_DIR, "embeddings.f32.bin");
const THUMBS_96 = path.join(CELEBS_DIR, "thumbs/96");
const THUMBS_192 = path.join(CELEBS_DIR, "thumbs/192");

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

async function main() {
  const raw = JSON.parse(fs.readFileSync(EMB_JSON, "utf8"));
  const celebs = raw.celebrities;
  console.log(`[migrate] read ${celebs.length} celebs, version ${raw.version}`);

  // Expand to age buckets: 3 per celeb (young, mid, old) sharing descriptor
  // Keeps image count same (one thumb per celeb) but matching has age choice
  const buckets = [];
  const index = [];
  for (const c of celebs) {
    const baseAge = Math.round(c.age);
    const ages = [
      clamp(baseAge - 12, 18, 75),
      clamp(baseAge, 18, 75),
      clamp(baseAge + 14, 18, 75),
    ];
    // dedupe if ages collide (young celebs)
    const uniqAges = [...new Set(ages)];
    for (const age of uniqAges) {
      buckets.push({ id: c.id, name: c.name, descriptor: c.descriptor, age, gender: c.gender, genderProb: c.genderProb, path: c.path });
    }
    // index entry keeps one thumb per celeb id, with ageBuckets list
    const webpPath = c.path.replace(/\.jpg$/i, ".webp").replace("/celebs/", "/celebs/thumbs/96/");
    // fallback to original jpg if thumb missing at runtime via loader
    index.push({
      id: c.id,
      name: c.name,
      path: webpPath, // 96 thumb primary
      path192: webpPath.replace("/thumbs/96/", "/thumbs/192/"),
      fallbackPath: c.path,
      gender: c.gender,
      genderProb: c.genderProb,
      ageBuckets: uniqAges,
      baseAge: baseAge,
    });
  }
  console.log(`[migrate] expanded to ${buckets.length} buckets (${(buckets.length/celebs.length).toFixed(1)} per celeb)`);

  // Compute global scale for Int8 quantization
  let maxAbs = 0;
  for (const b of buckets) for (const v of b.descriptor) maxAbs = Math.max(maxAbs, Math.abs(v));
  const scale = maxAbs / 127 || 0.01;
  console.log(`[migrate] maxAbs ${maxAbs.toFixed(4)} scale ${scale.toFixed(6)}`);

  // Write q8 bin
  const q8 = new Uint8Array(buckets.length * 128);
  const f32 = new Float32Array(buckets.length * 128);
  for (let i = 0; i < buckets.length; i++) {
    const d = buckets[i].descriptor;
    for (let j = 0; j < 128; j++) {
      const v = d[j] ?? 0;
      f32[i*128+j] = v;
      const q = Math.max(-127, Math.min(127, Math.round(v / scale)));
      q8[i*128+j] = q + 127; // store as uint8 biased
    }
  }
  fs.writeFileSync(BIN_Q8, q8);
  fs.writeFileSync(BIN_F32, Buffer.from(f32.buffer));
  console.log(`[migrate] wrote ${BIN_Q8} ${q8.length} bytes`);
  console.log(`[migrate] wrote ${BIN_F32} ${f32.byteLength} bytes`);

  const meta = {
    version: "3.0.0",
    model: raw.model,
    dim: 128,
    countCelebs: celebs.length,
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
  };
  fs.writeFileSync(META_JSON, JSON.stringify(meta, null, 2));
  console.log(`[migrate] wrote ${META_JSON}`);

  // Write expanded index.json and also per-bucket index for loader
  // Keep public/celebs/index.json as thumb manifest (back-compat)
  fs.writeFileSync(INDEX_JSON, JSON.stringify(index, null, 2));
  console.log(`[migrate] wrote ${INDEX_JSON} (${index.length} entries)`);

  // Also write buckets.json for debugging (not shipped, but useful)
  const bucketsMeta = buckets.map((b,i)=>({ i, id:b.id, age:b.age, gender:b.gender }));
  fs.writeFileSync(path.join(CELEBS_DIR, "buckets.json"), JSON.stringify(bucketsMeta, null, 2));

  // Convert JPGs to WebP thumbs via ImageMagick (ffmpeg webp encoder often missing)
  fs.mkdirSync(THUMBS_96, { recursive: true });
  fs.mkdirSync(THUMBS_192, { recursive: true });
  const jpgs = fs.readdirSync(CELEBS_DIR).filter(f=>f.endsWith(".jpg"));
  console.log(`[migrate] converting ${jpgs.length} JPGs to WebP thumbs (96+192) via convert...`);
  let ok96=0, ok192=0, fail=0;
  for (const jpg of jpgs) {
    const base = jpg.replace(/\.jpg$/i, "");
    const src = path.join(CELEBS_DIR, jpg);
    const dst96 = path.join(THUMBS_96, base + ".webp");
    const dst192 = path.join(THUMBS_192, base + ".webp");
    try {
      if (!fs.existsSync(dst96)) {
        execSync(`convert "${src}" -resize 96x96^ -gravity north -extent 96x96 -quality 75 "${dst96}"`, { stdio: "pipe" });
      }
      ok96++;
    } catch (e) {
      try { fs.copyFileSync(src, dst96.replace(".webp",".jpg")); } catch { /* best-effort */ }
      fail++;
    }
    try {
      if (!fs.existsSync(dst192)) {
        execSync(`convert "${src}" -resize 192x192^ -gravity north -extent 192x192 -quality 75 "${dst192}"`, { stdio: "pipe" });
      }
      ok192++;
    } catch (e) {
      fail++;
    }
    if ((ok96+ok192)%100===0) process.stdout.write(`  ${ok96}/${jpgs.length} 96, ${ok192} 192\r`);
  }
  console.log(`\n[migrate] thumbs done: ${ok96} ×96, ${ok192} ×192, fails ${fail}`);
  const s96 = fs.readdirSync(THUMBS_96).reduce((a,f)=>a+fs.statSync(path.join(THUMBS_96,f)).size,0);
  const s192 = fs.readdirSync(THUMBS_192).reduce((a,f)=>a+fs.statSync(path.join(THUMBS_192,f)).size,0);
  const sJpg = jpgs.reduce((a,f)=>a+fs.statSync(path.join(CELEBS_DIR,f)).size,0);
  console.log(`[migrate] sizes: JPG total ${(sJpg/1e6).toFixed(2)} MB → 96 WebP ${(s96/1e6).toFixed(2)} MB, 192 WebP ${(s192/1e6).toFixed(2)} MB`);
  console.log(`[migrate] savings 96: ${((1-s96/sJpg)*100).toFixed(1)}%`);
  const gzQ8 = execSync(`gzip -c "${BIN_Q8}" | wc -c`).toString().trim();
  const gzF32 = execSync(`gzip -c "${BIN_F32}" | wc -c`).toString().trim();
  console.log(`[migrate] bins gzipped: q8 ${gzQ8} bytes, f32 ${gzF32} bytes (vs embeddings.json ${fs.statSync(EMB_JSON).size} bytes)`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
