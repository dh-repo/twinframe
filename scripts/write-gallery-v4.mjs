#!/usr/bin/env node
/**
 * Write the AccuFace v5 binary gallery from /tmp/twinframe-enroll:
 *  - public/celebs/embeddings.v4.q8.bin  (AFv4 header, 512-d uint8-biased)
 *  - public/celebs/embeddings.v4.meta.json (version 5.0.0)
 *  - public/celebs/extra-templates.json (real EdgeFace 512-d multi-shot views)
 *
 * Usage:
 *   node scripts/write-gallery-v4.mjs                    # full rebuild (needs all 1000 primaries)
 *   node scripts/write-gallery-v4.mjs --extras-only      # merge new views, binary untouched
 *   node scripts/write-gallery-v4.mjs --extras-only --regate-existing [maxDist]
 *
 * `--regate-existing` re-checks already shipped templates against the enrolled
 * primaries and drops the ones that are further away than random impostors
 * (default 0.9) — those are wrong-person photos poisoning a centroid.
 *
 * `--extras-only` is the safe incremental path: a partial primary enroll must
 * never overwrite the shipping binary, and a half-written binary is far worse
 * than a stale one.
 */
import fs from "node:fs";
import path from "node:path";
import { gateExtraCandidates, mergeExtraTemplates } from "./lib/extra-gate.mjs";
import { cosineDistance, decodeV4Gallery, encodeV4Gallery } from "./lib/gallery-binary.mjs";

const ROOT = process.cwd();
const CELEBS = path.join(ROOT, "public/celebs");
const ENROLL_DIR = "/tmp/twinframe-enroll";
const DIM = 512;
const EXTRAS_ONLY = process.argv.includes("--extras-only");
const regateIdx = process.argv.indexOf("--regate-existing");
const REGATE_EXISTING = regateIdx >= 0;
/** Random impostor pairs sit at p01 0.72 / p50 0.98 — past 0.9 a "same person" claim is not credible. */
const REGATE_MAX_DISTANCE = Number(process.argv[regateIdx + 1]) || 0.9;

/** Enrolled primaries straight from the shipping binary. */
function shippedPrimaries() {
  const { header, vectors } = decodeV4Gallery(fs.readFileSync(path.join(CELEBS, "embeddings.v4.q8.bin")));
  const ids = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
  if (header.vectorCount !== ids.length) {
    throw new Error(`binary has ${header.vectorCount} vectors, buckets has ${ids.length}`);
  }
  const byId = new Map();
  for (let i = 0; i < ids.length; i++) {
    if (!byId.has(ids[i].id)) byId.set(ids[i].id, vectors[i]);
  }
  return byId;
}

const extras = JSON.parse(fs.readFileSync(path.join(ENROLL_DIR, "extras.json"), "utf8"));
const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
const templatePath = path.join(CELEBS, "extra-templates.json");

const roundDescriptor = (d512) => d512.map((v) => Math.round(v * 100000) / 100000);
const incomingTemplates = extras.map((e) => ({
  id: e.id,
  source: e.source,
  descriptor: roundDescriptor(e.d512),
}));

if (EXTRAS_ONLY) {
  const existing = fs.existsSync(templatePath)
    ? JSON.parse(fs.readFileSync(templatePath, "utf8"))
    : { version: "2.1.0-adaface512", model: "AdaFace-IR101-WebFace12M", dim: DIM, templates: [] };
  const merged = mergeExtraTemplates(existing, incomingTemplates);
  let templates = merged.templates;

  if (REGATE_EXISTING) {
    const regate = gateExtraCandidates(
      templates.map((t) => ({ id: t.id, source: t.source, descriptor: t.descriptor })),
      {
        primaries: shippedPrimaries(),
        maxDistance: REGATE_MAX_DISTANCE,
        nearDuplicateEps: 0, // keep every shipped view; only wrong-person rows go
      },
    );
    const keep = new Set(regate.accepted.map((a) => `${a.id}\u0000${a.source}`));
    templates = templates.filter((t) => keep.has(`${t.id}\u0000${t.source}`));
    console.log(
      `re-gated shipped templates at ${REGATE_MAX_DISTANCE}: dropped ${regate.stats.rejected} ` +
        `(${JSON.stringify(regate.stats.byReason)})`,
    );
    for (const r of regate.rejected.slice(0, 10)) {
      console.log(`  drop ${r.id} ${r.source} d=${r.distance}`);
    }
  }

  const idCount = new Set(templates.map((t) => t.id)).size;
  fs.writeFileSync(
    templatePath,
    JSON.stringify({ ...existing, version: "2.1.0-adaface512", model: "AdaFace-IR101-WebFace12M", dim: DIM, templates }),
  );
  console.log(
    `extras-only: templates ${templates.length} (added ${merged.added}, replaced ${merged.replaced}) ` +
      `covering ${idCount} ids — embeddings.v4.q8.bin untouched`,
  );
  process.exit(0);
}

