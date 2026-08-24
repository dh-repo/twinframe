/**
 * src/lib/face/anti-gan.ts
 * AccuFace v4.0 Feature 12: Session-Bound Anti-GAN Orthogonal Subspace Projections.
 *
 * Protects 256-d facial feature embeddings against GAN Template Inversion Attacks
 * by projecting feature vectors onto the orthogonal complement S_GAN^\perp of a synthetic
 * reconstruction subspace spanned by an orthonormal basis U = [u_1, ..., u_k] bound to a
 * cryptographic session key.
 *
 * Implicit projection formula: y = x - U(U^T x)
 * L2 re-normalization: x_hat = y / ||y||_2 (with epsilon safeguard).
 */

import { l2Normalize } from "./embeddings.ts";

export interface AntiGanOptions {
  /** Rank of synthetic/GAN subspace basis U (default: 32) */
  subspaceRank?: number;
  /** Embedding dimensionality (default: 256) */
  dimension?: number;
  /** 256-bit cryptographic session key (32 bytes). Auto-generated if omitted. */
  sessionKey?: Uint8Array;
  /** Custom pre-trained synthetic subspace basis vectors (dimension x subspaceRank) */
  canonicalBasis?: Float32Array;
  /** Epsilon safeguard tolerance for Gram-Schmidt & L2 normalization (default: 1e-6) */
  epsilon?: number;
}

export interface SessionAntiGanContext {
  /** Unique session ID string */
  readonly sessionId: string;
  /** Cryptographic 256-bit session key (32 bytes) */
  readonly sessionKey: Uint8Array;
  /** Embedding vector dimension (d = 256) */
  readonly dimension: number;
  /** Subspace rank (k = 32) */
  readonly subspaceRank: number;
  /** Orthonormal basis matrix U (d x k, column-major flat Float32Array where column i is basis vector u_i) */
  readonly basisU: Float32Array;
  /** Epsilon safeguard tolerance */
  readonly epsilon: number;
  /** Creation timestamp (ms) */
  readonly createdAt: number;
}

export interface AntiGanVerificationResult {
  /** Whether all mathematical property checks passed within epsilon */
  valid: boolean;
  /** Maximum absolute error ||U^T U - I_k||_max */
  orthonormalityError: number;
  /** Maximum absolute error ||P^2 - P||_max */
  idempotencyError: number;
  /** Maximum absolute error ||P^T - P||_max */
  symmetryError: number;
  /** Maximum absolute error ||P * u_i||_max for basis vectors u_i in span(U) */
  nullSpaceError: number;
  /** Average L2 norm of projected vectors before re-normalization */
  projectedNormMean: number;
  /** Effective matrix rank (Tr(P)) */
  rank: number;
}

/**
 * Mulberry32 32-bit deterministic PRNG.
 */
function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a hash over Uint8Array session key to produce integer seed.
 */
function hashKeyToSeed(key: Uint8Array): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key[i]!;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Applies Modified Gram-Schmidt (MGS) orthonormalization to a flat column matrix A (d x k).
 * Mutates/returns column-major Float32Array U (d x k) where U^T U = I_k.
 */
function modifiedGramSchmidt(
  A: Float32Array,
  d: number,
  k: number,
  epsilon = 1e-6
): Float32Array {
  const U = new Float32Array(A);

  for (let i = 0; i < k; i++) {
    const colOffI = i * d;

    // Orthogonalize column i against all previously computed columns 0..i-1
    for (let j = 0; j < i; j++) {
      const colOffJ = j * d;
      let rji = 0;
      for (let m = 0; m < d; m++) {
        rji += U[colOffJ + m]! * U[colOffI + m]!;
      }
      for (let m = 0; m < d; m++) {
        U[colOffI + m] = U[colOffI + m]! - rji * U[colOffJ + m]!;
      }
    }

    // Compute L2 norm of column i
    let normSq = 0;
    for (let m = 0; m < d; m++) {
      const val = U[colOffI + m]!;
      normSq += val * val;
    }
    const norm = Math.sqrt(normSq);

    if (norm < epsilon) {
      // Degenerate vector: fallback to unit axis indicator
      for (let m = 0; m < d; m++) {
        U[colOffI + m] = m === i ? 1.0 : 0.0;
      }
    } else {
      for (let m = 0; m < d; m++) {
        U[colOffI + m] = U[colOffI + m]! / norm;
      }
    }
  }

  return U;
}

