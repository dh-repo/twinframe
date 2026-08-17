import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initOnnxEngine,
  resetOnnxEngineState,
  getExecutionProviders,
  probeHardwareCapabilities,
  OnnxSessionManager,
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

  it("uses 4 threads when crossOriginIsolated is true", () => {
    const origIsolated = (globalThis as any).crossOriginIsolated;
    (globalThis as any).crossOriginIsolated = true;
    resetOnnxEngineState();
    initOnnxEngine();
    assert.equal(ort.env.wasm.numThreads, 4);
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
});
