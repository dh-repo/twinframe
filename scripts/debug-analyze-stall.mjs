import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";

mkdirSync("/workspace/screenshots/debug-stall", { recursive: true });

const IMG = process.env.IMG || "screenshots/debug-stall/group3-user-like.jpg";
const FACE = Number(process.env.FACE ?? 1);
const MAX_MS = Number(process.env.MAX_MS ?? 90000);

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
const page = await browser.newPage({ viewport: { width: 1024, height: 1100 } });
const logs = [];
page.on("console", (m) => {
  const text = `[${m.type()}] ${m.text()}`;
  logs.push(text);
  if (/\[Pipeline\]|\[Analyze\]|\[FaceAPI\]|Twinframe Telemetry/i.test(text)) {
    console.log(text.slice(0, 400));
  }
});
page.on("pageerror", (e) => {
  const text = `[pageerror] ${e}`;
  logs.push(text);
  console.log(text);
});

await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.locator("input[type='file']").first().setInputFiles(IMG);
await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 25000 });
await page.waitForFunction(
  () => /found \d+ faces|face found|Matching Face/i.test(document.body.innerText),
  undefined,
  { timeout: 25000 },
);
const chips = page.locator("button[role='option']");
const n = await chips.count();
console.log("faces found:", n);
if (n > FACE) await chips.nth(FACE).click();
await page.waitForTimeout(400);
const btn = page.locator("button:has-text('Match')").last();
console.log("button:", await btn.innerText());
const t0 = Date.now();
await btn.click();

let lastPct = "";
let stuckAt88Since = 0;
let terminal = "";
while (Date.now() - t0 < MAX_MS) {
  await page.waitForTimeout(1000);
  const text = await page.locator("body").innerText();
  const pct = (text.match(/(\d+)%/) || [])[1] ?? "?";
  const step = (text.match(/Detecting & aligning face|Extracting EdgeFace|Ranking celebrity|Initializing AccuFace/i) || [])[0] ?? "?";
  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (`${pct}|${step}` !== lastPct) {
    console.log(`t=${elapsed}s pct=${pct} step=${step}`);
    lastPct = `${pct}|${step}`;
  }
  if (pct === "88") {
    if (!stuckAt88Since) stuckAt88Since = Date.now();
  } else {
    stuckAt88Since = 0;
  }
  if (/TOP DOPPELGÄNGER|NEAREST GALLERY|POSSIBLE LOOK-ALIKE|No close look-alike|quality too low|not suitable|timed out|Couldn't analyze/i.test(text)) {
    terminal = text.split("\n").slice(0, 12).join(" | ");
    console.log(`TERMINAL t=${elapsed}s :: ${terminal}`);
    break;
  }
}

const elapsed = Math.round((Date.now() - t0) / 1000);
await page.screenshot({ path: "/workspace/screenshots/debug-stall/group3-debug.png", fullPage: true });
writeFileSync(
  "/workspace/screenshots/debug-stall/group3-console.log",
  logs.join("\n"),
);

const skipped = logs.some((l) => /faceapi:skip/.test(l));
const faceApiStart = logs.some((l) => /\[FaceAPI\] detectAndDescribe start/.test(l));
const pipelineDone = logs.some((l) => /rank:done|pipeline returned/.test(l));
const stuck88 = Boolean(stuckAt88Since) && Date.now() - stuckAt88Since > 8000 && !terminal;

console.log("=== SUMMARY ===");
console.log({
  elapsedSec: elapsed,
  terminal: Boolean(terminal),
  skippedFaceApi: skipped,
  faceApiCalled: faceApiStart,
  pipelineDone,
  stuck88,
});
if (stuck88) {
  console.error("STILL STUCK AT 88%");
  process.exitCode = 2;
} else if (!pipelineDone && !terminal) {
  console.error("NO TERMINAL STATE");
  process.exitCode = 3;
}

await browser.close();
