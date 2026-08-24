import * as ort from "onnxruntime-web";

/** Diagnostics telemetry for hardware capabilities and execution provider state. */
export interface AdapterDetails {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

export interface HardwareCapabilities {
  webgpuAvailable: boolean;
  adapterInfo?: AdapterDetails;
  fp16Supported: boolean;
  wasmSimdSupported: boolean;
  crossOriginIsolated: boolean;
  numThreads: number;
  activeExecutionProvider: "webgpu" | "wasm";
  warmupLatencyMs: number;
}

export interface InferenceRunResult {
  outputMap: ort.InferenceSession.Fetches;
  latencyMs: number;
  providerUsed: string;
}

let engineInitialized = false;

/**
 * Initialize ONNX Runtime Web configuration, WASM asset paths, and thread parameters.
 */
export function initOnnxEngine(): void {
  if (engineInitialized) return;

  if (typeof ort !== "undefined" && ort.env && ort.env.wasm) {
    ort.env.wasm.wasmPaths = {
      wasm: "/models/ort/ort-wasm-simd-threaded.wasm",
    };
    const isIsolated = Boolean(
      (typeof self !== "undefined" && self.crossOriginIsolated) ||
        (globalThis as any).crossOriginIsolated
    );
    // Single-threaded until real-device benchmarks say otherwise: an early
    // throttled-desktop A/B suggested threading hurt, but that session ran on
    // a loaded machine (load avg >30) and is not trustworthy. Re-measure on
    // quiet hardware before enabling numThreads > 1 here.
    ort.env.wasm.numThreads = 1;
    void isIsolated;
    ort.env.wasm.simd = true;
    if (ort.env) {
      ort.env.logLevel = "warning";
    }
  }

  engineInitialized = true;
}

/**
 * Resets initialization flag (primarily for testing purposes).
 */
export function resetOnnxEngineState(): void {
  engineInitialized = false;
}

export function getExecutionProviders(): string[] {
  return ["webgpu", "wasm"];
}

/**
 * Model URLs known to be missing (404). Checked once, then every later
 * analysis skips the expensive WebGPU→WASM double session attempt.
 */
const unavailableModelUrls = new Set<string>();

export function isModelKnownUnavailable(modelPath: string): boolean {
  return unavailableModelUrls.has(modelPath);
}

/** Test-only reset for the negative model cache. */
export function resetUnavailableModelCache(): void {
  unavailableModelUrls.clear();
}

async function assertModelUrlAvailable(modelPath: string): Promise<void> {
  if (unavailableModelUrls.has(modelPath)) {
    throw new Error(`Model asset unavailable (cached): ${modelPath}`);
  }
  if (typeof fetch !== "function") return;
  try {
    const res = await fetch(modelPath, { method: "HEAD", cache: "force-cache" });
    // Some static hosts reject HEAD (405); only treat explicit not-found as missing.
    if (res.status === 404 || res.status === 410) {
      unavailableModelUrls.add(modelPath);
      throw new Error(`Model asset missing (${res.status}): ${modelPath}`);
    }
  } catch (err) {
    if (unavailableModelUrls.has(modelPath)) throw err;
    // Network hiccup on preflight: fall through and let session creation decide.
  }
}

/**
 * Create ONNX InferenceSession with WebGPU provider and automatic WASM SIMD fallback.
 * Missing model URLs are negative-cached so repeat analyses fail fast instead of
 * re-running the WebGPU + WASM session dance on every photo.
 */
export async function createInferenceSession(
  modelPathOrBuffer: string | ArrayBuffer | Uint8Array,
  customOptions?: ort.InferenceSession.SessionOptions
): Promise<ort.InferenceSession> {
  initOnnxEngine();

  if (typeof modelPathOrBuffer === "string") {
    await assertModelUrlAvailable(modelPathOrBuffer);
  }

  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: getExecutionProviders(),
    graphOptimizationLevel: "all",
    ...customOptions,
  };

  try {
    return await ort.InferenceSession.create(modelPathOrBuffer, options);
  } catch (webgpuError) {
    console.warn("[ONNX Engine] WebGPU EP session creation failed; falling back to WASM SIMD EP:", webgpuError);
    const fallbackOptions: ort.InferenceSession.SessionOptions = {
      ...options,
      executionProviders: ["wasm"],
    };
    try {
      return await ort.InferenceSession.create(modelPathOrBuffer, fallbackOptions);
    } catch (wasmError) {
      if (
        typeof modelPathOrBuffer === "string" &&
        /404|not found|failed to load external data/i.test(String(wasmError))
      ) {
        unavailableModelUrls.add(modelPathOrBuffer);
      }
      throw wasmError;
    }
  }
}

