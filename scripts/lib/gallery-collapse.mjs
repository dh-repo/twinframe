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

/**
 * Live AdaFace+BGR (2026-08-27) vs the shipped AFv4 binary.
 * Controls match the 192-px enroll thumbs; cluster slots do not match their portraits.
 */
export const MEASURED_CAUSE = {
  kind: "poisoned-shipped-slots",
  sameQ8Fingerprint: false,
  smokingGuns: [
    { a: "alec-burden", b: "ralph-fiennes", shipped: 0.0009, liveFar: 1.0228, liveKind: "thumb192" },
    { a: "bad-bunny", b: "lily-gladstone", shipped: 0.0027, liveFar: 1.076, liveKind: "thumb96" },
    { a: "ed-sheeran", b: "oprah-winfrey", shipped: 0.0047, liveFar: 1.0225, liveKind: "fullres" },
  ],
  controls: [
    { id: "adele", source: "thumb192", shippedDistance: 0.00066 },
    { id: "zendaya", source: "thumb192", shippedDistance: 0.00064 },
  ],
  rebuildRule:
    "Surgical in-place AdaFace+BGR re-enroll of the 14 slots from jpg or 192-px thumbs; existing globalScale; refuse whole-crop primaries. Household names stay. Other q8 rows unchanged.",
  controlFingerprints: {
    adele: "865e654c0b3fa4d6860de400ef764fb151bb6771810000a0d6b3f980652fb297",
    zendaya: "52d68177e705681d8a8fa843c1887822563917f660c97ec4a179586f2d650b10",
  },
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
