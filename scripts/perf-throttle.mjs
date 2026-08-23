#!/usr/bin/env node
/**
 * Mid-phone performance probe: drives the real upload -> analyze flow under
 * Chromium CPU throttling and reports upload->results wall time per rate.
 *
 *   node scripts/perf-throttle.mjs http://127.0.0.1:8080 [rates=1,4,6]
 *
 * Fails (exit 1) if analysis at any requested rate exceeds PERF_BUDGET_MS
 * (default 15000) — "noticeable but usable" on a mid-range phone.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "public/celebs/adam-driver.jpg");

const url = process.argv[2] || "http://127.0.0.1:8080/";
const rates = (process.argv[3] || "1,4,6").split(",").map(Number).filter(Boolean);
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS || 15_000);

const RESULT_MARKER = /DOPPELGÄNGER MATCH|NEAREST GALLERY NEIGHBOR|POSSIBLE LOOK-ALIKE|quality too low|Couldn't analyze/;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
  ],
});

let worst = 0;

try {
  for (const rate of rates) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });

    await page.goto(new URL("/", url).href, { waitUntil: "networkidle", timeout: 90_000 });
    const [fc] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 20_000 }),
      page.locator('button:has-text("Photo Library")').first().click(),
    ]);
    await fc.setFiles(FIXTURE);
    await page.waitForSelector("text=Choose a face", { timeout: 60_000 });
    const approve = page.getByRole("button", { name: "Approve & Match" }).first();
    await approve.waitFor({ state: "visible", timeout: 120_000 });
    await approve.click();

    let totalMs = null;
    const t0 = Date.now();
    for (let i = 0; i < Math.ceil(BUDGET_MS / 1000); i++) {
      await page.waitForTimeout(1000);
      const txt = await page.locator("body").innerText();
      if (RESULT_MARKER.test(txt)) {
        totalMs = Date.now() - t0;
        break;
      }
    }
    if (totalMs === null) {
      console.log(`[perf] ${rate}x: no result within budget (${BUDGET_MS}ms)`);
      worst = Math.max(worst, BUDGET_MS + 1);
    } else {
      worst = Math.max(worst, totalMs);
      console.log(`[perf] ${rate}x CPU: crop-approve -> results in ${totalMs}ms`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (worst > BUDGET_MS) {
  console.log(`[perf] FAIL: worst ${worst}ms exceeds budget ${BUDGET_MS}ms`);
  process.exit(1);
}
console.log(`[perf] PASS: all rates within ${BUDGET_MS}ms`);
