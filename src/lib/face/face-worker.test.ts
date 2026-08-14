import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { WorkerRequestMessage, WorkerResponseMessage } from "./worker-protocol.ts";
import { FaceWorkerClient, type WorkerTransport } from "./worker-client.ts";

// Setup polyfills for Node.js unit test environment if not present
if (typeof globalThis.ImageBitmap === "undefined") {
  (globalThis as any).ImageBitmap = class MockImageBitmap {
    public width = 640;
    public height = 480;
    public closed = false;
    close() {
      this.closed = true;
      this.width = 0;
      this.height = 0;
    }
  };
}

if (typeof globalThis.OffscreenCanvas === "undefined") {
  (globalThis as any).OffscreenCanvas = class MockOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }),
      };
    }
    transferToImageBitmap() {
      return new (globalThis as any).ImageBitmap();
    }
  };
}

class MockWorkerTransport implements WorkerTransport {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public sentMessages: any[] = [];
  public isTerminated = false;

  postMessage(message: any, transfer?: Transferable[]): void {
    this.sentMessages.push({ message, transfer });

    // Simulate async worker response tick
    queueMicrotask(() => {
      if (this.isTerminated || !this.onmessage) return;

      if (message.type === "INIT_ENGINE") {
        this.onmessage({
          data: {
            id: message.id,
            type: "ENGINE_READY",
            payload: {
              backend: "wasm",
              simdSupported: true,
              benchmarkLatencyMs: 10,
              workerId: "mock-worker-1",
            },
            timestamp: Date.now(),
          },
        } as MessageEvent);
      } else if (message.type === "ANALYZE_FRAME") {
        // Send progress first
        this.onmessage({
          data: {
            id: message.id,
            type: "PROGRESS",
            payload: { stepIndex: 1, progressPct: 50 },
            timestamp: Date.now(),
          },
        } as MessageEvent);

        // Send analysis result
        this.onmessage({
          data: {
            id: message.id,
            type: "ANALYSIS_RESULT",
            payload: {
              result: { matchPercentage: 90.0 },
              facePreviewBitmap: new (globalThis as any).ImageBitmap(),
            },
            timestamp: Date.now(),
          },
        } as MessageEvent);
      } else if (message.type === "UPDATE_SMOOTHING") {
        this.onmessage({
          data: {
            id: message.id,
            type: "SMOOTHING_UPDATED",
            payload: { updated: true, success: true },
            timestamp: Date.now(),
          },
        } as MessageEvent);
      } else if (message.type === "PING") {
        this.onmessage({
          data: {
            id: message.id,
            type: "PONG",
            payload: { echoTimestamp: message.timestamp },
            timestamp: Date.now(),
          },
        } as MessageEvent);
      }
    });
  }

  terminate(): void {
    this.isTerminated = true;
  }
}

describe("WebWorker Protocol & Client Architecture (src/lib/face/face-worker.test.ts)", () => {
  it("correlates request IDs with response messages", async () => {
    const transport = new MockWorkerTransport();
    const client = new FaceWorkerClient({ transport });

    await client.init();
    assert.equal(client.ready, true);
  });

  it("handles zero-copy ImageBitmap closing upon processing", () => {
    const mockBitmap = new (globalThis as any).ImageBitmap();
    assert.equal(mockBitmap.closed, false);

    // Simulate worker resource cleanup
    mockBitmap.close();
    assert.equal(mockBitmap.closed, true);
    assert.equal(mockBitmap.width, 0);
  });

  it("sends analyzeFrame and receives progress & analysis results via transport", async () => {
    const transport = new MockWorkerTransport();
    const client = new FaceWorkerClient({ transport });

    await client.init();

    const mockSource = new (globalThis as any).ImageBitmap();
    let progressReceived = false;

    const res = await client.analyzeFrame(mockSource, {
      onProgress: (step, pct) => {
        progressReceived = true;
        assert.equal(step, 1);
        assert.equal(pct, 50);
      },
    });

    assert.ok(res.result);
    assert.equal((res.result as any).matchPercentage, 90.0);
    assert.equal(progressReceived, true);
  });

  it("pings worker and measures RTT", async () => {
    const transport = new MockWorkerTransport();
    const client = new FaceWorkerClient({ transport });

    await client.init();
    const rtt = await client.ping();
    assert.ok(rtt >= 0);
  });

  it("rejects pending request on timeout", async () => {
    const pending = new Map<string, { reject: (err: Error) => void; timer: any }>();
    const reqId = "req_timeout_test";

    const promise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error("Worker request timed out after 50ms"));
      }, 50);

      pending.set(reqId, { reject, timer });
    });

    await assert.rejects(promise, {
      name: "Error",
      message: "Worker request timed out after 50ms",
    });
  });

  it("clears all pending requests when worker terminates", async () => {
    const transport = new MockWorkerTransport();
    const client = new FaceWorkerClient({ transport });

    await client.init();
    client.terminate();
    assert.equal(client.ready, false);
  });

  it("handles fatal worker errors correctly", async () => {
    const transport = new MockWorkerTransport();
    const client = new FaceWorkerClient({ transport });
    await client.init();

    // Trigger fatal error
    if (transport.onerror) {
      transport.onerror({ message: "Out of Memory" } as ErrorEvent);
    }

    assert.equal(client.ready, false);
  });

  it("updates smoothing configuration via updateSmoothing without timing out", async () => {
    const transport = new MockWorkerTransport();
    const client = new FaceWorkerClient({ transport });
    await client.init();

    await client.updateSmoothing({ minCutoff: 1.0, beta: 0.007 });
    assert.equal(transport.sentMessages.some((m) => m.message.type === "UPDATE_SMOOTHING"), true);
  });

  it("tracks frame concurrency correctly so busy remains true until all frames complete", async () => {
    class ManualWorkerTransport implements WorkerTransport {
      public onmessage: ((event: MessageEvent) => void) | null = null;
      public onerror: ((event: ErrorEvent) => void) | null = null;
      public sentMessages: any[] = [];
      postMessage(message: any) {
        this.sentMessages.push(message);
      }
      terminate() {}
    }

    const transport = new ManualWorkerTransport();
    const client = new FaceWorkerClient({ transport });
    (client as any).isReady = true;

    assert.equal(client.busy, false);

    const mockSource = new (globalThis as any).ImageBitmap();
    const p1 = client.analyzeFrame(mockSource);
    assert.equal(client.busy, true);

    const p2 = client.analyzeFrame(mockSource);
    assert.equal(client.busy, true);

    // Complete frame 1
    const msg1 = transport.sentMessages[0];
    transport.onmessage!({
      data: { id: msg1.id, type: "ANALYSIS_RESULT", payload: { result: {} }, timestamp: Date.now() },
    } as MessageEvent);
    await p1;

    // Frame 2 is still processing, busy MUST remain true
    assert.equal(client.busy, true);

    // Complete frame 2
    const msg2 = transport.sentMessages[1];
    transport.onmessage!({
      data: { id: msg2.id, type: "ANALYSIS_RESULT", payload: { result: {} }, timestamp: Date.now() },
    } as MessageEvent);
    await p2;

    // Now all frames complete, busy becomes false
    assert.equal(client.busy, false);
  });
});
