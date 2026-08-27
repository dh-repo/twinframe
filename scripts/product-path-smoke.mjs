#!/usr/bin/env node
/**
 * Live product path: landing copy → Photo Library upload → crop → analyze →
 * results. Asserts AdaFace (not EdgeFace) on landing, analyzing, and the
 * results footer. Defaults to the enrolled Adam Driver portrait, then the
 * standing-swing civilian as a Distant Twin / refuse probe.
 *
 *   node scripts/product-path-smoke.mjs http://127.0.0.1:8080
 *
 * Pack chips were removed from the product UI — this smoke does not require them.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SWING_PROBE } from "./lib/swing-probe.mjs";
import { engineCopyFailures } from "./lib/engine-copy-guard.mjs";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASE = process.argv[2] || "http://127.0.0.1:8080/";
const MATCH_IMAGE = resolve(ROOT, "public/celebs/adam-driver.jpg");
const REFUSE_IMAGE = resolve(SWING_PROBE);
const OUT = resolve(ROOT, "screenshots/product-path");
const ANALYZE_WAIT_MS = Number(process.env.PRODUCT_PATH_ANALYZE_MS || 120000);

mkdirSync(OUT, { recursive: true });

let failures = 0;
function fail(msg) {
  failures++;
  console.log(`[product-path] FAIL: ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForBody(page, test, { timeoutMs, label }) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const text = await page.locator("body").innerText();
    if (test(text)) return text;
    await sleep(1000);
  }
  const text = await page.locator("body").innerText();
  throw new Error(`[${label}] timed out after ${timeoutMs}ms. Body:\n${text.slice(0, 1200)}`);
}

function verdictPresent(text) {
  return /DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN|No close look-alike|Photo quality|Hold the phone|timed out|Couldn't analyze/i.test(
    text,
  );
}

async function uploadAndApprove(page, filePath) {
  const input = page.locator("input[type='file']").first();
  await input.setInputFiles(filePath);
  await waitForBody(
    page,
    (t) => /Choose a face|Approve & Match|Use this crop|Finding face|Scanning for faces/i.test(t),
    { timeoutMs: 45000, label: "crop-review" },
  );
  const matchBtn = page.getByRole("button", { name: /Approve & Match|Use this crop|Match /i }).last();
  await matchBtn.waitFor({ state: "visible", timeout: 45000 });
  for (let i = 0; i < 40; i++) {
    if (await matchBtn.isEnabled()) break;
    await sleep(500);
  }
  await matchBtn.click({ force: true });
}

if (!existsSync(MATCH_IMAGE)) throw new Error(`Missing ${MATCH_IMAGE}`);
if (!existsSync(REFUSE_IMAGE)) throw new Error(`Missing ${REFUSE_IMAGE}`);

const report = { url: BASE, steps: {}, failures: [] };

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err?.message || err)));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(1200);
  await page.screenshot({ path: join(OUT, "01-landing.png"), fullPage: true });
  const landing = await page.locator("body").innerText();
  const landingFails = engineCopyFailures("landing", landing, { requireAdaFace: true });
  for (const msg of landingFails) fail(msg);
  report.steps.landing = {
    hasUpload: /Photo Library|Upload Photo/.test(landing),
    adaface: /AdaFace/i.test(landing),
    excerpt: landing.slice(0, 500),
  };
  if (!report.steps.landing.hasUpload) fail("landing missing Photo Library upload");

  const galleryBtn = page.getByRole("button", { name: /Explore .*Stars/i }).first();
  if ((await galleryBtn.count()) > 0) {
    await galleryBtn.click();
    await sleep(800);
    const galleryText = await page.locator("body").innerText();
    for (const msg of engineCopyFailures("gallery-modal", galleryText)) fail(msg);
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(300);
  }

  await uploadAndApprove(page, MATCH_IMAGE);
  await page.screenshot({ path: join(OUT, "02-analyzing.png"), fullPage: true });
  let sawAnalyzing = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const text = await page.locator("body").innerText();
    if (/Extracting AdaFace|AdaFace IR-101|Ranking celebrity/i.test(text)) {
      sawAnalyzing = true;
      for (const msg of engineCopyFailures("analyzing", text)) fail(msg);
      break;
    }
    if (verdictPresent(text)) break;
    await sleep(500);
  }
  report.steps.analyzing = { sawAdaFaceStep: sawAnalyzing };

  const resultsText = await waitForBody(page, verdictPresent, {
    timeoutMs: ANALYZE_WAIT_MS,
    label: "analyze-results",
  });
  await page.screenshot({ path: join(OUT, "03-results-adam.png"), fullPage: true });
  report.steps.match = {
    timedOut: /timed out|Couldn't analyze/i.test(resultsText),
    verdict: (resultsText.match(/DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN/) || [])[0] || null,
    adafaceFooter: /AdaFace IR-101/i.test(resultsText),
    excerpt: resultsText.slice(0, 800),
  };
  if (report.steps.match.timedOut) {
    fail("Adam Driver analysis timed out — results footer not reached");
  } else {
    for (const msg of engineCopyFailures("results", resultsText, { requireAdaFace: true })) fail(msg);
    if (!report.steps.match.verdict) fail("Adam Driver results missing a named verdict");
  }

  const reset = page.getByRole("button", { name: /Try another photo|New photo|Start over/i }).first();
  if ((await reset.count()) > 0 && (await reset.isVisible().catch(() => false))) {
    await reset.click();
    await sleep(600);
  } else {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(800);
  }

  await uploadAndApprove(page, REFUSE_IMAGE);
  const refuseText = await waitForBody(page, verdictPresent, {
    timeoutMs: ANALYZE_WAIT_MS,
    label: "swing-refuse",
  });
  await page.screenshot({ path: join(OUT, "04-results-swing.png"), fullPage: true });
  const swingDistant = /DISTANT TWIN/i.test(refuseText);
  const swingRefuse = /No close look-alike/i.test(refuseText);
  const swingMuted = (await page.locator('[data-score-muted="1"]').count()) > 0;
  report.steps.swing = {
    timedOut: /timed out|Couldn't analyze/i.test(refuseText),
    distantTwin: swingDistant,
    refuse: swingRefuse,
    muted: swingMuted,
    excerpt: refuseText.slice(0, 800),
  };
  if (report.steps.swing.timedOut) {
    fail("swing civilian analysis timed out");
  } else if (!swingDistant && !swingRefuse) {
    fail("swing civilian should be Distant Twin or an open-set refuse, not a look-alike claim");
  } else if (swingDistant && !swingMuted && !/NOT A TWIN CLAIM|NEAREST/i.test(refuseText)) {
    fail("swing Distant Twin must mute the hero percent");
  }
  for (const msg of engineCopyFailures("swing-results", refuseText)) fail(msg);

  report.consoleErrors = consoleErrors.slice(0, 20);
  report.failures = failures;
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  fail(String(err?.message || err));
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ ...report, error: String(err) }, null, 2));
  console.error(err);
} finally {
  await browser.close();
}

process.exit(failures > 0 ? 1 : 0);