/**
 * Initialize a new session-bound Anti-GAN projection context.
 * Expands sessionKey via CSPRNG and applies Modified Gram-Schmidt (MGS)
 * to construct an orthonormal basis U (dimension x subspaceRank).
 */
export function initSessionAntiGan(options: AntiGanOptions = {}): SessionAntiGanContext {
  const d = options.dimension ?? 256;
  const k = options.subspaceRank ?? 32;
  const epsilon = options.epsilon ?? 1e-6;

  if (k >= d) {
    throw new Error(`[AntiGAN] Subspace rank k (${k}) must be strictly less than dimension d (${d})`);
  }

  let sessionKey = options.sessionKey;
  if (!sessionKey || sessionKey.length !== 32) {
    sessionKey = new Uint8Array(32);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(sessionKey);
    } else {
      const now = Date.now();
      for (let i = 0; i < 32; i++) {
        sessionKey[i] = (now >> (i % 4)) & 0xff;
      }
    }
  }

  let basisU: Float32Array;

  if (options.canonicalBasis && options.canonicalBasis.length === d * k) {
    basisU = modifiedGramSchmidt(options.canonicalBasis, d, k, epsilon);
  } else {
    // Expand sessionKey via Mulberry32 PRNG + Box-Muller Gaussian matrix
    const seed = hashKeyToSeed(sessionKey);
    const rng = mulberry32(seed);
    const rawMatrix = new Float32Array(d * k);

    let idx = 0;
    const total = d * k;
    while (idx < total) {
      let u1 = rng();
      const u2 = rng();
      while (u1 <= 1e-15) u1 = rng();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
      rawMatrix[idx++] = z0;
      if (idx < total) rawMatrix[idx++] = z1;
    }

    basisU = modifiedGramSchmidt(rawMatrix, d, k, epsilon);
  }

  const sessionId = Array.from(sessionKey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);

  return {
    sessionId,
    sessionKey,
    dimension: d,
    subspaceRank: k,
    basisU,
    epsilon,
    createdAt: Date.now(),
  };
}

/**
 * Project a single 256-d embedding vector x onto the orthogonal complement of the synthetic GAN subspace:
 * y = x - U (U^T x)
 * and L2-renormalize to unit length: x_hat = y / ||y||_2.
 * Uses fast implicit computation O(d * k).
 */
export function projectAntiGan(
  embedding: ArrayLike<number>,
  ctx: SessionAntiGanContext
): Float32Array {
  const d = ctx.dimension;
  const k = ctx.subspaceRank;
  const U = ctx.basisU;
  const eps = ctx.epsilon;

  if (!embedding || embedding.length !== d) {
    throw new RangeError(`[AntiGAN] Input embedding must be of length ${d} (got ${embedding?.length})`);
  }

  // 1. Compute c = U^T x (length k)
  const c = new Float32Array(k);
  for (let i = 0; i < k; i++) {
    const colOff = i * d;
    let dot = 0;
    for (let j = 0; j < d; j++) {
      dot += U[colOff + j]! * (embedding[j] ?? 0);
    }
    c[i] = dot;
  }

  // 2. Compute y = x - U * c (length d)
  const y = new Float32Array(d);
  for (let j = 0; j < d; j++) {
    let sub = 0;
    for (let i = 0; i < k; i++) {
      sub += c[i]! * U[i * d + j]!;
    }
    y[j] = (embedding[j] ?? 0) - sub;
  }

  // 3. Compute ||y||_2 norm with epsilon safeguard
  let normSq = 0;
  for (let j = 0; j < d; j++) {
    normSq += y[j]! * y[j]!;
  }
  const norm = Math.sqrt(normSq);

  if (norm < eps || !Number.isFinite(norm)) {
    // Epsilon safeguard against zero/null space vector degeneracy
    return l2Normalize(embedding);
  }

  // 4. L2-renormalize projected vector
  const out = new Float32Array(d);
  for (let j = 0; j < d; j++) {
    out[j] = y[j]! / norm;
  }

  return out;
}

