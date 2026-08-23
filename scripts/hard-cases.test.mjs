/**
 * Hard-case suite runnable in CI (node --test): model-level non-face rejection,
 * face-positive control, group-photo multi-face path, and small-face crop path
 * using the legacy face-api SSD MobileNet detector in node — the same detector
 * the enrollment tooling and the pipeline's demographic pass use. Live SCRFD
 * end-to-end behavior is covered by the Playwright harnesses.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import nodeUtil from "node:util";
import { fileURLToPath } from "node:url";

// face-api.esm.js expects util.TextEncoder on the global chain under node.
Object.defineProperty(Object.prototype, "TextEncoder", {
  value: globalThis.TextEncoder,
  configurable: true,
  writable: true,
  enumerable: false,
});
Object.defineProperty(Object.prototype, "TextDecoder", {
  value: globalThis.TextDecoder,
  configurable: true,
  writable: true,
  enumerable: false,
});
Object.defineProperty(Object.prototype, "types", {
  value: nodeUtil.types,
  configurable: true,
  writable: true,
  enumerable: false,
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIR = path.join(ROOT, "public/models/face-api");

const canvasMod = await import("canvas");
const { Canvas, Image, ImageData } = canvasMod;
const faceapi = await import("@vladmandic/face-api/dist/face-api.esm.js");

faceapi.env.monkeyPatch({
  Canvas,
  Image,
  ImageData,
  readFile: (filePath) => fs.promises.readFile(filePath),
});

const MIN_CONFIDENCE = 0.5;

async function detectFaces(input) {
  return faceapi.detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE }));
}

function makeCanvas(w, h) {
  const c = canvasMod.createCanvas(w, h);
  return c;
}

function sunsetCanvas() {
  const c = makeCanvas(800, 800);
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 800);
  grad.addColorStop(0, "#ff7e5f");
  grad.addColorStop(0.5, "#feb47b");
  grad.addColorStop(1, "#2c3e50");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 800);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  for (const [x, y, r] of [[200, 300, 100], [320, 280, 120], [450, 310, 90]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function noiseCanvas(w, h, seed) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  let s = seed >>> 0;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    img.data[i] = s & 0xff;
    img.data[i + 1] = (s >> 8) & 0xff;
    img.data[i + 2] = (s >> 16) & 0xff;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function textCanvas() {
  const c = makeCanvas(640, 480);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 640, 480);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 72px sans-serif";
  ctx.fillText("NO FACE HERE", 60, 240);
  return c;
}

function imageFromFile(filePath) {
  const img = new Image();
  img.src = fs.readFileSync(filePath);
  return img;
}

async function compositeSideBySide(fileA, fileB) {
  const a = imageFromFile(fileA);
  const b = imageFromFile(fileB);
  const H = Math.max(a.height, b.height);
  const c = makeCanvas(a.width + b.width + 40, H + 40);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#202020";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(a, 10, 20);
  ctx.drawImage(b, a.width + 30, 20);
  return c;
}

// Load once at module scope so every test runs against an initialized CPU backend.
await faceapi.tf.setBackend("cpu");
await faceapi.tf.ready();
await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);

describe("hard cases: legacy-detector rejection and multi-face paths", () => {

  it("rejects a synthetic sunset/clouds image with zero faces", { timeout: 60_000 }, async () => {
    const faces = await detectFaces(sunsetCanvas());
    assert.equal(faces.length, 0, `expected no faces on sky scene, got ${faces.length}`);
  });

  it("rejects uniform noise with zero faces", { timeout: 60_000 }, async () => {
    const faces = await detectFaces(noiseCanvas(512, 512, 0xc0ffee));
    assert.equal(faces.length, 0, `expected no faces on noise, got ${faces.length}`);
  });

  it("rejects a solid-color frame with zero faces", { timeout: 60_000 }, async () => {
    const c = makeCanvas(400, 400);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 400, 400);
    const faces = await detectFaces(c);
    assert.equal(faces.length, 0, `expected no faces on flat color, got ${faces.length}`);
  });

  it("rejects text-only imagery with zero faces", { timeout: 60_000 }, async () => {
    const faces = await detectFaces(textCanvas());
    assert.equal(faces.length, 0, `expected no faces on text image, got ${faces.length}`);
  });

  it("positive control: detects the single face in a tracked gallery portrait", { timeout: 60_000 }, async () => {
    const faces = await detectFaces(imageFromFile(path.join(ROOT, "public/celebs/adam-driver.jpg")));
    assert.equal(faces.length, 1, `expected exactly 1 portrait face, got ${faces.length}`);
  });

  it("group photo path: two portraits side-by-side yield at least two detections", { timeout: 90_000 }, async () => {
    const composite = await compositeSideBySide(
      path.join(ROOT, "public/celebs/tilda-swinton.jpg"),
      path.join(ROOT, "public/celebs/kieran-culkin.jpg"),
    );
    const faces = await detectFaces(composite);
    assert.ok(faces.length >= 2, `expected >=2 faces in composite, got ${faces.length}`);
  });

  it("small-face boundary: direct recovery from 192px sources, honest refusal below ~100px", { timeout: 90_000 }, async () => {
    // Measured behavior (2026-08, node CPU, SSD MobileNet):
    //  - a 192px-tall portrait pasted into a 1280x720 frame is still found full-frame;
    //  - its tight crop, upscaled to 512 like re-encode.tsx upscaleIfNeeded does,
    //    detects at ~0.86 confidence;
    //  - a 96px source stays undetected after upscaling even at 0.1 confidence —
    //    the pipeline must refuse such input honestly instead of hallucinating.
    const src = imageFromFile(path.join(ROOT, "public/celebs/tilda-swinton.jpg"));

    function downscaledToHeight(h) {
      const sc = h / src.height;
      const c = makeCanvas(Math.max(1, Math.round(src.width * sc)), h);
      c.getContext("2d").drawImage(src, 0, 0, c.width, h);
      return c;
    }

    function upscaled512(canvasIn) {
      const target = 512;
      const up = makeCanvas(target, target);
      const uc = up.getContext("2d");
      uc.fillStyle = "#ffffff";
      uc.fillRect(0, 0, target, target);
      uc.drawImage(canvasIn, 0, 0, target, target);
      return up;
    }

    const medium = downscaledToHeight(192);
    const big = makeCanvas(1280, 720);
    const ctx = big.getContext("2d");
    ctx.fillStyle = "#303030";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.drawImage(medium, 560, 260);

    const fullFrame = await detectFaces(big);
    assert.ok(fullFrame.length >= 1, `expected full-frame detection of a 192px face, got ${fullFrame.length}`);

    const croppedUp = await detectFaces(upscaled512(medium));
    assert.ok(
      croppedUp.length >= 1 && croppedUp[0].score >= MIN_CONFIDENCE,
      `expected confident detection on 192px crop upscaled to 512, got ${croppedUp.map((f) => f.score.toFixed(2))}`,
    );

    const tiny = upscaled512(downscaledToHeight(96));
    const tinyFaces = await faceapi.detectAllFaces(tiny, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.1 }));
    assert.equal(tinyFaces.length, 0, `a 96px source must stay rejected even at 0.1 confidence, got ${tinyFaces.length}`);
    void ctx;
  });

});

