import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADAFACE_EMBED_DIM,
  ADAFACE_FAST_MAX_MEAN_COSINE_DRIFT,
  ADAFACE_FAST_PATH,
  ADAFACE_FAST_SESSION_KEY,
  ADAFACE_FAST_VARIANT,
  ADAFACE_FP16_LABEL,
  ADAFACE_FP32_SESSION_KEY,
  ADAFACE_INT8_LABEL,
  ADAFACE_INT8_LIVE,
  ADAFACE_INT8_MAX_MEAN_COSINE_DRIFT,
  ADAFACE_INT8_PATH,
  ADAFACE_INT8_SESSION_KEY,
  STUDENT_NOT_TRAINED_REASON,
  adafaceFastPathFailed,
  adafaceInt8Failed,
  embedderLabel,
  extractEdgeFaceEmbedding,
  isUsableAdafaceEmbedding,
  meanCosineDrift,
  prefetchAdafaceFastPath,
  resetAdafaceVariantState,
  rgbPlanarToAdafaceBgr,
} from "./edgeface.ts";
import {
  OnnxSessionManager,
  resetUnavailableModelCache,
} from "./onnx-engine.ts";

function mockSession(data: Float32Array | Uint16Array, provider = "wasm") {
  return {
    inputNames: ["input"],
    outputNames: ["embedding"],
    handler: { provider },
    run: async () => ({
      embedding: { data, dims: [1, data.length], type: data instanceof Uint16Array ? "float16" : "float32" },
    }),
  };
}

function unit512(seed = 1): Float32Array {
  const v = new Float32Array(ADAFACE_EMBED_DIM);
  for (let i = 0; i < v.length; i++) v[i] = ((i + seed) % 13) + 0.25;
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n);
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
  return v;
}

