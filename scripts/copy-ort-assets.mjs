import fs from "node:fs";
import path from "node:path";

const srcDir = path.resolve("node_modules/onnxruntime-web/dist");
const destDir = path.resolve("public/models/ort");

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".wasm"));
  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
  console.log(`[ORT Build] Copied ${files.length} ONNX Runtime WASM assets to public/models/ort/`);
} else {
  console.warn(`[ORT Build] Source directory ${srcDir} does not exist. Skipping WASM copy.`);
}
