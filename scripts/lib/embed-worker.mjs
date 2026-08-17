/**
 * Process-pool worker: detect → align → EdgeFace embed for one JPEG.
 * Loads ONNX in this process only (parent stays model-free).
 */
import { embedImageFile } from "../enroll-gallery-onnx.mjs";

process.send?.({ type: "ready" });

process.on("message", async (msg) => {
  if (!msg || msg.type !== "job") return;
  const filePath = msg.payload?.filePath;
  if (typeof filePath !== "string") {
    process.send?.({ type: "result", id: msg.id, ok: false, error: "missing filePath" });
    return;
  }
  try {
    const value = await embedImageFile(filePath);
    process.send?.({ type: "result", id: msg.id, ok: true, value });
  } catch (err) {
    process.send?.({
      type: "result",
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
