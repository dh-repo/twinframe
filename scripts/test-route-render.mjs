import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import app from "../.vercel/output/functions/__server.func/index.mjs";

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

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const rootDir = process.cwd();
  const staticDir = join(rootDir, ".vercel", "output", "static");
  const publicDir = join(rootDir, "public");

  await page.route("http://127.0.0.1:8080/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    // Static assets
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

    // SSR / HTML routes handled by Nitro app
    try {
      const reqHeaders = new Headers();
      for (const [k, v] of Object.entries(request.headers())) {
        reqHeaders.set(k, v);
      }
      const fetchReq = new Request(request.url(), {
        method: request.method(),
        headers: reqHeaders,
        body: ["POST", "PUT", "PATCH"].includes(request.method()) ? request.postDataBuffer() : undefined,
      });

      const res = await app.fetch(fetchReq);
      const resStatus = res.status;
      const resHeaders = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });
      const body = Buffer.from(await res.arrayBuffer());

      return route.fulfill({ status: resStatus, headers: resHeaders, body });
    } catch (e) {
      console.error("SSR error for", request.url(), e);
      return route.fulfill({ status: 500, contentType: "text/plain", body: String(e) });
    }
  });

  const response = await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
  console.log("Status:", response.status());
  console.log("Title:", await page.title());
  const text = await page.locator("body").innerText();
  console.log("Body text length:", text.length);
  console.log("Body text preview:\n", text.slice(0, 300));
  await browser.close();
}

main().catch(console.error);