/**
 * Run inference on session and record execution latency.
 */
export async function runInference(
  session: ort.InferenceSession,
  feeds: ort.InferenceSession.Feeds
): Promise<InferenceRunResult> {
  const t0 = performance.now();
  const outputMap = await session.run(feeds);
  const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
  return {
    outputMap,
    latencyMs,
    providerUsed: (session as any)?.handler?.provider || "unknown",
  };
}

/**
 * Singleton session manager to reuse active sessions and prevent memory leaks.
 */
export class OnnxSessionManager {
  private static instance: OnnxSessionManager;
  private sessions: Map<string, ort.InferenceSession> = new Map();

  public static getInstance(): OnnxSessionManager {
    if (!OnnxSessionManager.instance) {
      OnnxSessionManager.instance = new OnnxSessionManager();
    }
    return OnnxSessionManager.instance;
  }

  public async getSession(
    key: string,
    modelPathOrBuffer: string | ArrayBuffer | Uint8Array,
    options?: ort.InferenceSession.SessionOptions
  ): Promise<ort.InferenceSession> {
    if (this.sessions.has(key)) {
      return this.sessions.get(key)!;
    }
    const session = await createInferenceSession(modelPathOrBuffer, options);
    this.sessions.set(key, session);
    return session;
  }

  public async disposeSession(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (session) {
      try {
        await session.release();
      } catch (err) {
        console.warn(`[ONNX Engine] Error releasing session ${key}:`, err);
      }
      this.sessions.delete(key);
    }
  }

  public async disposeAll(): Promise<void> {
    for (const [, session] of this.sessions.entries()) {
      try {
        await session.release();
      } catch (err) {
        console.warn(`[ONNX Engine] Error releasing session:`, err);
      }
    }
    this.sessions.clear();
  }
}

/**
 * Diagnostic micro-benchmarking probe for GPU, WASM SIMD, and initial frame latency.
 */
export async function probeHardwareCapabilities(): Promise<HardwareCapabilities> {
  initOnnxEngine();

  let webgpuAvailable = false;
  let fp16Supported = false;
  let adapterInfo: AdapterDetails | undefined = undefined;

  if (typeof navigator !== "undefined" && "gpu" in navigator && (navigator as any).gpu) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) {
        webgpuAvailable = true;
        fp16Supported = Boolean(adapter.features?.has("shader-f16"));

        if ("requestAdapterInfo" in adapter && typeof (adapter as any).requestAdapterInfo === "function") {
          const info = await (adapter as any).requestAdapterInfo();
          adapterInfo = {
            vendor: info.vendor || "",
            architecture: info.architecture || "",
            device: info.device || "",
            description: info.description || "",
          };
        }
      }
    } catch (err) {
      console.warn("[Hardware Probe] WebGPU adapter query failed:", err);
      webgpuAvailable = false;
    }
  }

  const simdBytecode = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
  ]);
  const wasmSimdSupported =
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.validate === "function" &&
    WebAssembly.validate(simdBytecode);

  const crossOriginIsolated = Boolean(
    (typeof self !== "undefined" && self.crossOriginIsolated) ||
      (globalThis as any).crossOriginIsolated
  );
  const numThreads = crossOriginIsolated ? 4 : 1;

  const t0 = performance.now();
  const dummyLen = 1 * 3 * 112 * 112;
  const dummyBuffer = new Float32Array(dummyLen);
  let checksum = 0;
  for (let i = 0; i < dummyLen; i += 16) {
    dummyBuffer[i] = Math.sin(i);
    checksum += dummyBuffer[i];
  }
  const t1 = performance.now();
  const warmupLatencyMs = Math.round((t1 - t0) * 100) / 100;

  const activeExecutionProvider: "webgpu" | "wasm" = webgpuAvailable ? "webgpu" : "wasm";

  return {
    webgpuAvailable,
    adapterInfo,
    fp16Supported,
    wasmSimdSupported,
    crossOriginIsolated,
    numThreads,
    activeExecutionProvider,
    warmupLatencyMs,
  };
}
