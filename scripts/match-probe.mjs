#!/usr/bin/env node
/**
 * Product-path probe: SCRFD → align → EdgeFace-512 → rankByDescriptor
 * against the shipping gallery (AFv4 + extra-templates + centroids), then
 * the same verdict / pack / blurb functions the UI uses.
 *
 *   node --experimental-strip-types scripts/match-probe.mjs \
 *     --image public/celebs/held-out/kate-winslet/001.jpg
 *   node --experimental-strip-types scripts/match-probe.mjs \
 *     --image fixtures/probes/your-photo.jpg --pack nineties-icons --top 5
 *
 * Drop local photos in fixtures/probes/ (screenshots/ is gitignored and
 * never reaches the cloud workspace).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { catalogFor } from "../src/lib/celebrities/catalog.ts";
import { applyGalleryFeatureManifest } from "../src/lib/celebrities/gallery-features.ts";
import { applyPackManifest, celebInPack } from "../src/lib/celebrities/packs.ts";
import { l2Normalize } from "../src/lib/face/embeddings.ts";
import { isPaddedFaceNetDescriptor, buildMultiShotCentroidGallery } from "../src/lib/face/gallery-dedupe.ts";
import { rankByDescriptor } from "../src/lib/face/match.ts";
import { verdictLabel } from "../src/lib/face/verdict.ts";
import { composeMatchBlurb } from "../src/lib/ux/match-blurb.ts";
import { embedImageFile, productCropImageFile } from "./enroll-gallery-onnx.mjs";
import { loadV4Gallery } from "./lib/v4-gallery.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return fallback;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

function loadBrowserGallery() {
  const { gallery: primaries } = loadV4Gallery(ROOT);
  const extraPath = path.join(ROOT, "public/celebs/extra-templates.json");
  const templates = fs.existsSync(extraPath)
    ? (JSON.parse(fs.readFileSync(extraPath, "utf8")).templates ?? [])
    : [];
  const byId = new Map(primaries.map((p) => [p.id, p]));
  const extras = [];
  for (const template of templates) {
    const proto = byId.get(template.id);
    if (!proto || !template.descriptor?.length) continue;
    if (isPaddedFaceNetDescriptor(template.descriptor)) continue;
    extras.push({ ...proto, descriptor: Array.from(l2Normalize(template.descriptor)) });
  }
  return buildMultiShotCentroidGallery(extras.length ? primaries.concat(extras) : primaries);
}

async function main() {
  const image = arg("image");
  if (typeof image !== "string") {
    console.error("Usage: node --experimental-strip-types scripts/match-probe.mjs --image <jpg> [--pack all] [--top 5]");
    process.exit(1);
  }
  const imagePath = path.resolve(image);
  if (!fs.existsSync(imagePath)) {
    console.error(`Missing image: ${imagePath}`);
    process.exit(1);
  }
  const pack = arg("pack", "all");
  const topK = Number(arg("top", 5)) || 5;

  const packsPath = path.join(ROOT, "public/celebs/packs.json");
  if (fs.existsSync(packsPath)) {
    applyPackManifest(JSON.parse(fs.readFileSync(packsPath, "utf8")));
  }
  const featuresManifest = path.join(ROOT, "public/celebs/gallery.features.json");
  if (fs.existsSync(featuresManifest)) {
    applyGalleryFeatureManifest(JSON.parse(fs.readFileSync(featuresManifest, "utf8")));
  }

  const featuresPath = path.join(ROOT, "public/celebs/gallery.features.json");
  const features = fs.existsSync(featuresPath)
    ? JSON.parse(fs.readFileSync(featuresPath, "utf8"))
    : {};

  const skipCrop = process.argv.includes("--raw");
  let probePath = imagePath;
  let productCrop = null;
  if (!skipCrop) {
    productCrop = await productCropImageFile(
      imagePath,
      path.join(os.tmpdir(), "twinframe-product-crop.jpg"),
    );
    if (productCrop.cropped) probePath = productCrop.path;
    console.log(
      JSON.stringify(
        {
          productCrop: productCrop.cropped,
          faceCount: productCrop.faceCount,
          detScore: productCrop.score,
        },
        null,
        2,
      ),
    );
  }

  console.log(`probe: ${probePath}`);
  const t0 = Date.now();
  const emb = await embedImageFile(probePath);
  const encodeMs = Date.now() - t0;
  const descriptor = emb.d512 ?? emb.d256;
  if (!descriptor) {
    console.error("embedImageFile returned no descriptor");
    process.exit(2);
  }
  console.log(
    JSON.stringify(
      {
        encodeMs,
        dim: descriptor.length,
        usedDetection: emb.usedDetection,
        faceCount: emb.faceCount,
        detScore: emb.score,
      },
      null,
      2,
    ),
  );

  const gallery = loadBrowserGallery();
  const scoped = gallery.filter((c) => celebInPack(c.id, catalogFor(c.id).knownFor, pack));
  const matches = rankByDescriptor(
    {
      descriptor,
      age: Number.NaN,
      gender: "unknown",
      genderProbability: 0.5,
    },
    scoped,
    topK,
    { pack },
  );

  const rows = matches.map((m, i) => ({
    rank: i + 1,
    id: m.celebrityId,
    name: m.name,
    knownFor: m.knownFor,
    matchPercent: m.matchPercent,
    hillPercent: m.hillPercent,
    distance: m.distance,
    adjustedDistance: m.adjustedDistance,
    rankMargin: m.rankMargin,
    verdict: m.verdict,
    verdictLabel: m.verdict ? verdictLabel(m.verdict) : null,
    blurb: composeMatchBlurb({
      name: m.name,
      gender: m.gender,
      tags: m.tags,
      celebFeatures: features[m.celebrityId] ?? null,
    }),
  }));

  const report = {
    image: imagePath,
    probe: probePath,
    productCrop,
    pack,
    galleryVectors: gallery.length,
    packVectors: scoped.length,
    encodeMs,
    matches: rows,
  };
  const outDir = path.join(ROOT, "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outArg = arg("out");
  const outPath = path.resolve(
    typeof outArg === "string" ? outArg : path.join(outDir, "live-probe.json"),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
