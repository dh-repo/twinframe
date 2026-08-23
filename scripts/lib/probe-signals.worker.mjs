/**
 * Process-pool worker: detect → hard-probe signals → optional EdgeFace embed.
 * ONNX loads in this process only, so the parent harness stays model-free.
 *
 * Job payload: { filePath: string, embed?: boolean }
 */
import { analyzeProbeImage } from "./probe-signals.mjs";

process.send?.({ type: "ready" });

process.on("message", async (msg) => {
  if (!msg || msg.type !== "job") return;
  const filePath = msg.payload?.filePath;
  if (typeof filePath !== "string") {
    process.send?.({ type: "result", id: msg.id, ok: false, error: "missing filePath" });
    return;
  }
  try {
    const value = await analyzeProbeImage(filePath, { embed: msg.payload.embed !== false });
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
