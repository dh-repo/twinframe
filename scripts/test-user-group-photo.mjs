import { chromium } from "playwright";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

async function runUserPhotoTest() {
  console.log("=== EMPIRICAL TEST: USER'S EXACT 3-PERSON GROUP SUNSET PHOTO ===");
  const screenshotsDir = join(process.cwd(), "screenshots", "user_photo_test");
  mkdirSync(screenshotsDir, { recursive: true });

  const userImgPath = "/Users/damian/.gemini/antigravity/brain/0987e1c6-0e5a-40cf-a8a1-bcfb63ffd49a/.user_uploaded/media_1786479722765.jpg";
  const targetImgPath = join(screenshotsDir, "user_group_photo.jpg");
  copyFileSync(userImgPath, targetImgPath);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

  console.log("1. Navigating to app...");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });

  console.log("2. Uploading photo via Upload File button...");
  const uploadBtn = page.locator("button:has-text('Upload File')");
  await uploadBtn.scrollIntoViewIfNeeded();

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    uploadBtn.click(),
  ]);
  await fileChooser.setFiles(targetImgPath);

  console.log("3. Waiting for CropReview UI...");
  await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 30000 });
  await page.waitForTimeout(4000);

  console.log("4. Clicking primary approve/match button via getByRole...");
  const approveBtn = page.getByRole("button", { name: /Match|Approve/i }).last();
  await approveBtn.click({ force: true });

  console.log("5. Waiting for celebrity match results phase...");
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    const text = await page.locator("body").innerText();
    if (
      text.includes("TOP CELEBRITY MATCH") ||
      text.includes("Top Celebrity Match") ||
      text.includes("TOP DOPPELGÄNGER MATCH") ||
      text.includes("DOPPELGÄNGER MATCH") ||
      text.includes("Match Results") ||
      text.includes("SIMILARITY") ||
      text.includes("Match Found!")
    ) {
      console.log(`Phase finished at iteration ${i}!`);
      break;
    }
  }

  await page.screenshot({ path: join(screenshotsDir, "02_user_photo_celebrity_match.png") });

  const bodyText = await page.locator("body").innerText();
  console.log("\n--- FINAL CELEBRITY MATCH SCREEN TEXT ---\n");
  console.log(bodyText.slice(0, 1000));

  await browser.close();
}

runUserPhotoTest().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
