import { chromium } from "playwright";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "/Users/damian/Downloads/IMG_3936.jpeg";
const OUT = join(process.cwd(), "screenshots", "img-3936-extended");
mkdirSync(OUT, { recursive: true });
const localImg = join(OUT, "IMG_3936.jpeg");
copyFileSync(SRC, localImg);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForResults(page, label, maxSec = 90) {
  for (let i = 0; i < maxSec; i++) {
    const text = await page.locator("body").innerText();
    if (
      /SIMILARITY|look-alike|No close|No face|celebrity|doppel|nearest in the gallery|Match Found/i.test(
        text,
      ) &&
      !/Analyzing|Choose a face|Loading face model/i.test(text)
    ) {
      console.log(`[${label}] results after ${i}s`);
      return text;
    }
    if (/timed out|Something went wrong|Could not/i.test(text) && i > 8) {
      console.log(`[${label}] error UI after ${i}s`);
      return text;
    }
    await sleep(1000);
  }
  return page.locator("body").innerText();
}

async function collectFaceChips(page) {
  const chips = page.locator("button, [role='button']").filter({
    hasText: /Person|Face|Primary/i,
  });
  const n = await chips.count();
  const labels = [];
  for (let i = 0; i < n; i++) {
    labels.push((await chips.nth(i).innerText()).replace(/\s+/g, " ").trim());
  }
  return { n, labels };
}

async function run() {
  const report = { image: SRC, size: "4284x5712", runs: [] };
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  console.log("1. Open app");
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1500);
  await page.screenshot({ path: join(OUT, "01-home.png"), fullPage: true });

  console.log("2. Upload IMG_3936.jpeg");
  const fileInput = page.locator("input[type='file']");
  await fileInput.setInputFiles(localImg);

  console.log("3. Wait for crop review / face detect");
  await page.waitForSelector("h2:has-text('Choose a face'), h2:has-text('Review'), button:has-text('Match')", {
    timeout: 60000,
  });
  // Face detect on 24MP photo can take a bit
  for (let i = 0; i < 40; i++) {
    const t = await page.locator("body").innerText();
    if (!/Loading face model|Detecting|Scanning faces/i.test(t) || /Person|Face 1|2 faces/i.test(t)) {
      if (i > 2) break;
    }
    await sleep(1000);
  }
  await sleep(1500);
  await page.screenshot({ path: join(OUT, "02-crop-review.png"), fullPage: true });
  const cropText = await page.locator("body").innerText();
  const chips = await collectFaceChips(page);
  console.log("Crop review chips:", chips);
  report.cropReview = { chips, excerpt: cropText.slice(0, 1200) };

  console.log("4. Approve primary face");
  const approve = page.getByRole("button", { name: /Match|Approve/i }).last();
  await approve.click({ force: true });

  const primaryText = await waitForResults(page, "primary");
  await page.screenshot({ path: join(OUT, "03-primary-results.png"), fullPage: true });
  report.runs.push({ face: "primary", text: primaryText.slice(0, 2500) });
  console.log("\n--- PRIMARY RESULTS ---\n", primaryText.slice(0, 1800));

  const landmarksTab = page.getByRole("tab", { name: /Landmarks/i });
  if (await landmarksTab.count()) {
    await landmarksTab.click();
    await sleep(800);
    await page.screenshot({ path: join(OUT, "04-primary-landmarks.png"), fullPage: true });
    report.runs[0].landmarks = (await page.locator("body").innerText()).slice(0, 1500);
    console.log("\n--- PRIMARY LANDMARKS ---\n", report.runs[0].landmarks);
  }

  console.log("5. Reset and analyze second face if picker exists");
  const reset = page.getByRole("button", { name: /Try another|Try again|Retake/i }).first();
  if (await reset.count()) {
    await reset.click();
    await sleep(800);
  } else {
    await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
    await sleep(1000);
  }

  await page.locator("input[type='file']").setInputFiles(localImg);
  await page.waitForSelector("h2:has-text('Choose a face'), button:has-text('Match')", {
    timeout: 60000,
  });
  for (let i = 0; i < 30; i++) {
    const t = await page.locator("body").innerText();
    if (/Person|Face /i.test(t)) break;
    await sleep(1000);
  }
  await sleep(1000);

  const chips2 = await collectFaceChips(page);
  report.secondPicker = chips2;
  console.log("Second pass chips:", chips2);

  // Prefer a non-primary chip (the girl with glasses)
  const alt = page.locator("button").filter({ hasText: /Person 2|Face 2|Right|Child/i }).first();
  if (await alt.count()) {
    await alt.click({ force: true });
    await sleep(600);
  } else if (chips2.n > 1) {
    // click the last face chip in the picker row
    const faceBtns = page.locator("[class*='thumb'], button").filter({ hasText: /Person|Face/i });
    const c = await faceBtns.count();
    if (c > 1) await faceBtns.nth(c - 1).click({ force: true });
  }
  await page.screenshot({ path: join(OUT, "05-second-face-selected.png"), fullPage: true });

  await page.getByRole("button", { name: /Match|Approve/i }).last().click({ force: true });
  const secondText = await waitForResults(page, "second");
  await page.screenshot({ path: join(OUT, "06-second-results.png"), fullPage: true });
  report.runs.push({ face: "second", text: secondText.slice(0, 2500) });
  console.log("\n--- SECOND FACE RESULTS ---\n", secondText.slice(0, 1800));

  if (await page.getByRole("tab", { name: /Landmarks/i }).count()) {
    await page.getByRole("tab", { name: /Landmarks/i }).click();
    await sleep(800);
    await page.screenshot({ path: join(OUT, "07-second-landmarks.png"), fullPage: true });
  }

  report.consoleErrors = consoleErrors.slice(0, 30);
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("\nSaved report + screenshots to", OUT);
  console.log("Console errors:", consoleErrors.length);
  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
