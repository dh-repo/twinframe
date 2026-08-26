import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

// AdaFace IR-101 exceeds GitHub's 100MB file limit, so it's gitignored and
// fetched here at build time instead. Without this step a production build
// silently ships without it: every analysis then fails the primary embedding
// pass and falls back to the slow legacy CPU detector on every single
// request (see the AccuFace/EdgeFace fallback in src/lib/face/pipeline.ts).
const MODEL_URL =
  "https://huggingface.co/Evn9172/cvlface_adaface_ir101_webface12m_onnx/resolve/main/adaface_ir101.onnx";
const MODEL_PATH = path.resolve("public/models/adaface_ir101_webface12m.onnx");
// The real model is well over 100MB; anything smaller on disk is a stale or
// partial download and must be re-fetched rather than trusted.
const MIN_EXPECTED_BYTES = 50 * 1024 * 1024;

function isPresentAndSized() {
  try {
    const stat = fs.statSync(MODEL_PATH);
    return stat.size >= MIN_EXPECTED_BYTES;
  } catch {
    return false;
  }
}

async function download() {
  fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
  const tmpPath = `${MODEL_PATH}.download`;
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const fileStream = fs.createWriteStream(tmpPath);
  await pipeline(res.body, fileStream);
  fs.renameSync(tmpPath, MODEL_PATH);
}

if (isPresentAndSized()) {
  console.log(`[Face Model] ${MODEL_PATH} already present, skipping download.`);
} else {
  console.log(`[Face Model] Fetching AdaFace IR-101 model from Hugging Face...`);
  try {
    await download();
    const bytes = fs.statSync(MODEL_PATH).size;
    console.log(`[Face Model] Downloaded ${MODEL_PATH} (${Math.round(bytes / 1024 / 1024)}MB).`);
  } catch (err) {
    // Do not fail the build on a network hiccup in a sandboxed/offline build
    // environment — but make the gap loud, since a missing model silently
    // degrades every analysis in production rather than erroring at build time.
    console.warn(
      `[Face Model] Could not download the AdaFace model: ${err instanceof Error ? err.message : err}`,
    );
    console.warn(
      `[Face Model] The deployed app will fall back to the slow legacy detector on every analysis until this is resolved.`,
    );
  }
}
