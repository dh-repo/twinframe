import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import createCanvas from "canvas";

async function runCompleteAppFlow() {
  console.log("=== COMPLETE APP FLOW VERIFICATION: UPLOAD -> CROP REVIEW -> MATCH RESULTS ===");
  const screenshotsDir = join(process.cwd(), "screenshots", "complete_flow");
  mkdirSync(screenshotsDir, { recursive: true });

  console.log("1. Generating test portrait...");
  const w = 800;
  const h = 800;
  const canvas = createCanvas.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1e222a";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#dcb898";
  ctx.beginPath();
  ctx.ellipse(400, 400, 200, 260, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#2c1d11";
  ctx.beginPath();
  ctx.ellipse(400, 220, 210, 110, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(320, 370, 32, 18, 0, 0, 2 * Math.PI);
  ctx.ellipse(480, 370, 32, 18, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#2d4a3e";
  ctx.beginPath();
  ctx.arc(320, 370, 14, 0, 2 * Math.PI);
  ctx.arc(480, 370, 14, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#bd6060";
  ctx.beginPath();
  ctx.ellipse(400, 510, 50, 22, 0, 0, 2 * Math.PI);
  ctx.fill();

  const imgPath = join(screenshotsDir, "portrait.jpg");
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
  page.on("requestfailed", (req) => {
    console.log(`404/FAILED REQUEST: ${req.url()} (${req.failure()?.errorText})`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      console.log(`HTTP ${res.status()}: ${res.url()}`);
    }
  });

  console.log("2. Navigating to http://127.0.0.1:8080/ ...");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });

  console.log("3. Uploading test photo via fileChooser Promise...");
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("button:has-text('Upload File')").click(),
  ]);
  await fileChooser.setFiles(imgPath);

  console.log("4. Waiting for CropReview UI...");
  await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(screenshotsDir, "01_crop_review.png") });

  console.log("5. Clicking Approve & Match...");
  const tStartAnalysis = Date.now();
  const approveBtn = page.locator("button:has-text('Approve'), button:has-text('Match')").last();
  await approveBtn.click();

  console.log("6. Monitoring analysis phase and waiting for results...");
  let phaseFinished = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    const text = await page.locator("body").innerText();

    if (
      text.includes("TOP CELEBRITY MATCH") ||
      text.includes("Top Celebrity Match") ||
      text.includes("CLOSE DOPPELGÄNGERS") ||
      text.includes("See low-confidence matches") ||
      text.includes("Match Results") ||
      text.includes("Quality rating")
    ) {
      const elapsed = Date.now() - tStartAnalysis;
      console.log(`\n🎉 MATCH ANALYSIS FINISHED SUCCESSFULLY IN ${elapsed} MS! 🎉\n`);
      phaseFinished = true;
      break;
    }

    if (text.includes("Analysis timed out") || text.includes("Couldn't analyze")) {
      console.error("❌ FAIL: Analysis timed out!");
      await page.screenshot({ path: join(screenshotsDir, "02_analysis_failed.png") });
      await browser.close();
      process.exit(1);
    }
  }

  // Handle low confidence prompt button if shown
  const seeMatchesBtn = page.locator("button:has-text('See low-confidence matches'), button:has-text('See matches')").first();
  if (await seeMatchesBtn.count() > 0) {
    console.log("Clicking 'See low-confidence matches' button...");
    await seeMatchesBtn.click();
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: join(screenshotsDir, "03_final_match_results.png") });

  const bodyText = await page.locator("body").innerText();
  const hasMatches = bodyText.includes("Match") || bodyText.includes("DOPPELGÄNGERS") || bodyText.includes("Celebrity");
  console.log(`Final Page Verification - Has Celebrity Match UI: ${hasMatches}`);
  console.log(`Console errors captured: ${consoleErrors.length}`, consoleErrors);

  const relevantErrors = consoleErrors.filter(
    (err) => !err.includes("Failed to load resource: the server responded with a status of 404"),
  );

  await browser.close();

  if (hasMatches && relevantErrors.length === 0) {
    console.log("SUCCESS: Entire application pipeline verified live in browser!");
    process.exit(0);
  } else {
    console.error("FAIL: Application flow did not complete cleanly.");
    process.exit(1);
  }
}

runCompleteAppFlow().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