describe("AdaFace fast-path / INT8 fallback", () => {
  beforeEach(async () => {
    resetAdafaceVariantState();
    resetUnavailableModelCache();
    await OnnxSessionManager.getInstance().disposeAll();
  });

  it("documents why a student net was not trained and keeps INT8 off the live path", () => {
    assert.match(STUDENT_NOT_TRAINED_REASON, /WebFace12M/);
    assert.equal(ADAFACE_INT8_LIVE, false);
    assert.equal(ADAFACE_FAST_VARIANT, "fp16");
    assert.equal(embedderLabel("int8"), ADAFACE_INT8_LABEL);
    assert.equal(embedderLabel("fp16"), ADAFACE_FP16_LABEL);
    assert.doesNotMatch(embedderLabel("int8"), /EdgeFace/);
    assert.ok(ADAFACE_FAST_MAX_MEAN_COSINE_DRIFT <= 0.03);
    assert.equal(ADAFACE_INT8_MAX_MEAN_COSINE_DRIFT, ADAFACE_FAST_MAX_MEAN_COSINE_DRIFT);
  });

  it("rgbPlanarToAdafaceBgr copies and is its own inverse", () => {
    const rgb = new Float32Array(3 * 4);
    for (let i = 0; i < rgb.length; i++) rgb[i] = i + 1;
    const bgr = rgbPlanarToAdafaceBgr(rgb, 2);
    assert.notEqual(bgr, rgb);
    assert.equal(rgb[0], 1);
    const back = rgbPlanarToAdafaceBgr(bgr, 2);
    assert.deepEqual(Array.from(back), Array.from(rgb));
  });

  it("isUsableAdafaceEmbedding rejects wrong dim, zeros, and NaNs", () => {
    assert.equal(isUsableAdafaceEmbedding(unit512()), true);
    assert.equal(isUsableAdafaceEmbedding(new Float32Array(128)), false);
    assert.equal(isUsableAdafaceEmbedding(new Float32Array(512)), false);
    const nan = new Float32Array(512);
    nan[0] = Number.NaN;
    assert.equal(isUsableAdafaceEmbedding(nan), false);
  });

  it("happy path: FP16 fast model is used and fp32 is never loaded", async () => {
    const manager = OnnxSessionManager.getInstance();
    const keys: string[] = [];
    const orig = manager.getSession.bind(manager);
    manager.getSession = async (key, path) => {
      keys.push(`${key}|${path}`);
      return mockSession(unit512()) as never;
    };
    try {
      const res = await extractEdgeFaceEmbedding(new Float32Array(1 * 3 * 112 * 112).fill(0.1));
      assert.equal(res.variant, "fp16");
      assert.equal(res.embedding.length, ADAFACE_EMBED_DIM);
      assert.equal(keys.length, 1);
      assert.equal(keys[0], `${ADAFACE_FAST_SESSION_KEY}|${ADAFACE_FAST_PATH}`);
      assert.ok(!keys.some((k) => k.includes(ADAFACE_FP32_SESSION_KEY)));
    } finally {
      manager.getSession = orig;
    }
  });

  it("falls back to fp32 when the fast path session throws", async () => {
    const manager = OnnxSessionManager.getInstance();
    const orig = manager.getSession.bind(manager);
    manager.getSession = async (key) => {
      if (key === ADAFACE_FAST_SESSION_KEY) throw new Error("fp16 wasm compile failed");
      return mockSession(unit512(2)) as never;
    };
    try {
      const res = await extractEdgeFaceEmbedding(new Float32Array(1 * 3 * 112 * 112).fill(0.2));
      assert.equal(res.variant, "fp32");
      assert.equal(adafaceFastPathFailed(), true);
      assert.equal(res.embedding.length, ADAFACE_EMBED_DIM);
    } finally {
      manager.getSession = orig;
    }
  });

  it("adversarial: wrong-dim INT8 output falls back to fp32 without keeping the INT8 session", async () => {
    const manager = OnnxSessionManager.getInstance();
    const orig = manager.getSession.bind(manager);
    const origDispose = manager.disposeSession.bind(manager);
    const disposed: string[] = [];
    manager.getSession = async (key) => {
      if (key === ADAFACE_INT8_SESSION_KEY) return mockSession(new Float32Array(128)) as never;
      return mockSession(unit512(3)) as never;
    };
    manager.disposeSession = async (key) => {
      disposed.push(key);
      return origDispose(key);
    };
    try {
      const res = await extractEdgeFaceEmbedding(new Float32Array(1 * 3 * 112 * 112).fill(0.3), undefined, {
        preferInt8: true,
      });
      assert.equal(res.variant, "fp32");
      assert.equal(adafaceInt8Failed(), true);
      assert.ok(disposed.includes(ADAFACE_INT8_SESSION_KEY));
      assert.equal(manager.hasSession(ADAFACE_INT8_SESSION_KEY), false);
    } finally {
      manager.getSession = orig;
      manager.disposeSession = origDispose;
    }
  });

  it("adversarial: quality-drop zero vector from INT8 falls back", async () => {
    const manager = OnnxSessionManager.getInstance();
    const orig = manager.getSession.bind(manager);
    manager.getSession = async (key) => {
      if (key === ADAFACE_INT8_SESSION_KEY) return mockSession(new Float32Array(512)) as never;
      return mockSession(unit512(4)) as never;
    };
    try {
      const res = await extractEdgeFaceEmbedding(new Float32Array(1 * 3 * 112 * 112).fill(0.4), undefined, {
        preferInt8: true,
      });
      assert.equal(res.variant, "fp32");
      assert.equal(adafaceInt8Failed(), true);
    } finally {
      manager.getSession = orig;
    }
  });

  it("boundary: requireFast does not load fp32 when INT8 is required and fails", async () => {
    const manager = OnnxSessionManager.getInstance();
    const orig = manager.getSession.bind(manager);
    let fp32 = 0;
    manager.getSession = async (key) => {
      if (key === ADAFACE_INT8_SESSION_KEY) throw new Error("int8 missing");
      if (key === ADAFACE_FP32_SESSION_KEY) fp32 += 1;
      throw new Error("unexpected " + key);
    };
    try {
      await assert.rejects(
        () =>
          extractEdgeFaceEmbedding(new Float32Array(1 * 3 * 112 * 112).fill(0.5), undefined, {
            preferInt8: true,
            requireFast: true,
          }),
        /INT8 required|int8 missing|unusable/i,
      );
      assert.equal(fp32, 0);
    } finally {
      manager.getSession = orig;
    }
  });

  it("explicit modelPath does not try INT8 or FP16 auto keys", async () => {
    const manager = OnnxSessionManager.getInstance();
    const orig = manager.getSession.bind(manager);
    const keys: string[] = [];
    manager.getSession = async (key, path) => {
      keys.push(`${key}|${path}`);
      return mockSession(new Float32Array(256).fill(1)) as never;
    };
    try {
      const res = await extractEdgeFaceEmbedding(new Float32Array(1 * 3 * 112 * 112).fill(0.1), undefined, {
        modelPath: "/models/edgeface_m.onnx",
      });
      assert.equal(res.embedding.length, 256);
      assert.equal(keys.length, 1);
      assert.match(keys[0]!, /edgeface_m/);
      assert.ok(!keys.some((k) => k.includes(ADAFACE_INT8_PATH) || k.includes(ADAFACE_FAST_PATH)));
    } finally {
      manager.getSession = orig;
    }
  });

  it("prefetchAdafaceFastPath only HEADs the fp16 URL, never fp32 or INT8", async () => {
    const origFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return { status: 200 } as Response;
    }) as typeof fetch;
    try {
      assert.equal(await prefetchAdafaceFastPath(), true);
      assert.deepEqual(urls, [ADAFACE_FAST_PATH]);
      assert.ok(!urls.some((u) => u.includes(".int8.") || u.endsWith("webface12m.onnx")));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("prefetch 404 of the fast path skips it on the next embed", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ status: 404 }) as Response) as typeof fetch;
    try {
      assert.equal(await prefetchAdafaceFastPath(), false);
      assert.equal(adafaceFastPathFailed(), true);
      const manager = OnnxSessionManager.getInstance();
      const orig = manager.getSession.bind(manager);
      const keys: string[] = [];
      manager.getSession = async (key) => {
        keys.push(key);
        return mockSession(unit512(5)) as never;
      };
      try {
        const res = await extractEdgeFaceEmbedding(new Float32Array(1 * 3 * 112 * 112).fill(0.2));
        assert.equal(res.variant, "fp32");
        assert.deepEqual(keys, [ADAFACE_FP32_SESSION_KEY]);
      } finally {
        manager.getSession = orig;
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("preferFp32 never opens the fast or INT8 session", async () => {
    const manager = OnnxSessionManager.getInstance();
    const orig = manager.getSession.bind(manager);
    const keys: string[] = [];
    manager.getSession = async (key) => {
      keys.push(key);
      return mockSession(unit512(6)) as never;
    };
    try {
      const res = await extractEdgeFaceEmbedding(new Float32Array(1 * 3 * 112 * 112).fill(0.2), undefined, {
        preferFp32: true,
      });
      assert.equal(res.variant, "fp32");
      assert.deepEqual(keys, [ADAFACE_FP32_SESSION_KEY]);
    } finally {
      manager.getSession = orig;
    }
  });

  it("meanCosineDrift is 0 for identical unit vectors and 1 for orthogonal", () => {
    const a = unit512(1);
    assert.ok(meanCosineDrift(a, a) < 1e-6);
    const b = new Float32Array(ADAFACE_EMBED_DIM);
    b[0] = 1;
    const c = new Float32Array(ADAFACE_EMBED_DIM);
    c[1] = 1;
    assert.ok(Math.abs(meanCosineDrift(b, c) - 1) < 1e-6);
  });
});

describe("pipeline prefetch does not double-load AdaFace", () => {
  it("prefetchModel warms the FP16 fast path and never mentions the 249MB fp32 URL", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const root = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(root, "pipeline.ts"), "utf8");
    const start = src.indexOf("export function prefetchModel");
    const end = src.indexOf("export function padSourceForDetection");
    assert.ok(start >= 0 && end > start, "prefetchModel block not found");
    const block = src.slice(start, end);
    assert.match(block, /prefetchAdafaceFastPath/);
    assert.doesNotMatch(block, /adaface_ir101_webface12m\.onnx/);
    assert.doesNotMatch(block, /int8\.onnx/);
  });
});
