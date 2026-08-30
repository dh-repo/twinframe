import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const MODEL_URL =
  "https://huggingface.co/Evn9172/cvlface_adaface_ir101_webface12m_onnx/resolve/main/adaface_ir101.onnx";

export const FP32_PATH = path.resolve("public/models/adaface_ir101_webface12m.onnx");
export const FP16_PATH = path.resolve("public/models/adaface_ir101_webface12m.fp16.onnx");
export const INT8_PATH = path.resolve("public/models/adaface_ir101_webface12m.int8.onnx");
export const MIN_FP32_BYTES = 50 * 1024 * 1024;
export const MIN_FAST_BYTES = 20 * 1024 * 1024;
export const QUANTIZE_SCRIPT = path.resolve("scripts/quantize_adaface.py");

export function isPresentAndSized(modelPath, minBytes) {
  try {
    return fs.statSync(modelPath).size >= minBytes;
  } catch {
    return false;
  }
}

export async function downloadFp32(url = MODEL_URL, dest = FP32_PATH) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmpPath = `${dest}.download`;
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const fileStream = fs.createWriteStream(tmpPath);
  await pipeline(res.body, fileStream);
  fs.renameSync(tmpPath, dest);
}

function pythonHas(mods) {
  const r = spawnSync("python3", ["-c", `import ${mods}`], { encoding: "utf8" });
  return r.status === 0;
}

export function ensureQuantizePython() {
  if (pythonHas("onnx, onnxruntime, onnxconverter_common, PIL, numpy")) return true;
  const r = spawnSync(
    "python3",
    ["-m", "pip", "install", "--user", "--quiet", "onnxruntime", "onnx", "onnxconverter-common", "pillow", "numpy"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.warn(`[Face Model] pip install quantize deps failed: ${r.stderr || r.stdout}`);
    return false;
  }
  return pythonHas("onnx, onnxruntime, onnxconverter_common, PIL, numpy");
}

export function generateFastModels({ int8 = false, force = false } = {}) {
  if (!isPresentAndSized(FP32_PATH, MIN_FP32_BYTES)) {
    throw new Error("fp32 AdaFace missing; download first");
  }
  if (!ensureQuantizePython()) {
    throw new Error("python onnxruntime/onnxconverter_common unavailable");
  }
  const args = [
    QUANTIZE_SCRIPT,
    "--input",
    FP32_PATH,
    "--fp16-output",
    FP16_PATH,
    "--int8-output",
    INT8_PATH,
    "--calib-dir",
    path.resolve("public/celebs"),
  ];
  if (int8) args.push("--int8");
  if (force) args.push("--force");
  const r = spawnSync("python3", args, { encoding: "utf8", stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`quantize_adaface.py exited ${r.status}`);
  }
}

export async function ensureFaceModels({ int8 = false } = {}) {
  if (isPresentAndSized(FP32_PATH, MIN_FP32_BYTES)) {
    console.log(`[Face Model] ${FP32_PATH} already present, skipping download.`);
  } else {
    console.log("[Face Model] Fetching AdaFace IR-101 model from Hugging Face...");
    try {
      await downloadFp32();
      const bytes = fs.statSync(FP32_PATH).size;
      console.log(`[Face Model] Downloaded ${FP32_PATH} (${Math.round(bytes / 1024 / 1024)}MB).`);
    } catch (err) {
      console.warn(
        `[Face Model] Could not download the AdaFace model: ${err instanceof Error ? err.message : err}`,
      );
      console.warn(
        "[Face Model] The deployed app will fall back to the slow legacy detector on every analysis until this is resolved.",
      );
      return { fp32: false, fp16: false, int8: false };
    }
  }

  try {
    generateFastModels({ int8 });
  } catch (err) {
    console.warn(
      `[Face Model] Fast-path compress failed: ${err instanceof Error ? err.message : err}`,
    );
    console.warn("[Face Model] Runtime will lazy-load fp32 AdaFace IR-101.");
  }

  return {
    fp32: isPresentAndSized(FP32_PATH, MIN_FP32_BYTES),
    fp16: isPresentAndSized(FP16_PATH, MIN_FAST_BYTES),
    int8: isPresentAndSized(INT8_PATH, 8 * 1024 * 1024),
  };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) {
  const wantInt8 = process.argv.includes("--int8");
  await ensureFaceModels({ int8: wantInt8 });
}
