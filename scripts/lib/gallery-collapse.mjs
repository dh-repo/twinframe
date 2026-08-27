/**
 * Visually reviewed AdaFace near-zero cluster: distinct people, not clones.
 * Do not auto-approve these ids as gallery drops.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cosineDistance, decodeV4Gallery } from "./gallery-binary.mjs";

export { cosineDistance };

export const NEAR_CLONE_MAX = 0.005;

export const COLLAPSE_IDS = [
  "alec-burden",
  "ralph-fiennes",
  "eugene-lipinski",
  "michael-kopsa",
  "eagle-egilsson",
  "bad-bunny",
  "lily-gladstone",
  "andy-thompson",
  "troy-rudeseal",
  "john-morayniss",
  "ray-galletti",
  "will-pascoe",
  "ed-sheeran",
  "oprah-winfrey",
];

export const HOUSEHOLD_COLLAPSE_IDS = new Set([
  "ralph-fiennes",
  "bad-bunny",
  "lily-gladstone",
  "ed-sheeran",
  "oprah-winfrey",
]);

export const SMOKING_GUN_PAIRS = [
  ["alec-burden", "ralph-fiennes"],
  ["bad-bunny", "lily-gladstone"],
  ["ed-sheeran", "oprah-winfrey"],
];

export const COLLAPSE_CONTROLS = ["adele", "zendaya"];

/** Filled after `diagnose-gallery-collapse.mjs` measures live AdaFace pairs. */
export const MEASURED_CAUSE = {
  kind: "pending-live-measurement",
  note: "Shipped cluster is pinned; live AdaFace cause is written after the diagnose run.",
};

export function q8Fingerprint(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function loadShippedGalleryRows(root) {
  const celebs = path.join(root, "public/celebs");
  const buckets = JSON.parse(fs.readFileSync(path.join(celebs, "gallery.buckets.json"), "utf8"));
  const buf = fs.readFileSync(path.join(celebs, "embeddings.v4.q8.bin"));
  const { header, vectors } = decodeV4Gallery(buf);
  if (header.vectorCount !== buckets.length) {
    throw new Error(`binary has ${header.vectorCount} vectors, buckets has ${buckets.length}`);
  }
  const dim = header.dimension;
  const payload = buf.subarray(32);
  const rows = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const raw = payload.subarray(i * dim, (i + 1) * dim);
    rows.push({
      id: b.id,
      name: b.name,
      path: b.path,
      path192: b.path192,
      fallbackPath: b.fallbackPath,
      gender: b.gender,
      descriptor: vectors[i],
      q8Fingerprint: q8Fingerprint(raw),
    });
  }
  return { header, rows };
}

export function shippedCollapsePairs(rows, ids = COLLAPSE_IDS, max = NEAR_CLONE_MAX) {
  const wanted = new Set(ids);
  const subset = rows.filter((r) => wanted.has(r.id));
  const pairs = [];
  for (let i = 0; i < subset.length; i++) {
    for (let j = i + 1; j < subset.length; j++) {
      const a = subset[i];
      const b = subset[j];
      const distance = cosineDistance(a.descriptor, b.descriptor);
      if (distance <= max) {
        pairs.push({
          a: a.id,
          b: b.id,
          distance,
          sameFingerprint: a.q8Fingerprint === b.q8Fingerprint,
        });
      }
    }
  }
  pairs.sort((x, y) => x.distance - y.distance);
  return pairs;
}

export function classifyPair(shippedD, liveD, max = NEAR_CLONE_MAX) {
  if (liveD == null) return "live-encode-failed";
  if (shippedD <= max && liveD <= max) return "pipeline-collapses-even-on-better-source";
  if (shippedD <= max && liveD > max) return "shipped-collapsed-live-recovers";
  if (shippedD > max && liveD <= max) return "live-collapses-shipped-ok";
  return "neither-collapsed";
}

export function parseDiagnoseArgs(argv, defaultIds = [...COLLAPSE_IDS, ...COLLAPSE_CONTROLS]) {
  const out = { json: null, ids: defaultIds };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      out.json = argv[++i];
    } else if (arg.startsWith("--json=")) {
      out.json = arg.slice("--json=".length);
    } else if (arg === "--ids") {
      out.ids = argv[++i].split(",").map((id) => id.trim()).filter(Boolean);
    } else if (arg.startsWith("--ids=")) {
      out.ids = arg.slice("--ids=".length).split(",").map((id) => id.trim()).filter(Boolean);
    }
  }
  return out;
}

export function assertReportsJsonPath(raw, root) {
  const resolved = path.resolve(root, raw);
  const reportsDir = path.resolve(root, "reports");
  if (resolved !== reportsDir && !resolved.startsWith(`${reportsDir}${path.sep}`)) {
    throw new Error(`--json path must stay under reports/: ${raw}`);
  }
  return resolved;
}

export function sourceKind(filePath) {
  if (filePath.includes("/thumbs/96/")) return "thumb96";
  if (filePath.includes("/thumbs/192/")) return "thumb192";
  if (filePath.endsWith(".jpg")) return "fullres";
  if (filePath.includes("twinframe-thumbs-png") || filePath.endsWith(".png")) return "png256";
  return "other";
}
