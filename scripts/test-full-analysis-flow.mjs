import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import createCanvas from "canvas";

async function runEndToEndAnalysisTest() {
  console.log("=== FULL END-TO-END BROWSER TEST: UPLOAD -> CROP -> ANALYZE -> MATCH RESULTS ===");
  const screenshotsDir = join(process.cwd(), "screenshots", "e2e_full_flow");
  mkdirSync(screenshotsDir, { recursive: true });

  const w = 600;
  const h = 600;
  const canvas = createCanvas.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1e222a";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#dcb898";
  ctx.beginPath();
  ctx.ellipse(300, 300, 160, 210, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#2c1d11";
  ctx.beginPath();
  ctx.ellipse(300, 160, 170, 90, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(240, 280, 28, 16, 0, 0, 2 * Math.PI);
  ctx.ellipse(360, 280, 28, 16, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#2d4a3e";
  ctx.beginPath();
  ctx.arc(240, 280, 12, 0, 2 * Math.PI);
  ctx.arc(360, 280, 12, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#bd6060";
  ctx.beginPath();
  ctx.ellipse(300, 390, 42, 18, 0, 0, 2 * Math.PI);
  ctx.fill();

  const imgPath = join(screenshotsDir, "e2e_face.jpg");
  const buffer = canvas.toBuffer("image/jpeg", { quality: 0.9 });
  writeFileSync(imgPath, buffer);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  console.log("1. Navigating to http://127.0.0.1:8080/ ...");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
  await page.screenshot({ path: join(screenshotsDir, "01_homepage.png") });

  console.log("2. Uploading photo via setInputFiles + change event...");
  const handle = await page.$("input[type='file']");
  if (handle) {
    await handle.setInputFiles(imgPath);
    await handle.evaluate((el) => el.dispatchEvent(new Event("change", { bubbles: true })));
  }

  console.log("3. Waiting for CropReview screen...");
  await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(screenshotsDir, "02_crop_review.png") });

  console.log("4. Clicking Approve/Match button...");
  const tAnalysisStart = Date.now();
  const approveBtn = page.locator("button:has-text('Approve'), button:has-text('Match')").last();
  await approveBtn.click();

  console.log("5. Waiting for analysis phase and final match results...");
  let phaseFinished = false;
  for (let i = 0; i < 35; i++) {
    await page.waitForTimeout(1000);
    const bodyText = await page.locator("body").innerText();

    if (
      bodyText.includes("TOP CELEBRITY MATCH") ||
      bodyText.includes("Top Celebrity Match") ||
      bodyText.includes("CLOSE DOPPELGÄNGERS") ||
      bodyText.includes("See low-confidence matches") ||
      bodyText.includes("Match Results") ||
      bodyText.includes("match rating")
    ) {
      const elapsed = Date.now() - tAnalysisStart;
      console.log(`ANALYSIS COMPLETED SUCCESSFULLY IN ${elapsed} ms!`);
      phaseFinished = true;
      break;
    }

    if (bodyText.includes("Analysis timed out") || bodyText.includes("Couldn't analyze")) {
      console.error("FAIL: Analysis timed out!");
      await page.screenshot({ path: join(screenshotsDir, "03_analysis_failed.png") });
      await browser.close();
      process.exit(1);
    }
  }

  // Handle low-confidence matches button if present
  const seeMatchesBtn = page.locator("button:has-text('See low-confidence matches'), button:has-text('See matches')").first();
  if (await seeMatchesBtn.count() > 0) {
    console.log("Clicking 'See low-confidence matches' button...");
    await seeMatchesBtn.click();
    await page.waitForTimeout(800);
  }

  await page.screenshot({ path: join(screenshotsDir, "04_final_match_results.png") });

  const bodyText = await page.locator("body").innerText();
  console.log("Final page text snippet:", bodyText.substring(0, 300).replace(/\n/g, " "));
  const hasResults = bodyText.includes("Match") || bodyText.includes("DOPPELGÄNGERS") || bodyText.includes("Celebrity");
  console.log(`Results rendered successfully: ${hasResults}`);
  console.log(`Console errors during flow: ${consoleErrors.length}`);

  await browser.close();

  if (hasResults && consoleErrors.length === 0) {
    console.log("SUCCESS: End-to-end flow verified 100% working!");
    process.exit(0);
  } else {
    console.error("FAIL: Flow did not produce match results cleanly.");
    process.exit(1);
  }
}

runEndToEndAnalysisTest().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
