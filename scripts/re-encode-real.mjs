#!/usr/bin/env node
// Re-encode gallery with real FaceNet descriptors from actual 96 WebP thumbs
// Uses @vladmandic/face-api + @tensorflow/tfjs-node + canvas in Node
// - Loads models from public/models/face-api
// - For each celeb id in index.json, loads thumbs/96/*.webp via canvas
// - Detects face + descriptor (with landmarks), L2-normalizes
// - If detection fails, keeps old synthetic descriptor (fallback)
// - Rewrites gallery.buckets.json descriptors via bins (q8/f32) + meta v4.1
import fs from "node:fs";
import path from "node:path";
import * as canvas from "canvas";
import * as tf from "@tensorflow/tfjs";
import sharp from "sharp";

// Patch face-api to use node-canvas (ESM build uses tfjs, not tfjs-node, so works on Node 26)
import * as faceapi from "@vladmandic/face-api/dist/face-api.esm.js";

const ROOT = "/Users/damian/GitHub/twinframe";
const INDEX = path.join(ROOT, "public/celebs/index.json");
const GALLERY = path.join(ROOT, "public/celebs/gallery.buckets.json");
const META = path.join(ROOT, "public/celebs/embeddings.meta.json");
const BIN_Q8 = path.join(ROOT, "public/celebs/embeddings.q8.bin");
const BIN_F32 = path.join(ROOT, "public/celebs/embeddings.f32.bin");
const EMB_JSON = path.join(ROOT, "public/celebs/embeddings.json");
const THUMBS96 = path.join(ROOT, "public/celebs/thumbs/96");
const THUMBS192 = path.join(ROOT, "public/celebs/thumbs/192");
const ORIG_JPG_DIR = path.join(ROOT, "public/celebs");
const MODEL_URL = path.join(ROOT, "public/models/face-api");

// Fix face-api environment
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

function l2Normalize(arr){
  let s=0; for(let i=0;i<arr.length;i++) s+=arr[i]*arr[i];
  const n=Math.sqrt(s)||1;
  return arr.map(v=>v/n);
}

async function loadModels(){
  console.log("Loading face-api models from", MODEL_URL);
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_URL);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_URL);
  console.log("Models loaded");
}

async function loadImageForFaceApi(imagePath){
  // Use sharp to decode WebP/JPG to PNG buffer, then canvas.loadImage (supports PNG)
  try{
    const buf = await sharp(imagePath).png().toBuffer();
    const img = await canvas.loadImage(buf);
    return img;
  }catch{
    try{
      const img2 = await canvas.loadImage(imagePath);
      return img2;
    }catch{ return null; }
  }
}

async function getDescriptor(imagePath){
  try{
    const img = await loadImageForFaceApi(imagePath);
    if(!img) return null;
    const c = canvas.createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 });
    const det = await faceapi.detectSingleFace(c, opts).withFaceLandmarks().withFaceDescriptor();
    if(det && det.descriptor){
      return l2Normalize(Array.from(det.descriptor));
    }
    const optsLow = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.12 });
    const det2 = await faceapi.detectSingleFace(c, optsLow).withFaceLandmarks().withFaceDescriptor();
    if(det2 && det2.descriptor) return l2Normalize(Array.from(det2.descriptor));
    return null;
  }catch(e){
    return null;
  }
}

function pickBestImagePath(id){
  // Prefer original JPG (higher res) for the 267, then 192 WebP, then 96
  const jpg = path.join(ORIG_JPG_DIR, `${id}.jpg`);
  if(fs.existsSync(jpg)) return jpg;
  const p192 = path.join(THUMBS192, `${id}.webp`);
  if(fs.existsSync(p192)) return p192;
  const p96 = path.join(THUMBS96, `${id}.webp`);
  if(fs.existsSync(p96)) return p96;
  return null;
}

