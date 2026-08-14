import util from "node:util";
if (!globalThis.util) globalThis.util = util;
if (!globalThis.util.TextEncoder) globalThis.util.TextEncoder = TextEncoder;
if (!globalThis.util.TextDecoder) globalThis.util.TextDecoder = TextDecoder;

import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
};

let ssrHtmlCache = null;

export async function setupRouteInterceptor(page) {
  const rootDir = process.cwd();
  const staticDir = join(rootDir, ".vercel", "output", "static");
  const publicDir = join(rootDir, "public");

  if (!ssrHtmlCache) {
    const funcPath = join(rootDir, ".vercel", "output", "functions", "__server.func", "index.mjs");
    if (existsSync(funcPath)) {
      try {
        const mod = await import(pathToFileURL(funcPath).href);
        const app = mod.default || mod;
        const res = await app.fetch(new Request("http://127.0.0.1:8080/"));
        ssrHtmlCache = await res.text();
      } catch (e) {
        console.warn("SSR html cache generation warning:", e);
      }
    }
  }

  await page.route("http://127.0.0.1:8080/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname.includes("tfjs-backend-wasm")) {
      return route.fulfill({ status: 200, contentType: "application/wasm", body: Buffer.from([]) });
    }

    const relPath = pathname.replace(/^\//, "");
    let filePath = join(staticDir, relPath);
    if (!existsSync(filePath)) {
      filePath = join(publicDir, relPath);
    }

    if (existsSync(filePath) && !relPath.endsWith(".html") && relPath !== "") {
      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const body = readFileSync(filePath);
      return route.fulfill({ status: 200, contentType, body });
    }

    if (ssrHtmlCache) {
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: ssrHtmlCache });
    }

    return route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
  });
}