const rows = JSON.parse(fs.readFileSync(path.join(ENROLL_DIR, "embeddings.json"), "utf8"));
const byId = new Map(rows.map((r) => [r.id, r]));
const missing = buckets.filter((b) => !byId.has(b.id));
if (missing.length > 0) {
  throw new Error(
    `missing enrollments for ${missing.length} ids: ${missing.slice(0, 5).map((b) => b.id).join(", ")}. ` +
      `Run a full enroll, or use --extras-only to ship just the new views.`,
  );
}

const vectors = buckets.map((b) => Float32Array.from(byId.get(b.id).d512));
const { buffer, scale, maxAbs } = encodeV4Gallery(vectors, DIM);
const binPath = path.join(CELEBS, "embeddings.v4.q8.bin");

// The same pipeline over the same photos reproduces the shipped primaries to
// quantization error. Anything further means a source photo moved under us.
const DRIFT_ABORT = 0.25;
if (fs.existsSync(binPath) && !process.argv.includes("--allow-drift")) {
  const shipped = decodeV4Gallery(fs.readFileSync(binPath));
  if (shipped.header.vectorCount === buckets.length) {
    const drifted = [];
    let worstDrift = 0;
    for (let i = 0; i < buckets.length; i++) {
      const d = cosineDistance(vectors[i], shipped.vectors[i]);
      worstDrift = Math.max(worstDrift, d);
      if (d > DRIFT_ABORT) drifted.push(`${buckets[i].id}:${d.toFixed(3)}`);
    }
    console.log(`primary drift vs shipped gallery: worst ${worstDrift.toFixed(5)}`);
    if (drifted.length > 0) {
      throw new Error(
        `${drifted.length} primaries drifted past ${DRIFT_ABORT} (${drifted.slice(0, 5).join(", ")}). ` +
          `Re-check the source photos, then pass --allow-drift if this is intended.`,
      );
    }
  }
}

// Verify a staged copy before it replaces the shipping gallery: a half-written
// binary breaks every client, a stale one only misses the new views.
const stagedPath = `${binPath}.tmp`;
fs.writeFileSync(stagedPath, buffer);
const verify = decodeV4Gallery(fs.readFileSync(stagedPath));
if (verify.header.vectorCount !== buckets.length || verify.header.dimension !== DIM) {
  fs.rmSync(stagedPath, { force: true });
  throw new Error("verification failed: header does not describe the written gallery");
}
let worst = 0;
for (let i = 0; i < vectors.length; i++) {
  worst = Math.max(worst, cosineDistance(vectors[i], verify.vectors[i]));
}
if (worst > 0.01) {
  fs.rmSync(stagedPath, { force: true });
  throw new Error(`verification failed: self-match distance ${worst.toFixed(4)} too large`);
}
fs.renameSync(stagedPath, binPath);

const meta = {
  version: "5.0.0",
  model: "EdgeFace-S-gamma05-512d",
  dim: DIM,
  countCelebs: buckets.length,
  countBuckets: buckets.length,
  quantization: "int8-symmetric-header",
  scale,
  maxAbs,
  headerSize: 32,
  detector: "SCRFD-2.5G-bnkps",
  files: {
    q8: "/celebs/embeddings.v4.q8.bin",
    biohash: "/celebs/embeddings.v4.biohash.bin",
    meta: "/celebs/embeddings.v4.meta.json",
    index: "/celebs/index.json",
    buckets: "/celebs/gallery.buckets.json",
  },
  enrolledAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(CELEBS, "embeddings.v4.meta.json"), JSON.stringify(meta, null, 2));

fs.writeFileSync(
  templatePath,
  JSON.stringify({
    version: "2.0.0",
    model: meta.model,
    dim: DIM,
    templates: incomingTemplates,
  }),
);

console.log(
  `wrote bin (${buffer.length} bytes, ${buckets.length}x${DIM}, worst self-match ${worst.toFixed(5)}), ` +
    `meta v${meta.version}, extras=${incomingTemplates.length}`,
);
