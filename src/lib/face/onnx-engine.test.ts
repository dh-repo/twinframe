import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initOnnxEngine,
  resetOnnxEngineState,
  getExecutionProviders,
  probeHardwareCapabilities,
  OnnxSessionManager,
  prefetchModelUrl,
  markModelUrlUnavailable,
  isModelKnownUnavailable,
  resetUnavailableModelCache,
} from "./onnx-engine.ts";
import * as ort from "onnxruntime-web";

describe("onnx-engine: Environment Initialization", () => {
  beforeEach(() => {
    resetOnnxEngineState();
  });

  it("configures wasmPaths to /models/ort/", () => {
    initOnnxEngine();
    assert.ok(
      ort.env.wasm.wasmPaths === "/models/ort/" ||
        (typeof ort.env.wasm.wasmPaths === "object" &&
          (ort.env.wasm.wasmPaths as any).wasm?.includes("/models/ort/"))
    );
  });

  it("falls back to 1 thread when crossOriginIsolated is false or undefined", () => {
    const origIsolated = (globalThis as any).crossOriginIsolated;
    (globalThis as any).crossOriginIsolated = false;
    resetOnnxEngineState();
    initOnnxEngine();
    assert.equal(ort.env.wasm.numThreads, 1);
    (globalThis as any).crossOriginIsolated = origIsolated;
  });

  it("stays single-threaded even when crossOriginIsolated is true", () => {
    // Pinned after a throttled A/B measured multi-threaded WASM slower; the
    // pin holds regardless of isolation until quiet-hardware or real-device
    // benchmarks justify re-enabling threads (see onnx-engine.ts comment).
    const origIsolated = (globalThis as any).crossOriginIsolated;
    (globalThis as any).crossOriginIsolated = true;
    resetOnnxEngineState();
    initOnnxEngine();
    assert.equal(ort.env.wasm.numThreads, 1);
    (globalThis as any).crossOriginIsolated = origIsolated;
  });

  it("returns execution providers prioritized as webgpu then wasm", () => {
    const eps = getExecutionProviders();
    assert.deepEqual(eps, ["webgpu", "wasm"]);
  });
});

describe("onnx-engine: probeHardwareCapabilities", () => {
  beforeEach(() => {
    resetOnnxEngineState();
  });

  it("detects WASM SIMD capability and measures non-negative warmup latency", async () => {
    const caps = await probeHardwareCapabilities();
    assert.equal(typeof caps.wasmSimdSupported, "boolean");
    assert.ok(caps.warmupLatencyMs >= 0);
    assert.equal(typeof caps.webgpuAvailable, "boolean");
    assert.equal(typeof caps.numThreads, "number");
  });

  it("correctly identifies WebGPU features when navigator.gpu is mocked", async () => {
    const origNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const mockNav = {
      gpu: {
        requestAdapter: async () => ({
          features: new Set(["shader-f16"]),
          requestAdapterInfo: async () => ({ vendor: "MockGPU", device: "v1.0", architecture: "WGSL" }),
        }),
      },
    };

    Object.defineProperty(globalThis, "navigator", {
      value: mockNav,
      configurable: true,
      writable: true,
    });

    const caps = await probeHardwareCapabilities();
    assert.equal(caps.webgpuAvailable, true);
    assert.equal(caps.fp16Supported, true);
    assert.equal(caps.activeExecutionProvider, "webgpu");
    assert.equal(caps.adapterInfo?.vendor, "MockGPU");
    assert.equal(caps.adapterInfo?.architecture, "WGSL");

    if (origNav) {
      Object.defineProperty(globalThis, "navigator", origNav);
    }
  });
});

describe("onnx-engine: OnnxSessionManager", () => {
  it("instantiates singleton instance and manages session cache lifecycle", async () => {
    const manager = OnnxSessionManager.getInstance();
    assert.ok(manager);
    const sameManager = OnnxSessionManager.getInstance();
    assert.strictEqual(manager, sameManager);
    await manager.disposeAll();
  });

  it("coalesces concurrent getSession calls for the same key", async () => {
    const manager = OnnxSessionManager.getInstance();
    await manager.disposeAll();
    let creates = 0;
    const origCreate = ort.InferenceSession.create;
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const fake = { release: async () => {} };
    ort.InferenceSession.create = (async () => {
      creates += 1;
      await gate;
      return fake as never;
    }) as typeof origCreate;
    try {
      const buffer = new Uint8Array([1, 2, 3, 4]);
      const a = manager.getSession("coalesce-key", buffer);
      const b = manager.getSession("coalesce-key", buffer);
      releaseGate?.();
      const [sa, sb] = await Promise.all([a, b]);
      assert.strictEqual(sa, sb);
      assert.equal(creates, 1);
      assert.equal(manager.hasSession("coalesce-key"), true);
      assert.equal(manager.sessionCount(), 1);
    } finally {
      ort.InferenceSession.create = origCreate;
      await manager.disposeAll();
    }
  });
});

describe("onnx-engine: prefetch / 404 cache", () => {
  beforeEach(() => {
    resetUnavailableModelCache();
  });

  it("negative-caches 404 HEAD and skips later prefetch", async () => {
    const origFetch = globalThis.fetch;
    let heads = 0;
    globalThis.fetch = (async () => {
      heads += 1;
      return { status: 404 } as Response;
    }) as typeof fetch;
    try {
      assert.equal(await prefetchModelUrl("/models/missing.onnx"), false);
      assert.equal(isModelKnownUnavailable("/models/missing.onnx"), true);
      assert.equal(await prefetchModelUrl("/models/missing.onnx"), false);
      assert.equal(heads, 1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("treats 200 HEAD as available", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ status: 200 }) as Response) as typeof fetch;
    try {
      assert.equal(await prefetchModelUrl("/models/adaface_ir101_webface12m.fp16.onnx"), true);
      assert.equal(isModelKnownUnavailable("/models/adaface_ir101_webface12m.fp16.onnx"), false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("markModelUrlUnavailable is honored by prefetch without fetching", async () => {
    markModelUrlUnavailable("/models/adaface_ir101_webface12m.int8.onnx");
    const origFetch = globalThis.fetch;
    let heads = 0;
    globalThis.fetch = (async () => {
      heads += 1;
      return { status: 200 } as Response;
    }) as typeof fetch;
    try {
      assert.equal(await prefetchModelUrl("/models/adaface_ir101_webface12m.int8.onnx"), false);
      assert.equal(heads, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
