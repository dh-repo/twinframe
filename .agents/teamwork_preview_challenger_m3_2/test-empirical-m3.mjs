import { chromium } from "playwright";
import path from "path";
import fs from "fs";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  console.log("Navigating to http://127.0.0.1:8080/...");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });

  const screenshotDir = "/Users/damian/GitHub/twinframe/.agents/teamwork_preview_challenger_m3_2/screenshots";
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // 1. Initial landing page screenshot
  await page.screenshot({ path: path.join(screenshotDir, "01-initial-landing.png") });

  // 2. Upload sample image using filechooser
  const sampleImagePath = "/Users/damian/GitHub/twinframe/public/celebs/brad-pitt.jpg";
  console.log("Triggering file chooser with photo:", sampleImagePath);
  
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator('button:has-text("Upload photo")').click(),
  ]);
  await fileChooser.setFiles(sampleImagePath);

  // Wait for CropReview interface
  console.log("Waiting for Crop Review interface...");
  await page.waitForSelector('text=Adjust your photo', { timeout: 10000 });
  await page.waitForTimeout(500);

  // 3. Crop review page screenshot
  await page.screenshot({ path: path.join(screenshotDir, "02-crop-review.png") });

  // Click "Approve & Match" button
  console.log("Clicking Approve & Match button...");
  const approveBtn = page.locator('button:has-text("Approve & Match")');
  await approveBtn.click();

  // 4. Capture Scanning HUD during analysis phase
  await page.waitForTimeout(600);
  console.log("Capturing scanning HUD overlay...");
  await page.screenshot({ path: path.join(screenshotDir, "03-scanning-hud.png") });

  // 5. Wait for results phase or low quality override
  console.log("Waiting for results phase or quality-blocked screen...");
  const resultsHeader = page.locator('text=TOP DOPPELGÄNGER MATCH');
  const lowQualityBtn = page.locator('button:has-text("See low-confidence matches")');

  await Promise.race([
    resultsHeader.waitFor({ timeout: 35000 }).catch(() => {}),
    lowQualityBtn.waitFor({ timeout: 35000 }).catch(() => {}),
  ]);

  if (await lowQualityBtn.isVisible()) {
    console.log("Photo triggered quality gate, taking screenshot and clicking 'See low-confidence matches'...");
    await page.screenshot({ path: path.join(screenshotDir, "03b-quality-blocked.png") });
    await lowQualityBtn.click();
    await resultsHeader.waitFor({ timeout: 10000 });
  }

  await page.waitForTimeout(1500); // Allow counter & card reveal animation to finish

  // 6. Screenshot of top match reveal card (Side-by-Side mode default)
  console.log("Capturing Match Reveal Card (Side-by-Side mode)...");
  await page.screenshot({ path: path.join(screenshotDir, "04-match-reveal-side-by-side.png") });

  // 7. Click "Split Slider" mode tab
  const splitTab = page.locator('button:has-text("Split Slider")');
  if (await splitTab.isVisible()) {
    console.log("Switching to Split Slider view...");
    await splitTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, "05-match-reveal-split-slider.png") });
  } else {
    console.warn("Split Slider tab not found!");
  }

  // 8. Click "Landmarks" mode tab
  const landmarksTab = page.locator('button:has-text("Landmarks")');
  if (await landmarksTab.isVisible()) {
    console.log("Switching to Landmarks view...");
    await landmarksTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, "06-match-reveal-landmarks.png") });
  } else {
    console.warn("Landmarks tab not found!");
  }

  // Check full results page
  console.log("Capturing full results page...");
  await page.screenshot({ path: path.join(screenshotDir, "07-full-results-page.png"), fullPage: true });

  console.log("\n--- EMPIRICAL TEST SUMMARY ---");
  console.log("Console Errors:", consoleErrors);
  console.log("Page Errors:", pageErrors);

  await browser.close();

  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    console.error("Test failed due to errors.");
    process.exit(1);
  }

  console.log("All empirical tests passed successfully!");
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
