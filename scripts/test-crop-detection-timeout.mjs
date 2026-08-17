import { createCanvas, loadImage } from "canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const APP_URL = "http://127.0.0.1:8080/";
const SETTLE_TIMEOUT_MS = Number(
  process.env.CROP_SETTLE_TIMEOUT_MS ?? 12_000,
);

async function createGroupFixture(outputPath) {
  const sourcePaths = [
    "public/celebs/control/scarlett-johansson/001.jpg",
    "public/celebs/control/margot-robbie/001.jpg",
    "public/celebs/control/leonardo-dicaprio/001.jpg",
  ];
  const portraits = await Promise.all(sourcePaths.map((path) => loadImage(path)));
  const canvas = createCanvas(1536, 2048);
  const context = canvas.getContext("2d");

  const sky = context.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#d69a5b");
  sky.addColorStop(0.35, "#314b39");
  sky.addColorStop(1, "#263125");
  context.fillStyle = sky;
  context.fillRect(0, 0, canvas.width, canvas.height);

  portraits.forEach((portrait, index) => {
    const width = 400;
    const height = 720;
    const x = 118 + index * 450;
    const y = 400 + (index === 1 ? 80 : 0);
    context.drawImage(portrait, x, y, width, height);
  });

  writeFileSync(outputPath, canvas.toBuffer("image/jpeg", { quality: 0.88 }));
}

async function run() {
  const screenshotsDir = join(process.cwd(), "screenshots", "crop-timeout");
  mkdirSync(screenshotsDir, { recursive: true });
  const generatedImagePath = join(screenshotsDir, "realistic-group.jpg");
  const imagePath = process.env.CROP_TEST_IMAGE ?? generatedImagePath;
  if (!process.env.CROP_TEST_IMAGE) {
    await createGroupFixture(generatedImagePath);
  }

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
  const mobile = process.env.CROP_TEST_MOBILE === "1";
  const requireFace = process.env.CROP_REQUIRE_FACE === "1";
  const context = await browser.newContext({
    viewport: { width: 1024, height: 1100 },
    hasTouch: mobile,
    isMobile: mobile,
  });
  const page = await context.newPage();
  const startedAt = Date.now();
  const requests = [];

  page.on("response", (response) => {
    if (response.url().includes("/models/")) {
      requests.push({
        atMs: Date.now() - startedAt,
        status: response.status(),
        url: response.url(),
      });
    }
  });
  page.on("console", (message) => {
    if (
      message.type() === "warning" ||
      message.type() === "error"
    ) {
      console.log(`[browser:${message.type()}] ${message.text()}`);
    }
  });

  try {
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    const uploadStartedAt = Date.now();
    await page.locator("input[type='file']").first().setInputFiles(imagePath);
    await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 10_000 });

    await page.waitForFunction(
      () => {
        const body = document.body.innerText;
        return (
          body.includes("Face selected") ||
          /found \d+ faces/.test(body) ||
          body.includes("face found") ||
          body.includes("faces found") ||
          body.includes("No face locked") ||
          body.includes("No face found") ||
          body.includes("Detection failed") ||
          body.includes("Face detection failed") ||
          body.includes("Face detection timed out") ||
          body.includes("Timed out")
        );
      },
      undefined,
      { timeout: SETTLE_TIMEOUT_MS },
    );

    const bodyText = await page.locator("body").innerText();
    const elapsedMs = Date.now() - uploadStartedAt;
    const timedOut = bodyText.includes("Timed out");
    const foundFaces =
      bodyText.includes("Face selected") ||
      /(?:\d+ face found|\d+ faces found|found \d+ faces)/.test(bodyText);

    await page.screenshot({
      path: join(screenshotsDir, "crop-detection-result.png"),
      fullPage: true,
    });

    console.log(JSON.stringify({ elapsedMs, timedOut, foundFaces, requests }, null, 2));

    if (timedOut) {
      throw new Error(
        `Crop detection reached its timeout after ${elapsedMs}ms.`,
      );
    }
    if (requireFace && !foundFaces) {
      throw new Error("Automatic crop detection did not select a face.");
    }
    if (requireFace) {
      const approveButton = page
        .locator("button:has-text('Approve'), button:has-text('Match')")
        .last();
      if (await approveButton.isDisabled()) {
        throw new Error("Matching stayed disabled after detecting a face.");
      }
    }
    if (mobile && elapsedMs > 10_000) {
      throw new Error(
        `Mobile crop review took ${elapsedMs}ms to detect a face.`,
      );
    }
  } catch (error) {
    console.error(
      "Crop review text at failure:",
      await page.locator("body").innerText().catch(() => "<unavailable>"),
    );
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
