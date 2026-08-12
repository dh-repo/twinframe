import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import createCanvas from "canvas";

async function runNonFaceTest() {
  console.log("=== EMPIRICAL TEST: NON-FACE (SUNSET SKY / CLOUDS) REJECTION ===");
  const screenshotsDir = join(process.cwd(), "screenshots", "non_face_test");
  mkdirSync(screenshotsDir, { recursive: true });

  const w = 800;
  const h = 800;
  const canvas = createCanvas.createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#ff7e5f");
  grad.addColorStop(0.5, "#feb47b");
  grad.addColorStop(1, "#2c3e50");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.beginPath();
  ctx.arc(200, 300, 100, 0, 2 * Math.PI);
  ctx.arc(320, 280, 120, 0, 2 * Math.PI);
  ctx.arc(450, 310, 90, 0, 2 * Math.PI);
  ctx.fill();

  const imgPath = join(screenshotsDir, "sunset_clouds.jpg");
  const buffer = canvas.toBuffer("image/jpeg", { quality: 0.9 });
  writeFileSync(imgPath, buffer);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  console.log("1. Navigating to app...");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });

  console.log("2. Uploading sunset sky image...");
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("button:has-text('Upload File')").click(),
  ]);
  await fileChooser.setFiles(imgPath);

  console.log("3. Waiting for CropReview UI...");
  await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 15000 });
  await page.waitForTimeout(1500);

  const candidateCount = await page.locator("[data-face-reticle]").count();
  console.log(`Candidate face reticles detected on sunset image: ${candidateCount}`);
  await page.screenshot({ path: join(screenshotsDir, "01_crop_review_sunset.png") });

  console.log("4. Clicking Approve & Match on sunset image...");
  const approveBtn = page.locator("button:has-text('Approve'), button:has-text('Match')").last();
  await approveBtn.click();

  console.log("5. Waiting for analysis to complete...");
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const text = await page.locator("body").innerText();
    if (text.includes("Photo quality too low") || text.includes("No human face") || text.includes("TOP CELEBRITY MATCH")) {
      break;
    }
  }

  await page.screenshot({ path: join(screenshotsDir, "02_final_rejection_screen.png") });

  const bodyText = await page.locator("body").innerText();
  const matchedMarcGuggenheim = bodyText.includes("Marc Guggenheim");
  const blockedQualityScreen = bodyText.includes("Photo quality too low") || bodyText.includes("No human face") || bodyText.includes("No face");

  console.log(`Matched Marc Guggenheim: ${matchedMarcGuggenheim}`);
  console.log(`Quality / No-Face Blocked Screen: ${blockedQualityScreen}`);

  await browser.close();

  if (matchedMarcGuggenheim) {
    console.error("FAIL: Sunset image was matched to Marc Guggenheim!");
    process.exit(1);
  } else if (blockedQualityScreen || candidateCount === 0) {
    console.log("SUCCESS: Non-face image was correctly rejected and NOT matched to Marc Guggenheim!");
    process.exit(0);
  } else {
    console.error("FAIL: Unexpected state.");
    process.exit(1);
  }
}

runNonFaceTest().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
