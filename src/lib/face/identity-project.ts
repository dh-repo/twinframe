import { l2Normalize } from "./embeddings.ts";

export const IDENTITY_PROJECT_BETA = 0.35;
export const AGE_GAP_TRIGGER = 15;
export const HAIR_GAP_TRIGGER = 0.25;

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function subScale(v: Float32Array, dir: Float32Array, scale: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) - scale * (dir[i] ?? 0);
  return out;
}

/**
 * Top-k directions of a residual cloud via power iteration + deflation.
 * Residuals should already be same-id (extra − primary).
 */
export function estimateNuissanceDirections(
  residuals: Float32Array[],
  k = 2,
): Float32Array[] {
  const dirs: Float32Array[] = [];
  if (residuals.length < 2) return dirs;
  const dim = residuals[0]!.length;
  const cloud = residuals.map((r) => {
    const c = new Float32Array(r);
    return c;
  });
  // mean-center
  const mean = new Float32Array(dim);
  for (const r of cloud) {
    for (let i = 0; i < dim; i++) mean[i] += r[i] ?? 0;
  }
  for (let i = 0; i < dim; i++) mean[i] /= cloud.length;
  for (const r of cloud) {
    for (let i = 0; i < dim; i++) r[i] = (r[i] ?? 0) - (mean[i] ?? 0);
  }

  for (let d = 0; d < k; d++) {
    let v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) v[i] = Math.sin((i + 1) * (d + 1) * 0.37);
    v = Float32Array.from(l2Normalize(v));
    for (let iter = 0; iter < 12; iter++) {
      const acc = new Float32Array(dim);
      for (const r of cloud) {
        const s = dot(r, v);
        for (let i = 0; i < dim; i++) acc[i] += s * (r[i] ?? 0);
      }
      v = Float32Array.from(l2Normalize(acc));
    }
    dirs.push(v);
    for (const r of cloud) {
      const s = dot(r, v);
      for (let i = 0; i < dim; i++) r[i] = (r[i] ?? 0) - s * (v[i] ?? 0);
    }
  }
  return dirs;
}

/** Soft wipe of nuisance directions, then L2-normalize. */
export function projectIdentity(
  v: ArrayLike<number>,
  dirs: Float32Array[],
  beta = IDENTITY_PROJECT_BETA,
): Float32Array {
  let cur: Float32Array<ArrayBuffer> = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) cur[i] = v[i] ?? 0;
  const b = Math.max(0, Math.min(1, beta));
  for (const dir of dirs) {
    if (dir.length !== cur.length) continue;
    cur = subScale(cur, dir, b * dot(cur, dir));
  }
  const out = l2Normalize(cur);
  const copy = new Float32Array(out.length);
  copy.set(out);
  return copy;
}

export function shouldProjectIdentity(
  userAge?: number,
  celebAge?: number,
  userHairL?: number,
  celebHairL?: number,
): boolean {
  if (
    typeof userAge === "number" &&
    typeof celebAge === "number" &&
    Math.abs(userAge - celebAge) > AGE_GAP_TRIGGER
  ) {
    return true;
  }
  if (
    typeof userHairL === "number" &&
    typeof celebHairL === "number" &&
    Math.abs(userHairL - celebHairL) > HAIR_GAP_TRIGGER
  ) {
    return true;
  }
  return false;
}
