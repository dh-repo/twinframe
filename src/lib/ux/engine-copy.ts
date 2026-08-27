export const EMBEDDER_LABEL = "AdaFace IR-101";
export const DETECTOR_LABEL = "SCRFD-2.5G";
export const EMBEDDER_DIM = "512-d";

export const SHARE_ENGINE_STAMP = "MATCHED ON-DEVICE WITH ADAFACE IR-101 512-D";

export const BANNED_USER_FACING_ENGINE = /\b(EdgeFace|Anti-GAN|Biohash)\b/i;

export function captureEngineBlurb(): string {
  return `Upload a selfie or use your camera. Instant, on-device matching with ${EMBEDDER_LABEL} & ${DETECTOR_LABEL} against`;
}

export function engineFooter(engineVersion: string): string {
  return `${EMBEDDER_LABEL} · ${DETECTOR_LABEL} · On-device engine v${engineVersion}`;
}

export function galleryLoadingCopy(): string {
  return `Loading 1,000+ ${EMBEDDER_LABEL} embeddings...`;
}

export function analyzingSteps(gallerySize: number): { label: string; detail: string }[] {
  return [
    { label: "Initializing AccuFace engine", detail: "ONNX WebGPU / WASM SIMD execution" },
    { label: "Detecting & aligning face", detail: `Picking your sharpest frames · ${DETECTOR_LABEL}` },
    {
      label: "Extracting AdaFace embedding",
      detail: `${EMBEDDER_LABEL} · ${EMBEDDER_DIM} on-device`,
    },
    {
      label: "Ranking celebrity gallery",
      detail: `${gallerySize.toLocaleString()} stars · cosine matching`,
    },
  ];
}

export const HUD_IDLE_TELEMETRY = [
  "SCRFD-2.5G FEATURE PYRAMID DETECT",
  "EXPNORM 3D UV WGSL FRONTALIZATION",
  "EXTRACTING ADAFACE IR-101 512-D",
  "COSINE RANKING ON-DEVICE",
] as const;

export function hudEmbeddingLine(ms: number | undefined): string {
  return `ADAFACE IR-101: ${ms ?? 0}ms (512-D)`;
}

export function hudRankingLine(): string {
  return "COSINE RANK: ON-DEVICE";
}

export function userFacingEngineCopy(
  gallerySize = 1000,
  engineVersion = "4.0.0-accuface",
): string {
  return [
    captureEngineBlurb(),
    engineFooter(engineVersion),
    galleryLoadingCopy(),
    SHARE_ENGINE_STAMP,
    ...analyzingSteps(gallerySize).flatMap((s) => [s.label, s.detail]),
    ...HUD_IDLE_TELEMETRY,
    hudEmbeddingLine(12),
    hudRankingLine(),
  ].join("\n");
}
