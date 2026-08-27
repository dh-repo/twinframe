/**
 * Shared AFv4 gallery loader + leave-one-out runner for audit / gold / LOO scripts.
 */
import fs from "node:fs";
import path from "node:path";
import { parseV4BinaryHeader, l2Normalize } from "../../src/lib/face/embeddings.ts";
import { rankByDescriptor } from "../../src/lib/face/match.ts";
import { buildMultiShotCentroidGallery } from "../../src/lib/face/gallery-dedupe.ts";
import {
  EMPTY_GALLERY_DEMOTIONS,
  applyReviewedDemotions,
  parseGalleryDemotions,
} from "../../src/lib/face/gallery-demotions.ts";
import { honestyBand } from "../../src/lib/ux/honesty.ts";

export function loadGalleryDemotions(root) {
  const specPath = path.join(root, "public/celebs/gallery-demotions.json");
  if (!fs.existsSync(specPath)) return EMPTY_GALLERY_DEMOTIONS;
  return parseGalleryDemotions(JSON.parse(fs.readFileSync(specPath, "utf8")));
}

/**
 * Load the shipped AFv4 gallery.
 * Product evals apply approved demotions (default). Audit must pass
 * `{ applyDemotions: false }` so review still sees raw collisions.
 */
export function loadV4Gallery(root, options = {}) {
  const applyDemotions = options.applyDemotions !== false;
  const celebs = path.join(root, "public/celebs");
  const buckets = JSON.parse(
    fs.readFileSync(path.join(celebs, "gallery.buckets.json"), "utf8"),
  );
  const buf = fs.readFileSync(path.join(celebs, "embeddings.v4.q8.bin"));
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const header = parseV4BinaryHeader(arrayBuf);
  if (!header || header.magic !== "AFv4" || (header.dimension !== 256 && header.dimension !== 512)) {
    throw new Error("Invalid embeddings.v4.q8.bin header");
  }
  const dim = header.dimension;
  const payload = new Uint8Array(arrayBuf, 32);
  const scale = header.globalScale;
  const out = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const raw = new Float32Array(dim);
    const off = i * dim;
    for (let j = 0; j < dim; j++) {
      raw[j] = (payload[off + j] - 128) * scale;
    }
    out.push({
      id: b.id,
      name: b.name,
      path: b.path,
      path192: b.path192,
      fallbackPath: b.fallbackPath,
      descriptor: Array.from(l2Normalize(raw)),
      age: b.age,
      gender: b.gender,
      genderProb: b.genderProb,
    });
  }
  const built = buildMultiShotCentroidGallery(out);
  const gallery = applyDemotions
    ? applyReviewedDemotions(built, loadGalleryDemotions(root))
    : built;
  return { header, gallery };
}

export function quantile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i];
}

export function runLeaveOneOut(gallery) {
  const byId = new Map();
  for (const row of gallery) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const identities = Array.from(byId.values());
  const hits = [];
  let refused = 0;
  const bands = { weak: 0, soft: 0, strong: 0 };

  for (const probe of identities) {
    const others = gallery.filter((g) => g.id !== probe.id);
    const matches = rankByDescriptor(
      {
        descriptor: Float32Array.from(probe.descriptor),
        age: probe.age ?? 35,
        gender: probe.gender ?? "unknown",
        genderProbability: probe.genderProb ?? 0.9,
      },
      others,
      5,
    );
    if (matches.length === 0) {
      refused++;
      continue;
    }
    const top = matches[0];
    const band = honestyBand(top.matchPercent, top.rankMargin);
    bands[band] += 1;
    hits.push({
      probeId: probe.id,
      probeName: probe.name,
      topId: top.celebrityId,
      topName: top.name,
      distance: top.distance ?? null,
      hillPercent: top.hillPercent ?? top.matchPercent,
      matchPercent: top.matchPercent,
      rankMargin: top.rankMargin ?? null,
      band,
    });
  }

  const percents = hits.map((h) => h.matchPercent).sort((a, b) => a - b);
  const hills = hits.map((h) => h.hillPercent).sort((a, b) => a - b);
  const margins = hits.map((h) => h.rankMargin ?? 0).sort((a, b) => a - b);
  const distances = hits
    .map((h) => h.distance)
    .filter((d) => typeof d === "number" && Number.isFinite(d))
    .sort((a, b) => a - b);

  return {
    identities: identities.length,
    scored: hits.length,
    refused,
    bands,
    hits,
    quantiles: {
      displayPercent: {
        p10: quantile(percents, 0.1),
        p50: quantile(percents, 0.5),
        p90: quantile(percents, 0.9),
      },
      hillPercent: {
        p10: quantile(hills, 0.1),
        p50: quantile(hills, 0.5),
        p90: quantile(hills, 0.9),
      },
      margin: {
        p10: quantile(margins, 0.1),
        p50: quantile(margins, 0.5),
        p90: quantile(margins, 0.9),
      },
      distance: {
        p10: quantile(distances, 0.1),
        p50: quantile(distances, 0.5),
        p90: quantile(distances, 0.9),
      },
    },
  };
}
