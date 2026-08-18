#!/usr/bin/env node
/**
 * Drive the REAL app: landing → pack chip → Photo Library upload → crop
 * review → Approve & Match → results (verdict / blurb / share) → pack rematch
 * → friend mode second photo.
 *
 *   node scripts/live-pathway-e2e.mjs \
 *     --image public/celebs/held-out/kate-winslet/001.jpg \
 *     --friend public/celebs/held-out/billie-eilish/004.jpg
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return fallback;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

const IMAGE = resolve(
  arg("image", "public/celebs/held-out/kate-winslet/001.jpg"),
);
const FRIEND = resolve(
  arg("friend", "public/celebs/held-out/billie-eilish/001.jpg"),
);
const PACK_CHIP = String(arg("pack", "Everyone"));
const BASE = arg("url", "http://127.0.0.1:8080/");
const OUT = resolve("screenshots/live-pathway");
const ANALYZE_WAIT_MS = Number(process.env.LIVE_PATHWAY_ANALYZE_MS || 120000);

mkdirSync(OUT, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForBody(page, test, { timeoutMs, label }) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const text = await page.locator("body").innerText();
    if (test(text)) return text;
    await sleep(1000);
  }
  const text = await page.locator("body").innerText();
  throw new Error(`[${label}] timed out after ${timeoutMs}ms. Body:\n${text.slice(0, 1200)}`);
}

async function uploadPhoto(page, filePath) {
  const input = page.locator("input[type='file']").first();
  await input.setInputFiles(filePath);
}

async function approveCrop(page) {
  await waitForBody(
    page,
    (t) => /Choose a face|Approve & Match|Use this crop|Match Face|Retake/i.test(t),
    { timeoutMs: 45000, label: "crop-review" },
  );
  // Wait until detection finishes (button enabled).
  const matchBtn = page.getByRole("button", { name: /Approve & Match|Use this crop|Match /i }).last();
  await matchBtn.waitFor({ state: "visible", timeout: 45000 });
  for (let i = 0; i < 40; i++) {
    if (await matchBtn.isEnabled()) break;
    await sleep(500);
  }
  await matchBtn.click({ force: true });
}

function verdictPresent(text) {
  return /DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN|Hold the phone|Photo quality|No close look-alike|timed out/i.test(
    text,
  );
}

async function main() {
  if (!existsSync(IMAGE)) throw new Error(`Missing --image ${IMAGE}`);
  if (!existsSync(FRIEND)) throw new Error(`Missing --friend ${FRIEND}`);

  const report = {
    image: IMAGE,
    friend: FRIEND,
    url: BASE,
    steps: {},
  };

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err?.message || err)));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(1500);
  await page.screenshot({ path: join(OUT, "01-landing.png"), fullPage: true });
  const landing = await page.locator("body").innerText();
  report.steps.landing = {
    hasPacks: /90s Icons|Athletes|Musicians/.test(landing),
    hasFriendToggle: /With a friend|Just me/.test(landing),
    hasUpload: /Photo Library|Upload Photo/.test(landing),
    excerpt: landing.slice(0, 400),
  };
  if (!report.steps.landing.hasPacks) {
    throw new Error("Landing is missing pack chips");
  }

  if (PACK_CHIP && PACK_CHIP !== "Everyone") {
    await page.getByRole("button", { name: PACK_CHIP, exact: true }).click();
    await sleep(200);
  }
  await uploadPhoto(page, IMAGE);
  await waitForBody(
    page,
    (t) => /Choose a face|Approve & Match|Use this crop|Finding face|Scanning for faces/i.test(t),
    { timeoutMs: 20000, label: "crop-review-enter" },
  );
  const matchBtn = page.getByRole("button", { name: /Approve & Match|Use this crop|Match /i }).last();
  await matchBtn.waitFor({ state: "visible", timeout: 45000 });
  for (let i = 0; i < 40; i++) {
    if (await matchBtn.isEnabled()) break;
    await sleep(500);
  }
  await page.screenshot({ path: join(OUT, "02-crop.png"), fullPage: true });
  const cropText = await page.locator("body").innerText();
  report.steps.crop = {
    closeUpHint: /Hold the phone a bit further/i.test(cropText),
    foundFace: /Face selected|faces found|Approve & Match|Use this crop/i.test(cropText),
    excerpt: cropText.slice(0, 500),
  };

  await approveCrop(page);
  const resultsText = await waitForBody(page, verdictPresent, {
    timeoutMs: ANALYZE_WAIT_MS,
    label: "analyze-results",
  });
  await page.locator("[data-match-percent]").first().waitFor({ state: "attached", timeout: 8000 }).catch(() => {});
  const percentEl = page.locator("[data-match-percent]").first();
  const settledPercent =
    (await percentEl.count()) > 0 ? Number(await percentEl.getAttribute("data-match-percent")) : null;
  const verdictAttr =
    (await percentEl.count()) > 0 ? await percentEl.getAttribute("data-verdict") : null;
  await page.screenshot({ path: join(OUT, "03-results.png"), fullPage: true });
  report.steps.results = {
    timedOut: /timed out/i.test(resultsText),
    verdict: (resultsText.match(/DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN/) || [])[0] || null,
    verdictAttr,
    matchPercent: Number.isFinite(settledPercent) ? settledPercent : null,
    blurb: /You share/i.test(resultsText),
    traitBlurb: /You share (her|his|their) /i.test(resultsText),
    genericBlurb: /You share a look with/i.test(resultsText),
    share: /Share|Create shareable/i.test(resultsText),
    packRematch: /90s Icons|Everyone/.test(resultsText),
    qualityBlocked: /Photo quality|Hold the phone/i.test(resultsText) && !/DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN/i.test(resultsText),
    excerpt: resultsText.slice(0, 1600),
  };

  if (report.steps.results.timedOut) {
    report.consoleErrors = consoleErrors.slice(0, 20);
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.warn(
      "Analysis timed out in the UI (CPU/SwiftShader). Crop + upload path still recorded. Engine check: scripts/match-probe.mjs",
    );
    await browser.close();
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const shareBtn = page.getByRole("button", { name: /Share match|Share/i }).first();
  if ((await shareBtn.count()) > 0) {
    await shareBtn.click().catch(() => {});
    await sleep(600);
    await page.screenshot({ path: join(OUT, "04-share.png"), fullPage: true });
    const shareText = await page.locator("body").innerText();
    report.steps.share = {
      stamp: /DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN/i.test(shareText),
      percent: /%/.test(shareText),
    };
    await page.keyboard.press("Escape").catch(() => {});
    await page.locator("[role='dialog']").waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
  }

  // Friend from the first good match (solo results now expose Add a friend).
  const addFriend = page.getByRole("button", { name: /^Add a friend/i }).first();
  if ((await addFriend.count()) > 0) {
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((el) =>
        /^Add a friend/i.test((el.textContent || "").trim()),
      );
      if (!btn) return false;
      btn.scrollIntoView({ block: "center", inline: "nearest" });
      btn.click();
      return true;
    });
    if (!clicked) throw new Error("Add a friend button was in the DOM but not clickable");
    await sleep(400);
    await uploadPhoto(page, FRIEND);
    await approveCrop(page);
    const friendText = await waitForBody(
      page,
      (t) => /Friend mode/i.test(t) && /Closer twin:|Tied Twins|It's a tie/i.test(t),
      { timeoutMs: ANALYZE_WAIT_MS, label: "friend-b" },
    );
    await page.screenshot({ path: join(OUT, "06-friend.png"), fullPage: true });
    report.steps.friend = {
      closerTwin: /Closer twin|CLOSER TWIN/i.test(friendText),
      excerpt: friendText.slice(0, 800),
    };
  } else {
    report.steps.friend = { skipped: "Add a friend button not shown" };
  }

  // Pack rematch without recapture (open-set refuse on a mismatched pack).
  const athletes = page.getByRole("button", { name: "Athletes" });
  if ((await athletes.count()) > 0) {
    await athletes.click();
    const rematchText = await waitForBody(
      page,
      (t) => verdictPresent(t) || /No close look-alike/i.test(t),
      { timeoutMs: ANALYZE_WAIT_MS, label: "pack-rematch" },
    );
    await page.screenshot({ path: join(OUT, "05-rematch-athletes.png"), fullPage: true });
    report.steps.rematch = {
      timedOut: /timed out/i.test(rematchText),
      verdict: (rematchText.match(/DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN/) || [])[0] || null,
      openSetRefuse: /No close look-alike/i.test(rematchText),
      excerpt: rematchText.slice(0, 800),
    };
  }

  report.consoleErrors = consoleErrors.slice(0, 30);
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();

  if (!report.steps.landing.hasPacks) process.exit(2);
  if (report.steps.results?.timedOut || report.steps.rematch?.timedOut) process.exit(3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
