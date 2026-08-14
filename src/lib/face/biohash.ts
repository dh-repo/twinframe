/**
 * src/lib/face/biohash.ts
 * AccuFace v4.0 Feature 11: 512-bit Biohashing & WASM Popcount Candidate Screening.
 *
 * Implements client-side key-derived Random Projection biohashing for EdgeFace-M 256-d embeddings,
 * 64-byte packed binary representation, SWAR popcount32 fallback, and WebAssembly native i64.popcnt
 * candidate screening over candidate biohash catalogs.
 */

export interface BiohashOptions {
  /** Secret key or seed string used to generate projection matrix R (default: "twinframe-accuface-v4-biohash-seed") */
  secretKey?: string | Uint8Array;
  /** Output biohash dimension in bits (default: 512 bits = 64 bytes) */
  biohashBits?: 512;
  /** Input embedding dimension (default: 256 for EdgeFace-M) */
  embeddingDim?: 256;
}

export interface BiohashResult {
  /** 64-byte packed binary biohash representation */
  hash: Uint8Array;
  /** Dimension in bits (always 512) */
  bitLength: number;
  /** Latency in milliseconds */
  latencyMs: number;
}

export interface BiohashCandidateScreeningOptions {
  /** Maximum Hamming distance (in bits out of 512) for candidate inclusion (default: 200) */
  maxHammingDistance?: number;
  /** Maximum candidate count to return after ranking (default: 100) */
  topM?: number;
  /** Minimum candidate count required; if fewer pass threshold, returns top M candidates by distance (default: 20) */
  minCandidates?: number;
  /** Force TypeScript fallback screening even if WASM popcount module is available */
  forceTS?: boolean;
}

export interface BiohashScreeningCandidate {
  /** Original catalog entry index in gallery array */
  index: number;
  /** Absolute Hamming distance in bits [0..512] */
  hammingDistance: number;
  /** Normalized Hamming distance [0.0..1.0] (hammingDistance / 512) */
  normalizedDistance: number;
}

