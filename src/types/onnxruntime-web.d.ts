declare module "onnxruntime-web" {
  export namespace env {
    namespace wasm {
      let wasmPaths: string | Record<string, string>;
      let numThreads: number;
      let simd: boolean;
    }
    let logLevel: "verbose" | "info" | "warning" | "error" | "fatal";
  }

  export namespace InferenceSession {
    export interface SessionOptions {
      executionProviders?: (string | Record<string, unknown>)[];
      graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
      [key: string]: unknown;
    }
    export type Feeds = Record<string, Tensor>;
    export type Fetches = Record<string, Tensor>;

    export function create(
      modelPathOrBuffer: string | ArrayBuffer | Uint8Array,
      options?: SessionOptions
    ): Promise<InferenceSession>;
  }

  export interface InferenceSession {
    run(feeds: InferenceSession.Feeds): Promise<InferenceSession.Fetches>;
    release(): Promise<void>;
  }

  export class Tensor {
    constructor(
      type: "float32" | "int32" | "uint8" | "bool" | "string" | "float16",
      data: Float32Array | Int32Array | Uint8Array | boolean[] | string[] | ArrayLike<number>,
      dims?: readonly number[]
    );
    readonly type: string;
    readonly data: Float32Array | Int32Array | Uint8Array | boolean[] | string[] | ArrayLike<number>;
    readonly dims: readonly number[];
  }
}
