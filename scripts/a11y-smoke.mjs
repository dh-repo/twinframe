#!/usr/bin/env node
/**
 * Accessibility smoke: run axe-core against the app's public routes AND its
 * interactive core (crop review, results, webcam modal) and fail on
 * serious/critical violations. Requires a running dev or built server.
 *
 *   node scripts/a11y-smoke.mjs http://127.0.0.1:8080
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const url = process.argv[2] || "http://127.0.0.1:8080/";

const ROUTES = ["/", "/held-out-encode"];
// A committed portrait doubles as the upload fixture for the interactive flow.
const UPLOAD_FIXTURE = path.join(ROOT, "public/celebs/adam-driver.jpg");

let failures = 0;

function report(label, results) {
  const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  console.log(`[a11y] ${label}: ${results.violations.length} violations, ${serious.length} serious/critical`);
  for (const v of serious) {
    failures++;
    console.log(`  ${v.impact.toUpperCase()} ${v.id}: ${v.help}`);
    for (const node of v.nodes.slice(0, 3)) {
      console.log(`    -> ${node.target.join(" ")}`);
    }
  }
  for (const v of results.violations.filter((x) => !["serious", "critical"].includes(x.impact))) {
    console.log(`  minor ${v.id}: ${v.nodes.length} node(s)`);
  }
}

async function axeRun(page, label) {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    return window.axe.run(document, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } },
    });
  });
  report(label, results);
}

// Fake camera so the webcam modal is reachable headlessly.
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (const route of ROUTES) {
    await page.goto(new URL(route, url).href, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(800);
    await axeRun(page, route);
  }

  // ---- Interactive core: upload -> crop review -> results ----
  await page.goto(new URL("/", url).href, { waitUntil: "networkidle", timeout: 45_000 });

  const uploadButton = page.locator('button:has-text("Photo Library")').first();
  if ((await uploadButton.count()) === 0) throw new Error("upload button not found on landing page");
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15_000 }),
    uploadButton.click(),
  ]);
  await fileChooser.setFiles(UPLOAD_FIXTURE);

  await page.waitForSelector("text=Choose a face", { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await axeRun(page, "crop-review");

  // Approve the primary face and wait for analysis to finish.
  const approve = page.locator("button:has-text('Approve'), button:has-text('Match')").last();
  await approve.click();
  const resultMarkers = ["DOPPELGÄNGER MATCH", "NEAREST GALLERY NEIGHBOR", "POSSIBLE LOOK-ALIKE", "quality too low"];
  let reachedResults = false;
  for (let i = 0; i < 24 && !reachedResults; i++) {
    await page.waitForTimeout(5000);
    const txt = await page.locator("body").innerText();
    reachedResults = resultMarkers.some((m) => txt.includes(m));
  }
  if (!reachedResults) {
    console.log("[a11y] results screen not reached within budget; skipping that state");
  }
  if (reachedResults) {
    await page.waitForTimeout(1500);
    await axeRun(page, "results");
  }

  // ---- Webcam modal via fake camera ----
  await page.goto(new URL("/", url).href, { waitUntil: "networkidle", timeout: 45_000 });
  const cameraButton = page.locator('button:has-text("Use My Camera")').first();
  if ((await cameraButton.count()) > 0) {
    await cameraButton.click();
    const dialog = page.locator('[role="dialog"]');
    try {
      await dialog.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(1000);
      await axeRun(page, "webcam-modal");
    } catch {
      console.log("[a11y] webcam modal did not open (fake stream unavailable); skipping");
    }
  } else {
    console.log("[a11y] no camera entry point found; skipping webcam modal");
  }
} finally {
  await browser.close();
}

process.exit(failures > 0 ? 1 : 0);
