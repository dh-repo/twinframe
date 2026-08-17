/**
 * Independent enroll photo jobs (primary + extra views). No ONNX / canvas.
 */
import fs from "node:fs";
import path from "node:path";

/** Extra enrollment views per id: held-out 002+ (001 is eval-only) and extra-photos. */
export function extraImagePaths(id, celebsDir) {
  const out = [];
  const heldOutDir = path.join(celebsDir, "held-out", id);
  if (fs.existsSync(heldOutDir)) {
    for (const f of fs.readdirSync(heldOutDir).sort()) {
      if (/^0*1\.(jpe?g|png)$/i.test(f) || f.startsWith("001.")) continue;
      if (/\.(jpe?g|png)$/i.test(f)) out.push(path.join(heldOutDir, f));
    }
  }
  const extraDir = path.join(celebsDir, "extra-photos", id);
  if (fs.existsSync(extraDir)) {
    for (const f of fs.readdirSync(extraDir).sort()) {
      if (/\.(jpe?g|png)$/i.test(f)) out.push(path.join(extraDir, f));
    }
  }
  return out.slice(0, 3);
}

export function collectEnrollJobs(buckets, { celebsDir, thumbDir }) {
  const jobs = [];
  for (const b of buckets) {
    const hires = path.join(celebsDir, `${b.id}.jpg`);
    const thumb = path.join(thumbDir, `${b.id}.png`);
    const src = fs.existsSync(hires) ? hires : fs.existsSync(thumb) ? thumb : null;
    if (!src) {
      jobs.push({ kind: "missing", id: b.id, filePath: null, source: null });
      continue;
    }
    jobs.push({ kind: "primary", id: b.id, filePath: src, source: path.basename(src) });
    for (const extraPath of extraImagePaths(b.id, celebsDir)) {
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
