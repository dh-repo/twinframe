import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import createCanvas from "canvas";

const DEVICES = [
  {
    name: "iPhone_SE",
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  },
  {
    name: "iPhone_15_Pro",
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  {
    name: "Pixel_7",
    width: 412,
    height: 915,
    deviceScaleFactor: 2.6,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
  },
  {
    name: "Galaxy_S20",
    width: 360,
    height: 800,
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (Linux; Android 10; SM-G980F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36",
  },
  {
    name: "iPad_Mini",
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  },
];

async function generateTestPortrait(outPath) {
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

  const buffer = canvas.toBuffer("image/jpeg", { quality: 0.9 });
  writeFileSync(outPath, buffer);
}

async function runMobileSuite() {
  console.log("=== COMPREHENSIVE MOBILE COMPATIBILITY VERIFICATION SUITE ===");
  const outDir = join(process.cwd(), "screenshots", "mobile_qa");
  mkdirSync(outDir, { recursive: true });

  const portraitPath = join(outDir, "test_portrait.jpg");
  await generateTestPortrait(portraitPath);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const summaryResults = [];

  for (const dev of DEVICES) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Testing Device: ${dev.name} (${dev.width}x${dev.height}, Scale: ${dev.deviceScaleFactor})`);
    console.log(`--------------------------------------------------`);

    const context = await browser.newContext({
      viewport: { width: dev.width, height: dev.height },
      deviceScaleFactor: dev.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
      userAgent: dev.userAgent,
    });

    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));

    try {
      // 1. Navigate to Home
      console.log(`  1. Loading http://127.0.0.1:8080/ ...`);
      await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);

      // Check horizontal overflow
      const hasHorizontalScrollHome = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      console.log(`     Horizontal Scroll Overflow (Home): ${hasHorizontalScrollHome ? "YES (FAIL)" : "NO (PASS)"}`);

      await page.screenshot({ path: join(outDir, `${dev.name}_01_home.png`), fullPage: false });

      // 2. Open Star Gallery Modal
      console.log(`  2. Opening Star Gallery Modal...`);
      const galleryBtn = page.locator("button:has-text('Explore Star Gallery')").first();
      await galleryBtn.click();
      await page.waitForTimeout(1200);

      const hasHorizontalScrollGallery = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      console.log(`     Horizontal Scroll Overflow (Star Gallery): ${hasHorizontalScrollGallery ? "YES (FAIL)" : "NO (PASS)"}`);

      await page.screenshot({ path: join(outDir, `${dev.name}_02_gallery_modal.png`), fullPage: false });

      // Close modal
      const closeBtn = page.locator("button[aria-label='Close'], button:has(svg.lucide-x)").first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      }

      // 3. Upload Photo -> Crop Review
      console.log(`  3. Uploading photo for Crop Review...`);
      const fileInput = page.locator("input[type='file']").first();
      await fileInput.setInputFiles(portraitPath, { force: true });

      await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 15000 });
      await page.waitForTimeout(1200);

      const hasHorizontalScrollCrop = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      console.log(`     Horizontal Scroll Overflow (Crop Review): ${hasHorizontalScrollCrop ? "YES (FAIL)" : "NO (PASS)"}`);

      await page.screenshot({ path: join(outDir, `${dev.name}_03_crop_review.png`), fullPage: false });

      // 4. Approve & Match -> Results
      console.log(`  4. Approving crop & analyzing face...`);
      const approveBtn = page.locator("button:has-text('Approve'), button:has-text('Match')").last();
      await approveBtn.click();

      let matchSuccess = false;
      for (let i = 0; i < 35; i++) {
        await page.waitForTimeout(1000);
        const text = await page.locator("body").innerText();
        if (
          text.includes("TOP CELEBRITY MATCH") ||
          text.includes("TOP DOPPELGÄNGER MATCH") ||
          text.includes("CLOSE DOPPELGÄNGERS") ||
          text.includes("See low-confidence matches")
        ) {
          matchSuccess = true;
          break;
        }
      }

      const lowConfidenceBtn = page.locator("button:has-text('See low-confidence matches')").first();
      if (await lowConfidenceBtn.count() > 0) {
        await lowConfidenceBtn.click();
        await page.waitForTimeout(1000);
      }

      const hasHorizontalScrollResults = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      console.log(`     Horizontal Scroll Overflow (Results): ${hasHorizontalScrollResults ? "YES (FAIL)" : "NO (PASS)"}`);

      await page.screenshot({ path: join(outDir, `${dev.name}_04_match_results.png`), fullPage: false });

      const passed =
        !hasHorizontalScrollHome &&
        !hasHorizontalScrollGallery &&
        !hasHorizontalScrollCrop &&
        !hasHorizontalScrollResults &&
        matchSuccess &&
        consoleErrors.length === 0 &&
        pageErrors.length === 0;

      summaryResults.push({
        device: dev.name,
        resolution: `${dev.width}x${dev.height}`,
        passed,
        matchSuccess,
        overflow: hasHorizontalScrollHome || hasHorizontalScrollGallery || hasHorizontalScrollCrop || hasHorizontalScrollResults,
        consoleErrorsCount: consoleErrors.length,
        pageErrorsCount: pageErrors.length,
      });
    } catch (err) {
      console.error(`❌ ERROR testing device ${dev.name}:`, err);
      summaryResults.push({
        device: dev.name,
        resolution: `${dev.width}x${dev.height}`,
        passed: false,
        error: String(err?.message || err),
      });
    } finally {
      await context.close();
    }
  }

  await browser.close();

  console.log(`\n==================================================`);
  console.log(`SUMMARY OF MOBILE COMPATIBILITY AUDIT RESULTS`);
  console.log(`==================================================`);
  console.table(summaryResults);

  const allPassed = summaryResults.every((r) => r.passed);
  if (allPassed) {
    console.log("\n🎉 ALL MOBILE VIEWPORTS PASSED COMPLETE COMPATIBILITY VERIFICATION! 🎉\n");
    process.exit(0);
  } else {
    console.error("\n❌ MOBILE COMPATIBILITY VERIFICATION FAILED FOR SOME DEVICES.\n");
    process.exit(1);
  }
}

runMobileSuite().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
