import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import createCanvas from "canvas";

async function runTest() {
  console.log("=== Testing High-Res (4284x5712) Photo Crop & Face Detection in Browser ===");
  const screenshotsDir = join(process.cwd(), "screenshots", "highres_test");
  mkdirSync(screenshotsDir, { recursive: true });

  // Create high-res 4284x5712 canvas image with 3 faces (similar to user's photo)
  console.log("Generating 4284x5712 image with 3 faces...");
  const w = 4284;
  const h = 5712;
  const canvas = createCanvas.createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  // Outdoor background
  ctx.fillStyle = "#3a4a35";
  ctx.fillRect(0, 0, w, h);

  // Function to draw face
  const drawFace = (cx, cy, scale, skinColor) => {
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 220 * scale, 300 * scale, 0, 0, 2 * Math.PI);
    ctx.fill();
    // Eyes
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(cx - 80 * scale, cy - 40 * scale, 35 * scale, 20 * scale, 0, 0, 2 * Math.PI);
    ctx.ellipse(cx + 80 * scale, cy - 40 * scale, 35 * scale, 20 * scale, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "#2b2b2b";
    ctx.beginPath();
    ctx.arc(cx - 80 * scale, cy - 40 * scale, 15 * scale, 0, 2 * Math.PI);
    ctx.arc(cx + 80 * scale, cy - 40 * scale, 15 * scale, 0, 2 * Math.PI);
    ctx.fill();
    // Mouth
    ctx.fillStyle = "#b85252";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 120 * scale, 60 * scale, 25 * scale, 0, 0, 2 * Math.PI);
    ctx.fill();
  };

  // Draw 3 people side-by-side
  drawFace(w * 0.25, h * 0.40, 1.8, "#d1a384"); // Left man
  drawFace(w * 0.50, h * 0.45, 1.6, "#e8c3a7"); // Center woman
  drawFace(w * 0.75, h * 0.40, 1.8, "#c99a7b"); // Right man

  const imgPath = join(screenshotsDir, "highres_group.jpg");
  const buffer = canvas.toBuffer("image/jpeg", { quality: 0.85 });
  writeFileSync(imgPath, buffer);
  console.log(`Saved high-res test image to ${imgPath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  console.log("Navigating to app at http://127.0.0.1:8080/ ...");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });

  console.log("Uploading 4284x5712 group image...");
  const fileInput = page.locator("input[type='file']").first();
  await fileInput.setInputFiles(imgPath);

  const tStart = Date.now();
  console.log("Waiting for CropReview screen & face candidate detection...");
  await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 15000 });

  // Wait for scanning status or face candidate buttons to settle
  await page.waitForTimeout(1500);
  const elapsed = Date.now() - tStart;
  console.log(`CropReview rendered and processed faces in ${elapsed} ms!`);

  const statusText = await page.locator("section div:has-text('found'), section div:has-text('face'), section div:has-text('adjust')").first().innerText().catch(() => "N/A");
  console.log(`CropReview status text: "${statusText}"`);

  await page.screenshot({ path: join(screenshotsDir, "crop_review_highres_result.png") });

  const hasTimedOutError = (await page.locator("text=Timed out").count()) > 0;
  console.log(`Timed out error banner present: ${hasTimedOutError}`);

  await browser.close();

  if (hasTimedOutError) {
    console.error("FAIL: Detection timed out!");
    process.exit(1);
  } else {
    console.log("SUCCESS: High-res group photo processed cleanly without timing out!");
    process.exit(0);
  }
}

runTest().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
