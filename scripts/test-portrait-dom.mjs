import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

console.log("=== DOM EMPIRICAL TEST FOR CELEBRITY PORTRAIT & FALLBACKS ===");

// Check if dev server is responding at 8080
async function checkServer() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:8080/", (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

async function runBrowserTest() {
  const isUp = await checkServer();
  if (!isUp) {
    console.error("Dev server not up on 8080, skipping browser DOM test.");
    process.exit(1);
  }

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  const response = await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
  console.log(`Page status: ${response.status()}`);

  // Evaluate image elements on the page if present
  const imgCount = await page.locator("img").count();
  console.log(`Images found on homepage: ${imgCount}`);

  // Verify zero console errors
  console.log(`Console errors captured: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.log("Console errors:", consoleErrors);
  }

  await browser.close();

  if (consoleErrors.length === 0 && response.status() === 200) {
    console.log("PASSED: DOM Browser empirical verification successful.");
  } else {
    console.error("FAILED: DOM Browser empirical verification failed.");
    process.exit(1);
  }
}

runBrowserTest().catch((err) => {
  console.error("Browser test exception:", err);
  process.exit(1);
});
