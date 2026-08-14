import type { FaceTelemetry, MatchResult } from "./types";

export type WorkerRequestType =
  | "INIT_ENGINE"
  | "ANALYZE_FRAME"
  | "UPDATE_SMOOTHING"
  | "PING"
  | "TERMINATE";

export type WorkerResponseType =
  | "ENGINE_READY"
  | "PROGRESS"
  | "ANALYSIS_RESULT"
  | "SMOOTHING_UPDATED"
  | "PONG"
  | "ERROR";

export interface InitEnginePayload {
  preferredBackend?: "webgpu" | "wasm";
  modelBaseUrl?: string;
  enableSIMD?: boolean;
}

export interface AnalyzeFramePayload {
  bitmap: ImageBitmap;
  topK?: number;
  selectedCandidateIndex?: number;
  selectedBox?: { x: number; y: number; width: number; height: number };
  smoothLandmarks?: boolean;
  timestampSec?: number;
}

export interface UpdateSmoothingPayload {
  minCutoff?: number;
  beta?: number;
  derCutoff?: number;
}

export interface EngineReadyPayload {
  backend: "webgpu" | "wasm";
  simdSupported: boolean;
  benchmarkLatencyMs: number;
  workerId: string;
}

export interface ProgressPayload {
  stepIndex: number;
  progressPct: number;
  details?: {
    normalizedBox?: { x: number; y: number; width: number; height: number };
    normalizedLandmarks?: { x: number; y: number }[];
    candidateBoxes?: Array<{ x: number; y: number; width: number; height: number; isPrimary: boolean }>;
    telemetry?: FaceTelemetry;
  };
}

export interface AnalysisResultPayload {
  result: MatchResult;
  facePreviewBitmap?: ImageBitmap;
}

export interface ErrorPayload {
  message: string;
  code: string;
  stack?: string;
}

export type WorkerRequestMessage =
  | { id: string; type: "INIT_ENGINE"; payload: InitEnginePayload; timestamp: number }
  | { id: string; type: "ANALYZE_FRAME"; payload: AnalyzeFramePayload; timestamp: number }
  | { id: string; type: "UPDATE_SMOOTHING"; payload: UpdateSmoothingPayload; timestamp: number }
  | { id: string; type: "PING"; payload?: Record<string, unknown>; timestamp: number }
  | { id: string; type: "TERMINATE"; payload?: Record<string, unknown>; timestamp: number };

export type WorkerResponseMessage =
  | { id: string; type: "ENGINE_READY"; payload: EngineReadyPayload; timestamp: number }
  | { id: string; type: "PROGRESS"; payload: ProgressPayload; timestamp: number }
  | { id: string; type: "ANALYSIS_RESULT"; payload: AnalysisResultPayload; timestamp: number }
  | { id: string; type: "SMOOTHING_UPDATED"; payload: { updated: boolean; success: boolean }; timestamp: number }
  | { id: string; type: "PONG"; payload: { echoTimestamp: number }; timestamp: number }
  | { id: string; type: "ERROR"; payload: ErrorPayload; timestamp: number };