export interface BiohashScreeningResult {
  /** Filtered array of candidate matches sorted by ascending Hamming distance */
  candidates: BiohashScreeningCandidate[];
  /** Total catalog biohashes evaluated */
  totalEvaluated: number;
  /** Total candidates passing threshold criteria */
  passedCount: number;
  /** Execution latency in milliseconds */
  latencyMs: number;
  /** Screening engine provider utilized */
  providerUsed: "wasm" | "typescript";
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
 * Converts secret key (string or Uint8Array) to a 32-bit integer seed via FNV-1a hash.
 */
export function hashKeyToSeed(key: string | Uint8Array): number {
  let hash = 2166136261;
  if (typeof key === "string") {
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  } else {
    for (let i = 0; i < key.length; i++) {
      hash ^= key[i]!;
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

// Projection matrix module-level cache
let cachedMatrixKey: string | null = null;
let cachedProjectionMatrix: Float32Array | null = null;

/**
 * Generates or retrieves cached 512x256 Gaussian Random Projection Matrix R.
 * Matrix is stored as flat Float32Array of length 131,072 (512 * 256).
 */
export function getProjectionMatrix(
  key: string | Uint8Array = "twinframe-accuface-v4-biohash-seed",
  dimOut = 512,
  dimIn = 256
): Float32Array {
  const keyStr = typeof key === "string" ? key : Array.from(key).join(",");
  if (
    cachedMatrixKey === keyStr &&
    cachedProjectionMatrix &&
    cachedProjectionMatrix.length === dimOut * dimIn
  ) {
    return cachedProjectionMatrix;
  }

  const seed = hashKeyToSeed(key);
  const rng = mulberry32(seed);
  const matrix = new Float32Array(dimOut * dimIn);

  // Box-Muller transform for standard Gaussian N(0,1) distribution
  let i = 0;
  const total = dimOut * dimIn;
  while (i < total) {
    let u1 = rng();
    let u2 = rng();
    while (u1 <= 1e-15) u1 = rng(); // Avoid log(0)
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    matrix[i++] = z0;
    if (i < total) matrix[i++] = z1;
  }

  cachedMatrixKey = keyStr;
  cachedProjectionMatrix = matrix;
  return matrix;
}

/**
 * Projects a 256-d EdgeFace embedding into a 512-bit packed binary Biohash (Uint8Array[64]).
 */
export function computeBiohash(
  embedding: Float32Array | ArrayLike<number>,
  options: BiohashOptions = {}
): BiohashResult {
  const t0 = performance.now();
  if (!embedding || embedding.length !== 256) {
    throw new Error(
      `[Biohash] Input embedding must be non-null Float32Array of length 256 (got ${embedding?.length})`
    );
  }

  const key = options.secretKey ?? "twinframe-accuface-v4-biohash-seed";
  const matrix = getProjectionMatrix(key, 512, 256);
  const packedHash = new Uint8Array(64);

  // Perform matrix-vector projection b = R * v and sign binarization
  for (let bitIdx = 0; bitIdx < 512; bitIdx++) {
    const rowOffset = bitIdx * 256;
    let sum = 0;

    // 8-way unrolled inner dot product loop
    for (let j = 0; j < 256; j += 8) {
      sum +=
        matrix[rowOffset + j]! * (embedding[j] ?? 0) +
        matrix[rowOffset + j + 1]! * (embedding[j + 1] ?? 0) +
        matrix[rowOffset + j + 2]! * (embedding[j + 2] ?? 0) +
        matrix[rowOffset + j + 3]! * (embedding[j + 3] ?? 0) +
        matrix[rowOffset + j + 4]! * (embedding[j + 4] ?? 0) +
        matrix[rowOffset + j + 5]! * (embedding[j + 5] ?? 0) +
        matrix[rowOffset + j + 6]! * (embedding[j + 6] ?? 0) +
        matrix[rowOffset + j + 7]! * (embedding[j + 7] ?? 0);
    }

    // Sign thresholding: bit is 1 if sum >= 0, else 0
    if (sum >= 0) {
      const byteIdx = bitIdx >> 3;
      const bitPos = bitIdx & 7;
      packedHash[byteIdx]! |= 1 << bitPos;
    }
  }

  const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
  return {
    hash: packedHash,
    bitLength: 512,
    latencyMs,
  };
}

/**
 * Fast 32-bit integer SWAR popcount (Hamming weight).
 */
export function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  x = x + (x >>> 8);
  x = x + (x >>> 16);
  return x & 0x3f;
}

/**
 * Computes exact Hamming distance in bits between two 64-byte biohashes in TypeScript using SWAR popcount.
 */
export function hammingDistance64BytesTS(
  hashA: Uint8Array,
  hashB: Uint8Array
): number {
  if (hashA.length !== 64 || hashB.length !== 64) {
    throw new Error("[Biohash] Hashes must be exactly 64 bytes");
  }
  const viewA = new Uint32Array(
    hashA.buffer,
    hashA.byteOffset,
    16
  );
  const viewB = new Uint32Array(
    hashB.buffer,
    hashB.byteOffset,
    16
  );
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    dist += popcount32(viewA[i]! ^ viewB[i]!);
  }
  return dist;
}

/**
 * Build pre-compiled WebAssembly binary bytecode for native i64 popcnt candidate screening.
 */
function createPopcountWasmBytes(): Uint8Array {
  function encodeU32(val: number): number[] {
    const bytes: number[] = [];
    do {
      let b = val & 0x7f;
      val >>>= 7;
      if (val !== 0) b |= 0x80;
      bytes.push(b);
    } while (val !== 0);
    return bytes;
  }

  function makeSection(id: number, payload: number[]): number[] {
    return [id, ...encodeU32(payload.length), ...payload];
  }

  const OP = {
    local_get: 0x20,
    local_set: 0x21,
    local_tee: 0x22,
    i32_const: 0x41,
    i32_add: 0x6a,
    i32_shl: 0x74,
    i32_lt_u: 0x49,
    i32_le_u: 0x4d,
    i32_ge_u: 0x4f,
    i32_store: 0x36,
    i64_load: 0x29,
    i64_xor: 0x85,
    i64_popcnt: 0x7b,
    i32_wrap_i64: 0xa7,
    block: 0x02,
    loop: 0x03,
    if: 0x04,
    end: 0x0b,
    br: 0x0c,
    br_if: 0x0d,
  };

  // Function signature: screen_catalog(qPtr, cPtr, count, maxDist, outIdxPtr, outDstPtr) -> matchCount
  const localDecl = [1, 5, 0x7f]; // 5 i32 locals: 6:i, 7:matchCnt, 8:cOff, 9:dist, 10:j

  const code = [
    ...localDecl,
    OP.i32_const, 0, OP.local_set, 6, // i = 0
    OP.i32_const, 0, OP.local_set, 7, // matchCnt = 0
    OP.block, 0x40,
      OP.loop, 0x40,
        OP.local_get, 6, OP.local_get, 2, OP.i32_ge_u, OP.br_if, 1, // break if i >= count
        // cOff = cPtr + (i << 6)
        OP.local_get, 1, OP.local_get, 6, OP.i32_const, 6, OP.i32_shl, OP.i32_add, OP.local_set, 8,
        OP.i32_const, 0, OP.local_set, 9, // dist = 0
        OP.i32_const, 0, OP.local_set, 10, // j = 0
        OP.loop, 0x40,
          OP.local_get, 9,
          OP.local_get, 0, OP.local_get, 10, OP.i32_const, 3, OP.i32_shl, OP.i32_add, OP.i64_load, 3, 0,
          OP.local_get, 8, OP.local_get, 10, OP.i32_const, 3, OP.i32_shl, OP.i32_add, OP.i64_load, 3, 0,
          OP.i64_xor, OP.i64_popcnt, OP.i32_wrap_i64, OP.i32_add, OP.local_set, 9,
          OP.local_get, 10, OP.i32_const, 1, OP.i32_add, OP.local_tee, 10,
          OP.i32_const, 8, OP.i32_lt_u, OP.br_if, 0,
        OP.end,
        OP.local_get, 9, OP.local_get, 3, OP.i32_le_u,
        OP.if, 0x40,
          OP.local_get, 4, OP.local_get, 7, OP.i32_const, 2, OP.i32_shl, OP.i32_add, OP.local_get, 6, OP.i32_store, 2, 0,
          OP.local_get, 5, OP.local_get, 7, OP.i32_const, 2, OP.i32_shl, OP.i32_add, OP.local_get, 9, OP.i32_store, 2, 0,
          OP.local_get, 7, OP.i32_const, 1, OP.i32_add, OP.local_set, 7,
        OP.end,
        OP.local_get, 6, OP.i32_const, 1, OP.i32_add, OP.local_set, 6,
        OP.br, 0,
      OP.end,
    OP.end,
    OP.local_get, 7, OP.end,
  ];

  const funcBody = [...encodeU32(code.length), ...code];
  const codeSection = makeSection(10, [1, ...funcBody]);
  const typeSection = makeSection(1, [1, 0x60, 6, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f]);
  const funcSection = makeSection(3, [1, 0]);
  const memSection = makeSection(5, [1, 0, 1]);

  const memName = Array.from(new TextEncoder().encode("memory"));
  const fnName = Array.from(new TextEncoder().encode("screen_catalog"));
  const exportMem = [memName.length, ...memName, 2, 0];
  const exportFn = [fnName.length, ...fnName, 0, 0];
  const exportSection = makeSection(7, [2, ...exportMem, ...exportFn]);

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
  ]);
}

