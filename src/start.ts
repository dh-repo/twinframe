import { createStart, createMiddleware } from "@tanstack/react-start";

/**
 * Cross-origin isolation for every server response. ORT picks multi-threaded
 * WASM only when `crossOriginIsolated` is true (see onnx-engine.ts), which
 * requires these headers on the document. Static assets get the same pair via
 * nitro routeRules in vite.config.ts.
 */
const crossOriginIsolation = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = (result as { response?: Response }).response;
  if (response?.headers) {
    if (!response.headers.has("Cross-Origin-Opener-Policy")) {
      response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    }
    if (!response.headers.has("Cross-Origin-Embedder-Policy")) {
      response.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    }
  }
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [], // TEMP: isolation perf A/B
}));