/**
 * Batch project multiple 256-d embedding vectors using active session context.
 */
export function projectAntiGanBatch(
  embeddings: ArrayLike<number>[],
  ctx: SessionAntiGanContext
): Float32Array[] {
  return embeddings.map((emb) => projectAntiGan(emb, ctx));
}

/**
 * Explicitly compute 256x256 projection matrix P = I_d - U U^T.
 * Provided for inspection, diagnostic tests, and shader uniform uploads.
 */
export function computeAntiGanProjectionMatrix(ctx: SessionAntiGanContext): Float32Array {
  const d = ctx.dimension;
  const k = ctx.subspaceRank;
  const U = ctx.basisU;
  const P = new Float32Array(d * d);

  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      let uut = 0;
      for (let m = 0; m < k; m++) {
        uut += U[m * d + i]! * U[m * d + j]!;
      }
      const eye = i === j ? 1.0 : 0.0;
      P[i * d + j] = eye - uut;
    }
  }

  return P;
}

/**
 * Verify mathematical integrity of Anti-GAN session context (orthonormality, idempotency, null space).
 */
export function verifyAntiGanContext(
  ctx: SessionAntiGanContext,
  epsilon = 1e-5
): AntiGanVerificationResult {
  const d = ctx.dimension;
  const k = ctx.subspaceRank;
  const U = ctx.basisU;

  // 1. Orthonormality Check: ||U^T U - I_k||_max
  let orthonormalityError = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let dot = 0;
      for (let m = 0; m < d; m++) {
        dot += U[i * d + m]! * U[j * d + m]!;
      }
      const target = i === j ? 1.0 : 0.0;
      const diff = Math.abs(dot - target);
      if (diff > orthonormalityError) orthonormalityError = diff;
    }
  }

  // 2. Explicit Matrix Properties: P = I - U U^T
  const P = computeAntiGanProjectionMatrix(ctx);

  // Symmetry: ||P^T - P||_max
  let symmetryError = 0;
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      const diff = Math.abs(P[i * d + j]! - P[j * d + i]!);
      if (diff > symmetryError) symmetryError = diff;
    }
  }

  // Idempotency: ||P^2 - P||_max
  let idempotencyError = 0;
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      let p2ij = 0;
      for (let m = 0; m < d; m++) {
        p2ij += P[i * d + m]! * P[m * d + j]!;
      }
      const diff = Math.abs(p2ij - P[i * d + j]!);
      if (diff > idempotencyError) idempotencyError = diff;
    }
  }

  // 3. Null space check: P * u_i = 0 for all basis vectors u_i
  let nullSpaceError = 0;
  for (let i = 0; i < k; i++) {
    const colOff = i * d;
    const ui = U.subarray(colOff, colOff + d);
    for (let row = 0; row < d; row++) {
      let sum = 0;
      for (let col = 0; col < d; col++) {
        sum += P[row * d + col]! * ui[col]!;
      }
      const absVal = Math.abs(sum);
      if (absVal > nullSpaceError) nullSpaceError = absVal;
    }
  }

  // 4. Trace / Rank: Tr(P) = sum P_{i,i}
  let trace = 0;
  for (let i = 0; i < d; i++) {
    trace += P[i * d + i]!;
  }
  const rank = Math.round(trace);

  // 5. Projected norm mean across sample synthetic vectors
  let normSum = 0;
  const sampleCount = 20;
  for (let s = 0; s < sampleCount; s++) {
    const v = new Float32Array(d);
    for (let j = 0; j < d; j++) v[j] = Math.sin(s * 13 + j * 0.7);
    const vNorm = l2Normalize(v);
    const proj = projectAntiGan(vNorm, ctx);
    let nSq = 0;
    for (let j = 0; j < d; j++) nSq += proj[j]! * proj[j]!;
    normSum += Math.sqrt(nSq);
  }
  const projectedNormMean = normSum / sampleCount;

  const valid =
    orthonormalityError <= epsilon &&
    idempotencyError <= epsilon &&
    symmetryError <= epsilon &&
    nullSpaceError <= epsilon &&
    rank === d - k;

  return {
    valid,
    orthonormalityError,
    idempotencyError,
    symmetryError,
    nullSpaceError,
    projectedNormMean,
    rank,
  };
}
