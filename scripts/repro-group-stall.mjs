import { chromium } from "playwright";
import { mkdirSync } from "fs";

mkdirSync("/workspace/screenshots/debug-stall", { recursive: true });
const IMG = process.env.IMG || "screenshots/debug-stall/group3-user-like.jpg";
const FACE = Number(process.env.FACE ?? 1); // which chip to select (0-based)
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1024, height: 1100 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 220)}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e}`));
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.locator("input[type='file']").first().setInputFiles(IMG);
await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 20000 });
await page.waitForFunction(() => /found \d+ faces|face found|Matching Face/i.test(document.body.innerText), undefined, { timeout: 20000 });
const chips = page.locator("button[role='option']");
const n = await chips.count();
console.log("faces found:", n);
if (n > FACE) await chips.nth(FACE).click();
await page.waitForTimeout(300);
const btn = page.locator("button:has-text('Match')").last();
console.log("button:", await btn.innerText());
await btn.click();
const t0 = Date.now();
let lastPct = "";
for (let i = 0; i < 40; i++) {  // 2 min budget
  await page.waitForTimeout(3000);
  const text = await page.locator("body").innerText();
  const pct = (text.match(/(\d+)%/) || [])[1] ?? "?";
  if (pct !== lastPct) { console.log(`t=${Math.round((Date.now()-t0)/1000)}s pct=${pct}`); lastPct = pct; }
  if (/TOP DOPPELGÄNGER|NEAREST GALLERY|POSSIBLE LOOK-ALIKE|No close look-alike|quality too low|not suitable|timed out|Couldn't analyze/i.test(text)) {
    console.log(`TERMINAL t=${Math.round((Date.now()-t0)/1000)}s ::`, text.split("\n").slice(2, 7).join(" | "));
    break;
  }
}
await page.screenshot({ path: "/workspace/screenshots/debug-stall/group3-final.png", fullPage: true });
console.log("=== errors/warnings ===");
for (const l of logs.filter((l) => /error|warn|Pipeline|telemetry|latenc/i.test(l)).slice(0, 25)) console.log(l);
await browser.close();
