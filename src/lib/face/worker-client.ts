import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  InitEnginePayload,
  AnalyzeFramePayload,
  UpdateSmoothingPayload,
} from "./worker-protocol";
import type { MatchResult } from "./types";

export interface WorkerTransport {
  postMessage(message: any, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export class BrowserWorkerTransport implements WorkerTransport {
  private worker: Worker;

  constructor(workerUrlOrWorker: string | Worker) {
    if (typeof workerUrlOrWorker === "string") {
      this.worker = new Worker(workerUrlOrWorker, { type: "module" });
    } else {
      this.worker = workerUrlOrWorker;
    }
  }

  get onmessage() {
    return this.worker.onmessage;
  }
  set onmessage(fn: ((event: MessageEvent) => void) | null) {
    this.worker.onmessage = fn;
  }

  get onerror() {
    return this.worker.onerror;
  }
  set onerror(fn: ((event: ErrorEvent) => void) | null) {
    this.worker.onerror = fn;
  }

  postMessage(message: any, transfer?: Transferable[]): void {
    if (transfer && transfer.length > 0) {
      this.worker.postMessage(message, transfer);
    } else {
      this.worker.postMessage(message);
    }
  }

  terminate(): void {
    this.worker.terminate();
  }
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  onProgress?: (stepIndex: number, progressPct: number, details?: any) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

export class FaceWorkerClient {
  private transport: WorkerTransport | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private sequenceId = 0;
  private isReady = false;
  private pendingFrameCount = 0;
  private isBusy = false;

  private options: {
    workerUrl?: string;
    transport?: WorkerTransport;
  };

  constructor(
    options: {
      workerUrl?: string;
      transport?: WorkerTransport;
    } = {}
  ) {
    this.options = options;
    if (options.transport) {
      this.transport = options.transport;
      this.bindTransportEvents();
    }
  }

  public get ready(): boolean {
    return this.isReady;
  }

  public get busy(): boolean {
    return this.pendingFrameCount > 0 || this.isBusy;
  }

  public async init(
    options: { timeoutMs?: number; preferredBackend?: "webgpu" | "wasm" } = {}
  ): Promise<void> {
    if (this.isReady && this.transport) return;

    const timeoutMs = options.timeoutMs ?? 10000;

    return new Promise((resolve, reject) => {
      try {
        if (!this.transport) {
          if (typeof window === "undefined" && typeof Worker === "undefined") {
            throw new Error("WebWorker API unavailable in current environment");
          }
          const url = this.options.workerUrl ?? new URL("./face-worker.ts", import.meta.url).href;
          this.transport = new BrowserWorkerTransport(url);
          this.bindTransportEvents();
        }

        const reqId = this.generateRequestId();
        const payload: InitEnginePayload = {
          preferredBackend: options.preferredBackend ?? "webgpu",
        };

        this.sendRequest(
          {
            id: reqId,
            type: "INIT_ENGINE",
            payload,
            timestamp: Date.now(),
          },
          () => {
            this.isReady = true;
            resolve();
          },
          (err) => reject(err),
          timeoutMs
        );
      } catch (err: any) {
        reject(err);
      }
    });
  }

  public async analyzeFrame(
    source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap,
    options: {
      topK?: number;
      timeoutMs?: number;
      dropIfBusy?: boolean;
      smoothLandmarks?: boolean;
      onProgress?: (stepIndex: number, progressPct: number, details?: any) => void;
    } = {}
  ): Promise<{ result: MatchResult; facePreviewBitmap?: ImageBitmap }> {
    if (options.dropIfBusy && (this.isBusy || this.pendingFrameCount > 0)) {
      throw new Error("FRAME_DROPPED: Worker is currently processing another frame.");
    }

    if (!this.transport || !this.isReady) {
      await this.init();
    }

    let bitmap: ImageBitmap;
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      bitmap = source;
    } else if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(source as any);
    } else if ((source as any).width && (source as any).height) {
      // Fallback for mock environment if createImageBitmap does not exist
      bitmap = source as any;
    } else {
      throw new Error("Unable to create ImageBitmap from input source");
    }

    const reqId = this.generateRequestId();
    const timeoutMs = options.timeoutMs ?? 15000;

    this.pendingFrameCount++;
    this.isBusy = true;

    return new Promise((resolve, reject) => {
      const msg: WorkerRequestMessage = {
        id: reqId,
        type: "ANALYZE_FRAME",
        payload: {
          bitmap,
          topK: options.topK ?? 5,
          smoothLandmarks: options.smoothLandmarks,
        },
        timestamp: Date.now(),
      };

      const transferables: Transferable[] = [];
      if (bitmap && typeof (bitmap as any).close === "function") {
        transferables.push(bitmap);
      }

      this.sendRequest(
        msg,
        (payload) => {
          this.pendingFrameCount = Math.max(0, this.pendingFrameCount - 1);
          this.isBusy = this.pendingFrameCount > 0;
          resolve(payload);
        },
        (err) => {
          this.pendingFrameCount = Math.max(0, this.pendingFrameCount - 1);
          this.isBusy = this.pendingFrameCount > 0;
          reject(err);
        },
        timeoutMs,
        options.onProgress,
        transferables
      );
    });
  }

  public async updateSmoothing(config: UpdateSmoothingPayload, timeoutMs = 5000): Promise<void> {
    if (!this.transport || !this.isReady) {
      await this.init();
    }

    const reqId = this.generateRequestId();
    return new Promise((resolve, reject) => {
      this.sendRequest(
        {
          id: reqId,
          type: "UPDATE_SMOOTHING",
          payload: config,
          timestamp: Date.now(),
        },
        () => resolve(),
        (err) => reject(err),
        timeoutMs
      );
    });
  }

  public async ping(timeoutMs = 3000): Promise<number> {
    if (!this.transport || !this.isReady) {
      await this.init();
    }

    const reqId = this.generateRequestId();
    const now = Date.now();
    return new Promise((resolve, reject) => {
      this.sendRequest(
        {
          id: reqId,
          type: "PING",
          payload: {},
          timestamp: now,
        },
        (payload) => {
          const rtt = Date.now() - now;
          resolve(rtt);
        },
        (err) => reject(err),
        timeoutMs
      );
    });
  }

  public terminate(): void {
    if (this.transport) {
      try {
        this.transport.postMessage({ id: "term", type: "TERMINATE", timestamp: Date.now() });
      } catch (err) {
        // ignore errors on close
      }
      this.transport.terminate();
      this.transport = null;
    }
    this.isReady = false;
    this.pendingFrameCount = 0;
    this.isBusy = false;
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutTimer);
      pending.reject(new Error("FaceWorkerClient terminated"));
    }
    this.pendingRequests.clear();
  }

  private sendRequest(
    msg: WorkerRequestMessage,
    onSuccess: (payload: any) => void,
    onError: (err: Error) => void,
    timeoutMs: number,
    onProgress?: (stepIndex: number, progressPct: number, details?: any) => void,
    transfer?: Transferable[]
  ) {
    const timeoutTimer = setTimeout(() => {
      this.pendingRequests.delete(msg.id);
      onError(new Error(`Worker request '${msg.type}' (id: ${msg.id}) timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    this.pendingRequests.set(msg.id, {
      resolve: onSuccess,
      reject: onError,
      onProgress,
      timeoutTimer,
    });

    if (this.transport) {
      this.transport.postMessage(msg, transfer);
    }
  }

  private bindTransportEvents() {
    if (!this.transport) return;

    this.transport.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const msg = event.data;
      if (!msg || !msg.id) return;

      const pending = this.pendingRequests.get(msg.id);
      if (!pending) return;

      switch (msg.type) {
        case "PROGRESS": {
          pending.onProgress?.(
            msg.payload.stepIndex,
            msg.payload.progressPct,
            msg.payload.details
          );
          break;
        }
        case "ENGINE_READY":
        case "ANALYSIS_RESULT":
        case "SMOOTHING_UPDATED":
        case "PONG": {
          clearTimeout(pending.timeoutTimer);
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg.payload);
          break;
        }
        case "ERROR": {
          clearTimeout(pending.timeoutTimer);
          this.pendingRequests.delete(msg.id);
          pending.reject(new Error(msg.payload.message));
          break;
        }
      }
    };

    this.transport.onerror = (errorEvent: ErrorEvent) => {
      const err = new Error(`Worker Fatal Error: ${errorEvent?.message || "Unknown worker error"}`);
      for (const [, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timeoutTimer);
        pending.reject(err);
      }
      this.pendingRequests.clear();
      this.isReady = false;
      this.pendingFrameCount = 0;
      this.isBusy = false;
      this.transport = null;
    };
  }

  private generateRequestId(): string {
    return `req_${++this.sequenceId}_${Date.now()}`;
  }
}
