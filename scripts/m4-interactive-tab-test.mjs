import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import createCanvas from "canvas";

async function main() {
  const screenshotsDir = join(process.cwd(), "screenshots", "m4_verification");
  mkdirSync(screenshotsDir, { recursive: true });

  console.log("=== M4 Interactive View & Asset Stress Test ===");
  const consoleErrors = [];
  const pageErrors = [];
  const networkErrors = [];

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));
  page.on("requestfailed", (req) => networkErrors.push(`[REQ_FAILED] ${req.url()}`));
  page.on("response", (res) => {
    if (res.status() >= 400) networkErrors.push(`[HTTP_${res.status()}] ${res.url()}`);
  });

  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });

  // Generate test face
  const testImgPath = join(screenshotsDir, "test_face_sample2.jpg");
  const canvas = createCanvas.createCanvas(400, 400);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1e2329";
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = "#e5c0a0";
  ctx.beginPath();
  ctx.ellipse(200, 200, 100, 130, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(160, 180, 7, 0, 2 * Math.PI);
  ctx.arc(240, 180, 7, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = "#804040";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(200, 250, 20, 0, Math.PI);
  ctx.stroke();
  writeFileSync(testImgPath, canvas.toBuffer("image/jpeg"));

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.locator("button:has-text('Upload photo')").first().click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(testImgPath);

  await page.waitForTimeout(600);
  await page.locator("button:has-text('Approve & Match'), button:has-text('Match')").first().click();

  // Wait for processing completion
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const body = await page.locator("body").innerText();
    if (body.includes("ALSO CLOSE DOPPELGÄNGERS") || body.includes("Photo quality too low")) {
      break;
    }
  }

  const seeMatchesBtn = page.locator("button:has-text('See low-confidence matches')").first();
  if (await seeMatchesBtn.count() > 0) {
    await seeMatchesBtn.click();
    await page.waitForTimeout(1000);
  }

  // Click Split Slider tab
  console.log("Clicking Split Slider tab...");
  const splitTab = page.locator("button:has-text('Split Slider')").first();
  if (await splitTab.count() > 0) {
    await splitTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(screenshotsDir, "07_split_slider_view.png") });
  }

  // Click Landmarks tab
  console.log("Clicking Landmarks tab...");
  const landmarksTab = page.locator("button:has-text('Landmarks')").first();
  if (await landmarksTab.count() > 0) {
    await landmarksTab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(screenshotsDir, "08_landmarks_view.png") });
  }

  // Check all images across the DOM for broken images
  const brokenImages = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => img.src);
  });

  console.log("Broken Images Count:", brokenImages.length);
  console.log("Console Errors Count:", consoleErrors.length);
  console.log("Page Errors Count:", pageErrors.length);
  console.log("Network Errors Count:", networkErrors.length);

  await browser.close();

  const success = consoleErrors.length === 0 && pageErrors.length === 0 && brokenImages.length === 0 && networkErrors.length === 0;
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL ERROR IN INTERACTIVE TEST:", err);
  process.exit(1);
});
