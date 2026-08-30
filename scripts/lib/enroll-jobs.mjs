/**
 * Independent enroll photo jobs (primary + extra views). No ONNX / canvas.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Max extra views enrolled per celebrity. Multi-shot centroids need several
 * genuinely different views; three was the old ceiling and starved every celeb
 * whose held-out dir already filled it.
 */
export const DEFAULT_EXTRA_VIEW_CAP = 8;

/** `TWINFRAME_EXTRA_VIEW_CAP=N` overrides the cap for one enroll run. */
export function resolveExtraViewCap(env = process.env, fallback = DEFAULT_EXTRA_VIEW_CAP) {
  const raw = env.TWINFRAME_EXTRA_VIEW_CAP;
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid TWINFRAME_EXTRA_VIEW_CAP "${raw}"`);
  }
  return Math.floor(n);
}

/** Held-out `001` is the eval probe — it must never be enrolled. */
function isHeldOutEvalProbe(fileName) {
  return /^0*1\.(jpe?g|png)$/i.test(fileName) || fileName.startsWith("001.");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/** Content hashes of held-out eval photos — extras that match are unique-sitting leaks. */
export function evalProbeHashes(id, celebsDir) {
  const hashes = new Set();
  const heldOutDir = path.join(celebsDir, "held-out", id);
  if (!fs.existsSync(heldOutDir)) return hashes;
  for (const f of fs.readdirSync(heldOutDir)) {
    if (!isHeldOutEvalProbe(f) || !/\.(jpe?g|png)$/i.test(f)) continue;
    hashes.add(sha256File(path.join(heldOutDir, f)));
  }
  return hashes;
}

function considerExtra(filePath, evalHashes, out) {
  if (evalHashes.has(sha256File(filePath))) return;
  out.push(filePath);
}

/** Extra enrollment views per id: held-out 002+ (001 is eval-only) and extra-photos. */
export function extraImagePaths(id, celebsDir, cap = resolveExtraViewCap()) {
  const out = [];
  const evalHashes = evalProbeHashes(id, celebsDir);
  const heldOutDir = path.join(celebsDir, "held-out", id);
  if (fs.existsSync(heldOutDir)) {
    for (const f of fs.readdirSync(heldOutDir).sort()) {
      if (isHeldOutEvalProbe(f)) continue;
      if (/\.(jpe?g|png)$/i.test(f)) considerExtra(path.join(heldOutDir, f), evalHashes, out);
    }
  }
  const extraDir = path.join(celebsDir, "extra-photos", id);
  if (fs.existsSync(extraDir)) {
    for (const f of fs.readdirSync(extraDir).sort()) {
      if (/\.(jpe?g|png)$/i.test(f)) considerExtra(path.join(extraDir, f), evalHashes, out);
    }
  }
  return out.slice(0, cap);
}

/** extras-only skips primaries and already-shipped (id, source) rows. */
export function filterEmbedJobs(jobs, { extrasOnly = false, shippedSources = new Set() } = {}) {
  return jobs.filter((j) => {
    if (extrasOnly) {
      if (j.kind !== "extra") return false;
      return !shippedSources.has(`${j.id}\u0000${j.source}`);
    }
    return j.kind !== "missing";
  });
}

/** Best on-disk portrait for a surgical re-enroll: jpg, else 192-px thumb, else 96-px thumb. */
export function preferRepairSource(id, celebsDir) {
  const jpg = path.join(celebsDir, `${id}.jpg`);
  if (fs.existsSync(jpg)) return jpg;
  const thumb192 = path.join(celebsDir, "thumbs/192", `${id}.webp`);
  if (fs.existsSync(thumb192)) return thumb192;
  const thumb96 = path.join(celebsDir, "thumbs/96", `${id}.webp`);
  if (fs.existsSync(thumb96)) return thumb96;
  return null;
}

/** Primary enroll photo: hi-res jpg if present, else the converted 256-px png thumb. */
export function primaryPhotoPath(id, celebsDir, thumbDir = "/tmp/twinframe-thumbs-png") {
  const hires = path.join(celebsDir, `${id}.jpg`);
  if (fs.existsSync(hires)) return hires;
  const thumb = path.join(thumbDir, `${id}.png`);
  if (fs.existsSync(thumb)) return thumb;
  return null;
}

export function collectEnrollJobs(buckets, { celebsDir, thumbDir, extraViewCap }) {
  const cap = extraViewCap ?? resolveExtraViewCap();
  const jobs = [];
  for (const b of buckets) {
    const src = primaryPhotoPath(b.id, celebsDir, thumbDir);
    // A celeb whose primary photo is not on disk (webp-thumb-only ids) still has
    // enrollable extra views — those were the ones starved of multi-shot coverage.
    jobs.push(
      src
        ? { kind: "primary", id: b.id, filePath: src, source: path.basename(src) }
        : { kind: "missing", id: b.id, filePath: null, source: null },
    );
    for (const extraPath of extraImagePaths(b.id, celebsDir, cap)) {
      jobs.push({
        kind: "extra",
        id: b.id,
        filePath: extraPath,
        source: path.relative(celebsDir, extraPath),
      });
    }
  }
  return jobs;
}
