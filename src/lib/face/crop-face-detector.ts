const DETECTION_MAX_SIDE = 512;
const DETECTION_TIMEOUT_MS = 12_000;

export interface CropFaceCandidate {
  box: { x: number; y: number; width: number; height: number };
  normalizedBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  score: number;
  isPrimary: boolean;
}

export interface CropFaceDetectionResult {
  faces: CropFaceCandidate[];
  latencyMs: number;
}

interface WorkerDetection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

interface DetectResponse {
  id: number;
  detections?: WorkerDetection[];
  error?: string;
}

let nextRequestId = 1;

function sourceSize(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  return { width: source.width, height: source.height };
}

function scoreFace(
  box: { x: number; y: number; width: number; height: number },
  confidence: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const areaRatio =
    (box.width * box.height) / Math.max(1, imageWidth * imageHeight);
  const centerDistance = Math.hypot(
    (box.x + box.width / 2) / Math.max(1, imageWidth) - 0.5,
    (box.y + box.height / 2) / Math.max(1, imageHeight) - 0.5,
  );
  return confidence * 0.65 + Math.min(1, areaRatio * 12) * 0.25 +
    Math.max(0, 1 - centerDistance) * 0.1;
}

function mapDetections(
  detections: WorkerDetection[],
  detectionWidth: number,
  detectionHeight: number,
  originalWidth: number,
  originalHeight: number,
  scale: number,
): CropFaceCandidate[] {
  const candidates = detections.flatMap((detection) => {
    const x = Math.max(0, detection.x);
    const y = Math.max(0, detection.y);
    const width = Math.min(detectionWidth - x, detection.width);
    const height = Math.min(detectionHeight - y, detection.height);
    if (
      width < 4 ||
      height < 4 ||
      !Number.isFinite(detection.confidence) ||
      detection.confidence <= 0
    ) {
      return [];
    }

    const box = {
      x: x / scale,
      y: y / scale,
      width: width / scale,
      height: height / scale,
    };
    return [{
      box,
      normalizedBox: {
        x: (x / detectionWidth) * 100,
        y: (y / detectionHeight) * 100,
        width: (width / detectionWidth) * 100,
        height: (height / detectionHeight) * 100,
      },
      confidence: detection.confidence,
      score: scoreFace(
        box,
        detection.confidence,
        originalWidth,
        originalHeight,
      ),
      isPrimary: false,
    }];
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates.map((candidate, index) => ({
    ...candidate,
    isPrimary: index === 0,
  }));
}

function preparePixels(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  width: number,
  height: number,
): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  scale: number;
} {
  const scale = Math.min(1, DETECTION_MAX_SIDE / Math.max(width, height, 1));
  const detectionWidth = Math.max(1, Math.round(width * scale));
  const detectionHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = detectionWidth;
  canvas.height = detectionHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not prepare the image for face detection.");
  }
  context.drawImage(source, 0, 0, detectionWidth, detectionHeight);
  const pixels = context.getImageData(
    0,
    0,
    detectionWidth,
    detectionHeight,
  ).data;
  return { pixels, width: detectionWidth, height: detectionHeight, scale };
}

export async function detectCropFaces(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): Promise<CropFaceDetectionResult> {
  const startedAt = performance.now();
  const { width: originalWidth, height: originalHeight } = sourceSize(source);
  const prepared = preparePixels(source, originalWidth, originalHeight);
  const worker = new Worker(
    new URL("./crop-face-detector.worker.ts", import.meta.url),
    { type: "module" },
  );
  const id = nextRequestId++;

  try {
    const detections = await new Promise<WorkerDetection[]>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Automatic face detection took too long."));
      }, DETECTION_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<DetectResponse>) => {
        if (event.data.id !== id) return;
        window.clearTimeout(timeout);
        if (event.data.error) {
          reject(new Error(event.data.error));
          return;
        }
        resolve(event.data.detections ?? []);
      };
      worker.onerror = (event) => {
        window.clearTimeout(timeout);
        reject(new Error(event.message || "Face detector worker failed."));
      };
      worker.postMessage(
        {
          id,
          pixels: prepared.pixels,
          width: prepared.width,
          height: prepared.height,
        },
        [prepared.pixels.buffer],
      );
    });

    return {
      faces: mapDetections(
        detections,
        prepared.width,
        prepared.height,
        originalWidth,
        originalHeight,
        prepared.scale,
      ),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    worker.terminate();
  }
}
