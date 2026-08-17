import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.MOBILE_QA_URL || "http://127.0.0.1:8080/";
const OUT = process.env.MOBILE_QA_OUT || "screenshots/mobile_access";

const DEVICES = [
  { name: "iPhone_SE", width: 375, height: 667, dpr: 2 },
  { name: "iPhone_15_Pro", width: 393, height: 852, dpr: 3 },
  { name: "Pixel_7", width: 412, height: 915, dpr: 2.625 },
];

mkdirSync(OUT, { recursive: true });

const failures = [];

function assert(ok, msg) {
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch({ headless: true });

for (const device of DEVICES) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent:
      device.name.startsWith("iPhone")
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  const page = await context.newPage();
  const prefix = `${device.name}:`;

  try {
    const res = await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert(res?.ok(), `${prefix} homepage HTTP ${res?.status()}`);
    await page.waitForSelector("text=Upload Photo", { timeout: 15000 });

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
    assert(
      overflow.scrollWidth <= overflow.clientWidth + 2,
      `${prefix} horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}`,
    );

    const camera = page.getByRole("button", { name: /use my camera/i });
    const library = page.getByRole("button", { name: /photo library/i });
    assert(await camera.isVisible(), `${prefix} camera CTA missing`);
    assert(await library.isVisible(), `${prefix} library CTA missing`);

    const cameraBox = await camera.boundingBox();
    assert((cameraBox?.height ?? 0) >= 44, `${prefix} camera tap target ${cameraBox?.height}px`);

    await page.screenshot({
      path: join(OUT, `${device.name}_01_home.png`),
      fullPage: true,
    });

    await page.getByRole("button", { name: /explore/i }).first().click();
    await page.waitForSelector("text=Star Gallery", { timeout: 10000 });
    const search = page.getByPlaceholder(/search stars/i);
    assert(await search.isVisible(), `${prefix} gallery search missing`);
    const fontSize = await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert(fontSize >= 16, `${prefix} search font ${fontSize}px would zoom iOS`);
    await page.screenshot({
      path: join(OUT, `${device.name}_02_gallery.png`),
      fullPage: false,
    });
    await page.getByRole("button", { name: /close gallery/i }).click();

    await camera.click();
    await page.waitForSelector('[aria-label="Camera capture"]', { timeout: 8000 });
    await page.screenshot({
      path: join(OUT, `${device.name}_03_camera.png`),
      fullPage: false,
    });
    await page.getByRole("button", { name: /close camera/i }).click();
  } catch (err) {
    failures.push(`${prefix} ${err instanceof Error ? err.message : String(err)}`);
    await page.screenshot({
      path: join(OUT, `${device.name}_error.png`),
      fullPage: true,
    }).catch(() => {});
  } finally {
    await context.close();
  }
}

await browser.close();

if (failures.length) {
  console.error("MOBILE QA FAILED");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log(`MOBILE QA OK (${DEVICES.length} viewports) → ${OUT}`);