let wasmInstancePromise: Promise<WebAssembly.Instance | null> | null = null;

export async function getPopcountWasmInstance(): Promise<WebAssembly.Instance | null> {
  if (typeof WebAssembly === "undefined") return null;
  if (!wasmInstancePromise) {
    wasmInstancePromise = (async () => {
      try {
        const bytes = createPopcountWasmBytes();
        const module = await WebAssembly.compile(bytes.buffer as ArrayBuffer);
        return await WebAssembly.instantiate(module, {});
      } catch (err) {
        console.warn(
          "[Biohash] WASM popcount module initialization failed; using TypeScript fallback:",
          err
        );
        return null;
      }
    })();
  }
  return wasmInstancePromise;
}

/**
 * Screens catalog biohashes against a query biohash, filtering candidates by Hamming distance.
 */
export async function screenBiohashCandidates(
  queryHash: Uint8Array,
  catalogHashes: Uint8Array,
  catalogCount: number,
  options: BiohashCandidateScreeningOptions = {}
): Promise<BiohashScreeningResult> {
  const t0 = performance.now();
  const maxDist = options.maxHammingDistance ?? 200;
  const topM = options.topM ?? 100;
  const minCandidates = options.minCandidates ?? 20;

  if (queryHash.length !== 64) {
    throw new Error("[Biohash] Query hash must be 64 bytes");
  }
  if (catalogHashes.length !== catalogCount * 64) {
    throw new Error(
      `[Biohash] Catalog buffer length mismatch: expected ${
        catalogCount * 64
      }, got ${catalogHashes.length}`
    );
  }

  const wasmInstance = options.forceTS ? null : await getPopcountWasmInstance();
  let rawCandidates: BiohashScreeningCandidate[] = [];
  let providerUsed: "wasm" | "typescript" = "typescript";

  if (wasmInstance && wasmInstance.exports.screen_catalog) {
    providerUsed = "wasm";
    const mem = wasmInstance.exports.memory as WebAssembly.Memory;
    const requiredBytes = 64 + catalogCount * 64 + catalogCount * 4 * 2;
    const pagesNeeded = Math.ceil(requiredBytes / 65536);
    const currentPages = mem.buffer.byteLength / 65536;
    if (pagesNeeded > currentPages) {
      mem.grow(pagesNeeded - currentPages);
    }

    const heap = new Uint8Array(mem.buffer);
    const qPtr = 0;
    const cPtr = 64;
    const outIdxPtr = cPtr + catalogCount * 64;
    const outDstPtr = outIdxPtr + catalogCount * 4;

    heap.set(queryHash, qPtr);
    heap.set(catalogHashes, cPtr);

    const screenFn = wasmInstance.exports.screen_catalog as (
      qPtr: number,
      cPtr: number,
      count: number,
      maxDist: number,
      outIdxPtr: number,
      outDstPtr: number
    ) => number;

    const matchCount = screenFn(
      qPtr,
      cPtr,
      catalogCount,
      maxDist,
      outIdxPtr,
      outDstPtr
    );

    const indices = new Uint32Array(mem.buffer, outIdxPtr, matchCount);
    const dists = new Uint32Array(mem.buffer, outDstPtr, matchCount);

    rawCandidates = new Array(matchCount);
    for (let i = 0; i < matchCount; i++) {
      const idx = indices[i]!;
      const d = dists[i]!;
      rawCandidates[i] = {
        index: idx,
        hammingDistance: d,
        normalizedDistance: d / 512,
      };
    }
  } else {
    providerUsed = "typescript";
    rawCandidates = [];
    for (let i = 0; i < catalogCount; i++) {
      const off = i * 64;
      const candidateHash = catalogHashes.subarray(off, off + 64);
      const dist = hammingDistance64BytesTS(queryHash, candidateHash);
      if (dist <= maxDist) {
        rawCandidates.push({
          index: i,
          hammingDistance: dist,
          normalizedDistance: dist / 512,
        });
      }
    }
  }

  // Soft fallback: If fewer than minCandidates pass cutoff, evaluate all candidates and select top M by distance
  if (rawCandidates.length < minCandidates && catalogCount > 0) {
    const allCandidates: BiohashScreeningCandidate[] = new Array(catalogCount);
    for (let i = 0; i < catalogCount; i++) {
      const off = i * 64;
      const candidateHash = catalogHashes.subarray(off, off + 64);
      const dist = hammingDistance64BytesTS(queryHash, candidateHash);
      allCandidates[i] = {
        index: i,
        hammingDistance: dist,
        normalizedDistance: dist / 512,
      };
    }
    allCandidates.sort((a, b) => a.hammingDistance - b.hammingDistance);
    rawCandidates = allCandidates.slice(0, topM);
  } else {
    rawCandidates.sort((a, b) => a.hammingDistance - b.hammingDistance);
    if (rawCandidates.length > topM) {
      rawCandidates = rawCandidates.slice(0, topM);
    }
  }

  const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
  return {
    candidates: rawCandidates,
    totalEvaluated: catalogCount,
    passedCount: rawCandidates.length,
    latencyMs,
    providerUsed,
  };
}
