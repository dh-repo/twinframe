import { chromium } from "playwright";
const IMG = process.env.IMG || "screenshots/debug-stall/fullbody-user-like.jpg";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.locator("input[type='file']").first().setInputFiles(IMG);
await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 25000 });
await page.waitForFunction(() => /found \d+ faces|face found|Matching Face|No face/i.test(document.body.innerText), undefined, { timeout: 25000 });
await page.locator("button:has-text('Match'), button:has-text('Approve')").last().click();
const t0 = Date.now();
let outcome = "still-analyzing";
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(3000);
  const text = await page.locator("body").innerText();
  if (/TOP DOPPELGÄNGER|STRONG VISUAL RESEMBLANCE|CLOSEST AVAILABLE MATCH|NEAREST GALLERY|POSSIBLE LOOK-ALIKE|NO STRONG DOUBLE/i.test(text)) { outcome = "results"; break; }
  if (/timed out|Couldn't analyze/i.test(text)) { outcome = "timeout"; break; }
  if (/quality too low|not suitable|No close look-alike/i.test(text)) { outcome = "blocked"; break; }
}
console.log(JSON.stringify({ outcome, elapsedS: Math.round((Date.now()-t0)/1000) }));
await page.screenshot({ path: "/workspace/screenshots/debug-stall/mobile-final.png", fullPage: true });
await browser.close();
process.exit(outcome === "results" ? 0 : 1);
