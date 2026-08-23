#!/usr/bin/env node
/**
 * Mid-phone performance probe: drives the real upload -> analyze flow under
 * Chromium CPU throttling and reports upload->results wall time per rate.
 *
 *   node scripts/perf-throttle.mjs http://127.0.0.1:8080 [rates=1,4,6]
 *
 * Per-rate budget scales as BUDGET_BASE_MS * rate (default base 20000): slower
 * is expected at higher throttle and on weaker hardware, so one flat number
 * cannot serve both a Mac Studio and 2-core CI runners. Measured 2026-08:
 * ~4.5s at 1x / ~14s at 4x on 2-core CI; ~2.4s/3.9s locally. The gate catches
 * gross regressions (model reload loops, accidental sync work), not hardware.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "public/celebs/adam-driver.jpg");

const url = process.argv[2] || "http://127.0.0.1:8080/";
const rates = (process.argv[3] || "1,4,6").split(",").map(Number).filter(Boolean);
const BUDGET_BASE_MS = Number(process.env.PERF_BUDGET_BASE_MS || 20_000);
const budgetFor = (rate) => Math.ceil(BUDGET_BASE_MS * rate);

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

let failed = false;

try {
  for (const rate of rates) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    // Only attach CDP throttling when actually throttling: on 2-core CI the
    // mere attachment starved ORT's WASM thread pool even at rate 1.
    if (rate > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    }
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));

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

    const budgetMs = budgetFor(rate);
    let totalMs = null;
    const t0 = Date.now();
    for (let i = 0; i < Math.ceil(budgetMs / 1000); i++) {
      await page.waitForTimeout(1000);
      const txt = await page.locator("body").innerText();
      if (RESULT_MARKER.test(txt)) {
        totalMs = Date.now() - t0;
        break;
      }
    }
    if (totalMs === null) {
      failed = true;
      const tail = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 220);
      console.log(`[perf] FAIL ${rate}x: no result within ${budgetMs}ms | pageerrors=${errors.length} | body="${tail}"`);
      for (const e of errors.slice(0, 3)) console.log(`[perf]   pageerror: ${e}`);
    } else if (totalMs > budgetMs) {
      failed = true;
      console.log(`[perf] FAIL ${rate}x: ${totalMs}ms exceeds ${budgetMs}ms budget`);
    } else {
      console.log(`[perf] ${rate}x CPU: crop-approve -> results in ${totalMs}ms (budget ${budgetMs}ms)`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (failed) {
  console.log(`[perf] FAIL: a rate exceeded its scaled budget (base ${BUDGET_BASE_MS}ms/rate)`);
  process.exit(1);
}
console.log("[perf] PASS: all rates within their scaled budgets");
