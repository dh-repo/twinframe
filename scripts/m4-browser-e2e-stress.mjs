import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import createCanvas from "canvas";

async function main() {
  const screenshotsDir = join(process.cwd(), "screenshots", "m4_verification");
  mkdirSync(screenshotsDir, { recursive: true });

  console.log("=== M4 Browser Runtime & E2E Stress Test ===");
  const consoleLogs = [];
  const consoleErrors = [];
  const pageErrors = [];
  const networkErrors = [];

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  page.on("console", (msg) => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type().toUpperCase()}] ${text}`);
    if (msg.type() === "error") {
      consoleErrors.push(text);
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`[PAGE_ERROR] ${err.message || String(err)}`);
    pageErrors.push(err.message || String(err));
  });

  page.on("requestfailed", (req) => {
    networkErrors.push(`[REQ_FAILED] ${req.url()} - ${req.failure()?.errorText || "Unknown error"}`);
  });

  page.on("response", (res) => {
    if (res.status() >= 400) {
      networkErrors.push(`[HTTP_${res.status()}] ${res.url()}`);
    }
  });

  const startTime = Date.now();
  console.log("Navigating to http://127.0.0.1:8080/ ...");
  const response = await page.goto("http://127.0.0.1:8080/", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  const loadTimeMs = Date.now() - startTime;
  console.log(`Page loaded in ${loadTimeMs} ms with status ${response?.status()}`);

  await page.screenshot({ path: join(screenshotsDir, "01_landing_page.png") });

  // Verify basic elements
  const title = await page.title();
  console.log(`Page Title: "${title}"`);

  // Generate a high quality realistic face synthetic canvas image
  const testImgPath = join(screenshotsDir, "test_face_sample.jpg");
  const canvas = createCanvas.createCanvas(400, 400);
  const ctx = canvas.getContext("2d");
  // Background
  ctx.fillStyle = "#22252a";
  ctx.fillRect(0, 0, 400, 400);
  // Face oval
  ctx.fillStyle = "#dcb898";
  ctx.beginPath();
  ctx.ellipse(200, 200, 110, 140, 0, 0, 2 * Math.PI);
  ctx.fill();
  // Hair
  ctx.fillStyle = "#2c1d11";
  ctx.beginPath();
  ctx.ellipse(200, 110, 115, 60, 0, 0, 2 * Math.PI);
  ctx.fill();
  // Eyes
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(160, 180, 18, 10, 0, 0, 2 * Math.PI);
  ctx.ellipse(240, 180, 18, 10, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#2d4a3e";
  ctx.beginPath();
  ctx.arc(160, 180, 8, 0, 2 * Math.PI);
  ctx.arc(240, 180, 8, 0, 2 * Math.PI);
  ctx.fill();
  // Eyebrows
  ctx.strokeStyle = "#2c1d11";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(135, 162);
  ctx.quadraticCurveTo(160, 155, 182, 162);
  ctx.moveTo(218, 162);
  ctx.quadraticCurveTo(240, 155, 265, 162);
  ctx.stroke();
  // Nose
  ctx.strokeStyle = "#b58d6e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(200, 180);
  ctx.lineTo(195, 225);
  ctx.lineTo(208, 225);
  ctx.stroke();
  // Mouth
  ctx.fillStyle = "#bd6060";
  ctx.beginPath();
  ctx.ellipse(200, 255, 28, 12, 0, 0, 2 * Math.PI);
  ctx.fill();

  const buffer = canvas.toBuffer("image/jpeg");
  writeFileSync(testImgPath, buffer);

  console.log("Uploading test photo to dropzone...");
  const fileInput = page.locator("input[type='file']").first();
  await fileInput.setInputFiles(testImgPath);


  console.log("Waiting for crop review screen...");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(screenshotsDir, "02_crop_review.png") });

  // Click approve / match button on crop review screen
  console.log("Clicking approve / match photo button...");
  const matchBtn = page.locator("button:has-text('Approve & Match'), button:has-text('Match'), button:has-text('Analyze')").first();
  await matchBtn.click();

  console.log("Waiting for scanning HUD overlay / analysis phase...");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(screenshotsDir, "03_scanning_hud.png") });

  console.log("Waiting for match results or quality prompt...");
  let phaseFinished = false;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(1000);
    const textContent = await page.locator("body").innerText();
    if (
      textContent.includes("ALSO CLOSE DOPPELGÄNGERS") ||
      textContent.includes("Try another photo") ||
      textContent.includes("Photo quality too low") ||
      textContent.includes("No face detected") ||
      textContent.includes("See low-confidence matches")
    ) {
      console.log(`Matching process completed after ${i + 1.5} seconds!`);
      phaseFinished = true;
      break;
    }
  }

  if (!phaseFinished) {
    console.warn("Warning: Phase did not reach explicit result text within timeout.");
  }

  // If quality warning appears, click "See low-confidence matches" to view results
  const seeMatchesBtn = page.locator("button:has-text('See low-confidence matches'), button:has-text('See matches')").first();
  if (await seeMatchesBtn.count() > 0) {
    console.log("Quality notice shown. Clicking 'See low-confidence matches' button...");
    await page.screenshot({ path: join(screenshotsDir, "04_quality_blocked.png") });
    await seeMatchesBtn.click();
    await page.waitForTimeout(1200);
  }

  await page.screenshot({ path: join(screenshotsDir, "05_match_results.png") });

  // Verify match results presence
  const headings = await page.locator("h1, h2, h3, .font-medium").allInnerTexts();
  console.log("Rendered Headings:", headings.slice(0, 10));

  // Check all images in the document to ensure none are broken (naturalWidth === 0)
  const brokenImages = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => ({ src: img.src, alt: img.alt, class: img.className }));
  });

  console.log(`Broken Image Count: ${brokenImages.length}`);
  if (brokenImages.length > 0) {
    console.log("Broken Images:", JSON.stringify(brokenImages, null, 2));
  }

  // Interactive UI checks: test split comparison slider drag
  const splitSlider = page.locator("input[type='range'], [role='slider']").first();
  if (await splitSlider.count() > 0) {
    console.log("Testing split comparison slider movement...");
    const box = await splitSlider.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
      await page.mouse.up();
    }
  }

  await page.screenshot({ path: join(screenshotsDir, "06_after_interaction.png") });

  console.log("=== Test Summary ===");
  console.log(`Page Load Time: ${loadTimeMs}ms`);
  console.log(`Console Errors: ${consoleErrors.length}`);
  console.log(`Page Errors: ${pageErrors.length}`);
  console.log(`Network Errors: ${networkErrors.length}`);
  console.log(`Broken Images: ${brokenImages.length}`);

  if (consoleErrors.length > 0) {
    console.log("Console Errors List:\n", consoleErrors.join("\n"));
  }
  if (networkErrors.length > 0) {
    console.log("Network Errors List:\n", networkErrors.join("\n"));
  }

  await browser.close();

  const success = consoleErrors.length === 0 && pageErrors.length === 0 && brokenImages.length === 0 && networkErrors.length === 0;
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL ERROR IN STRESS TEST:", err);
  process.exit(1);
});
