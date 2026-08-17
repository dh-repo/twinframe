import { FaceDetector } from "@mediapipe/tasks-vision";
import visionWasmLoaderUrl from "../../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js?url";
import visionWasmUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";

const MODEL_URL =
  "/models/mediapipe/blaze_face_full_range_sparse.tflite";

interface DetectRequest {
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
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

interface WorkerScope {
  onmessage: ((event: MessageEvent<DetectRequest>) => void) | null;
  postMessage(message: DetectResponse): void;
}

const workerScope = self as unknown as WorkerScope;
let detectorPromise: Promise<FaceDetector> | null = null;

function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = FaceDetector.createFromOptions(
      {
        wasmLoaderPath: visionWasmLoaderUrl,
        wasmBinaryPath: visionWasmUrl,
      },
      {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.25,
      },
    ).catch((error) => {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

workerScope.onmessage = async (event) => {
  const { id, pixels, width, height } = event.data;
  try {
    const detector = await getDetector();
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare the detection canvas.");
    }
    const imagePixels = new Uint8ClampedArray(pixels.length);
    imagePixels.set(pixels);
    context.putImageData(new ImageData(imagePixels, width, height), 0, 0);
    const result = detector.detect(canvas);
    const detections = result.detections.flatMap((detection) => {
      const box = detection.boundingBox;
      if (!box) return [];
      return [{
        x: box.originX,
        y: box.originY,
        width: box.width,
        height: box.height,
        confidence: detection.categories[0]?.score ?? 0,
      }];
    });
    workerScope.postMessage({ id, detections });
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : "Face detection failed.",
    });
  }
};