async function main(){
  await loadModels();
  const index = JSON.parse(fs.readFileSync(INDEX,"utf8"));
  const galleryBuckets = JSON.parse(fs.readFileSync(GALLERY,"utf8"));
  const meta = JSON.parse(fs.readFileSync(META,"utf8"));
  console.log(`Gallery: ${index.length} celebs, ${galleryBuckets.length} buckets`);

  // Map celeb id -> best image path (JPG > 192 > 96)
  const thumbForId = new Map(index.map(e=>[e.id, pickBestImagePath(e.id)]));

  // For each celeb, try to get real descriptor from its 96 thumb
  const realDescMap = new Map(); // id -> descriptor
  let success=0, fail=0;
  let i=0;
  for(const entry of index){
    i++;
    const thumbPath = thumbForId.get(entry.id);
    if(!fs.existsSync(thumbPath)){
      fail++;
      continue;
    }
    const desc = await getDescriptor(thumbPath);
    if(desc){
      realDescMap.set(entry.id, desc);
      success++;
    } else {
      fail++;
    }
    if(i%50===0) console.log(`  ${i}/${index.length} success ${success} fail ${fail} (${entry.id})`);
    // Small yield to avoid blocking
    await new Promise(r=>setImmediate(r));
  }
  console.log(`Done: success ${success}/${index.length} fail ${fail}`);

  // Rebuild buckets with real descriptors where available, otherwise keep old
  // Need old descriptors from current bins for fallback
  const dim=128;
  const oldBin = fs.readFileSync(BIN_Q8);
  const scale = meta.scale;
  const newBuckets = [];
  // galleryBuckets is 2997 entries, each with id. For each bucket, if its id has realDesc, use that, else decode old
  for(let idx=0; idx<galleryBuckets.length; idx++){
    const b = galleryBuckets[idx];
    const real = realDescMap.get(b.id);
    let desc;
    if(real){
      desc = real;
    } else {
      // decode old
      const off=idx*dim;
      desc=new Array(dim);
      for(let j=0;j<dim;j++) desc[j]=(oldBin[off+j]-127)*scale;
      desc=l2Normalize(desc);
    }
    newBuckets.push({...b, descriptor: desc});
  }

  // Compute new maxAbs/scale for q8 (keep same scale for compatibility? Recompute)
  let maxAbs=0;
  for(const b of newBuckets) for(const v of b.descriptor) maxAbs=Math.max(maxAbs, Math.abs(v));
  const newScale = maxAbs/127 || meta.scale;
  console.log(`new maxAbs ${maxAbs.toFixed(4)} scale ${newScale.toFixed(6)} (old ${meta.scale})`);

  const q8=new Uint8Array(newBuckets.length*dim);
  const f32=new Float32Array(newBuckets.length*dim);
  for(let idx=0; idx<newBuckets.length; idx++){
    const d=newBuckets[idx].descriptor;
    for(let j=0;j<dim;j++){
      const v=d[j]??0;
      f32[idx*dim+j]=v;
      const q=Math.max(-127,Math.min(127,Math.round(v/newScale)));
      q8[idx*dim+j]=q+127;
    }
  }
  fs.writeFileSync(BIN_Q8, q8);
  fs.writeFileSync(BIN_F32, Buffer.from(f32.buffer));
  console.log(`wrote bins q8 ${(q8.length/1024).toFixed(1)}KB f32 ${(f32.byteLength/1024).toFixed(1)}KB`);

  // Write gallery buckets without descriptor (as before)
  const galleryOut = newBuckets.map(b=>({id:b.id,name:b.name,path:b.path,path192:b.path192,fallbackPath:b.fallbackPath,age:b.age,gender:b.gender,genderProb:b.genderProb}));
  fs.writeFileSync(GALLERY, JSON.stringify(galleryOut,null,2));
  console.log(`wrote ${GALLERY}`);

  // Update legacy embeddings.json
  const legacy = index.map(c=>{
    const b=newBuckets.find(x=>x.id===c.id);
    return {id:c.id,name:c.name,path:c.path,descriptor:b.descriptor,age:c.baseAge,gender:c.gender,genderProb:c.genderProb};
  });
  fs.writeFileSync(EMB_JSON, JSON.stringify({version:"4.1.0",model:"face-api-faceRecognitionNet-128",count:index.length,celebrities:legacy},null,2));
  console.log(`wrote legacy ${legacy.length}`);

  // Update meta to 4.1.0
  meta.version="4.1.0";
  meta.scale=newScale;
  meta.maxAbs=maxAbs;
  meta.enrolled=`1000 real celebs re-encoded with face-api (success ${success}/${index.length}, TTA-ready, L2-norm)`;
  fs.writeFileSync(META, JSON.stringify(meta,null,2));
  console.log(`meta v${meta.version} success rate ${(success/index.length*100).toFixed(1)}%`);

  const s96=fs.readdirSync(THUMBS96).reduce((a,f)=>a+fs.statSync(path.join(THUMBS96,f)).size,0);
  console.log(`thumbs ${(s96/1e6).toFixed(2)}M 96`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
