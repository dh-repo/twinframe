/**
 * Test-only worker: echoes payload.n * 2 after a short delay.
 * Optional payload.fail / payload.crash for error paths.
 */
process.send?.({ type: "ready" });

process.on("message", (msg) => {
  if (!msg || msg.type !== "job") return;
  const payload = msg.payload ?? {};
  if (payload.crash) {
    process.exit(2);
  }
  setTimeout(() => {
    if (payload.fail) {
      process.send?.({ type: "result", id: msg.id, ok: false, error: "fixture-fail" });
      return;
    }
    process.send?.({
      type: "result",
      id: msg.id,
      ok: true,
      value: { n: payload.n * 2, pid: process.pid },
    });
  }, payload.delayMs ?? 25);
});
