#!/usr/bin/env node
/**
 * Recorded Playwright agent for the standing-swing civilian fixture.
 *
 * Click through landing, packs, Photo Library, crop review, match, share,
 * pack rematch, and friend mode. Writes video + screenshots + report.json.
 *
 *   node scripts/swing-probe-tour.mjs --mode solo
 *   node scripts/swing-probe-tour.mjs --mode friend
 *   node scripts/swing-probe-tour.mjs --mode packs
 *   node scripts/swing-probe-tour.mjs --mode friend-start
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_APP_URL,
  PACK_CHIPS,
  SWING_FRIEND_PROBE,
  SWING_PROBE,
  assertFriendFixture,
  assertSwingFixture,
} from "./lib/swing-probe.mjs";
import {
  approveCrop,
  clickNamedButton,
  cliArg,
  friendComparePresent,
  launchChromium,
  openAppPage,
  readSettledMatch,
  sleep,
  uploadPhoto,
  verdictPresent,
  waitForBody,
} from "./lib/playwright-app.mjs";

const MODE = String(cliArg("mode", "solo"));
const IMAGE = resolve(cliArg("image", SWING_PROBE));
const FRIEND = resolve(cliArg("friend", SWING_FRIEND_PROBE));
const PACK_CHIP = String(cliArg("pack", "Everyone"));
const BASE = String(cliArg("url", DEFAULT_APP_URL));
const OUT = resolve(cliArg("out", `screenshots/swing-tour/${MODE}`));
const ANALYZE_WAIT_MS = Number(process.env.SWING_TOUR_ANALYZE_MS || process.env.LIVE_PATHWAY_ANALYZE_MS || 120000);

const MODES = new Set(["solo", "friend", "packs", "friend-start", "landing"]);

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name), fullPage: true });
}

function pickVerdict(text) {
  return (text.match(/DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN/) || [])[0] || null;
}

async function selectPack(page, label) {
  if (!label || label === "Everyone") return;
  await page.getByRole("button", { name: label, exact: true }).click();
  await sleep(200);
}

async function waitForResults(page) {
  const text = await waitForBody(page, verdictPresent, {
    timeoutMs: ANALYZE_WAIT_MS,
    label: "analyze-results",
  });
  const settled = await readSettledMatch(page);
  return {
    text,
    timedOut: /timed out/i.test(text),
    verdict: pickVerdict(text),
    openSetRefuse: /No close look-alike/i.test(text),
    qualityBlocked: /Photo quality|Hold the phone/i.test(text) && !pickVerdict(text),
    ...settled,
    excerpt: text.slice(0, 1600),
  };
}

async function enterCrop(page, filePath) {
  await uploadPhoto(page, filePath);
  await waitForBody(
    page,
    (t) => /Choose a face|Approve & Match|Use this crop|Finding face|Scanning for faces/i.test(t),
    { timeoutMs: 20000, label: "crop-review-enter" },
  );
}

async function openShare(page, report) {
  const shareBtn = page.getByRole("button", { name: /Share match|Share pair card|Share/i }).first();
  if ((await shareBtn.count()) === 0) {
    report.share = { skipped: true };
    return;
  }
  await shareBtn.click().catch(() => {});
  await sleep(600);
  const shareText = await page.locator("body").innerText();
  report.share = {
    stamp: /DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN|CLOSER TWIN|TIED TWINS/i.test(shareText),
    percent: /%/.test(shareText),
  };
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator("[role='dialog']").waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
}

async function rematchPacks(page, report, { skip = ["Everyone"] } = {}) {
  report.rematches = {};
  for (const label of PACK_CHIPS) {
    if (skip.includes(label)) continue;
    const chip = page.getByRole("button", { name: label, exact: true });
    if ((await chip.count()) === 0) continue;
    await chip.click();
    const rematch = await waitForResults(page);
    await shot(page, `rematch-${label.replace(/\s+/g, "-").toLowerCase()}.png`);
    report.rematches[label] = rematch;
    if (rematch.timedOut) break;
  }
}

async function addFriendFromResults(page, report) {
  const addFriend = page.getByRole("button", { name: /^Add a friend/i }).first();
  if ((await addFriend.count()) === 0) {
    report.friend = { skipped: "Add a friend button not shown" };
    return;
  }
  const clicked = await clickNamedButton(page, "^Add a friend");
  if (!clicked) throw new Error("Add a friend button was in the DOM but not clickable");
  await sleep(400);
  await enterCrop(page, FRIEND);
  await shot(page, "friend-crop.png");
  await approveCrop(page);
  const friendText = await waitForBody(page, friendComparePresent, {
    timeoutMs: ANALYZE_WAIT_MS,
    label: "friend-b",
  });
  const cards = page.locator("[data-friend-card]");
  const you = await cards.nth(0).getAttribute("data-match-percent").catch(() => null);
  const friend = await cards.nth(1).getAttribute("data-match-percent").catch(() => null);
  await shot(page, "friend.png");
  report.friend = {
    closerTwin: /Closer twin|CLOSER TWIN|Tied Twins/i.test(friendText),
    youPercent: you == null ? null : Number(you),
    friendPercent: friend == null ? null : Number(friend),
    excerpt: friendText.slice(0, 800),
  };
  await openShare(page, report);
}

async function runLandingClicks(page, report) {
  report.landingClicks = {};
  for (const label of PACK_CHIPS) {
    const chip = page.getByRole("button", { name: label, exact: true });
    if ((await chip.count()) === 0) {
      report.landingClicks[label] = false;
      continue;
    }
    await chip.click();
    await sleep(150);
    report.landingClicks[label] = true;
  }
  await page.getByRole("button", { name: "With a friend", exact: true }).click();
  await sleep(200);
  await page.getByRole("button", { name: "Just me", exact: true }).click();
  await sleep(200);
  await shot(page, "landing-clicked.png");
}

async function main() {
  if (!MODES.has(MODE)) {
    throw new Error(`Unknown --mode ${MODE}. Use: ${[...MODES].join(", ")}`);
  }
  assertSwingFixture();
  if (MODE === "friend" || MODE === "friend-start") assertFriendFixture();

  mkdirSync(OUT, { recursive: true });
  const report = {
    mode: MODE,
    image: IMAGE,
    friend: FRIEND,
    pack: PACK_CHIP,
    url: BASE,
    startedAt: new Date().toISOString(),
    steps: {},
  };

  const browser = await launchChromium();
  const { context, page, consoleErrors } = await openAppPage(browser, {
    url: BASE,
    videoDir: join(OUT, "video"),
  });

  try {
    await shot(page, "01-landing.png");
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

    await runLandingClicks(page, report.steps);
    if (MODE === "landing") {
      report.ok = true;
      return;
    }

    if (MODE === "friend-start") {
      await page.getByRole("button", { name: "With a friend", exact: true }).click();
      await sleep(200);
    }

    await selectPack(page, PACK_CHIP);
    await enterCrop(page, IMAGE);
    await shot(page, "02-crop.png");
    const cropText = await page.locator("body").innerText();
    report.steps.crop = {
      closeUpHint: /Hold the phone a bit further/i.test(cropText),
      foundFace: /Face selected|faces found|Approve & Match|Use this crop/i.test(cropText),
      excerpt: cropText.slice(0, 500),
    };
    await approveCrop(page);
    report.steps.results = await waitForResults(page);
    await shot(page, "03-results.png");

    if (report.steps.results.timedOut) {
      console.warn("Analysis timed out in the UI. Crop + upload path still recorded.");
      return;
    }

    if (MODE === "solo" || MODE === "packs") {
      await openShare(page, report.steps);
      await shot(page, "04-share.png");
    }

    if (MODE === "packs") {
      await rematchPacks(page, report.steps);
    }

    if (MODE === "friend" || MODE === "friend-start") {
      await addFriendFromResults(page, report.steps);
    }
  } finally {
    report.consoleErrors = consoleErrors.slice(0, 30);
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
    console.log(JSON.stringify(report, null, 2));
  }

  if (!report.steps.landing?.hasPacks) process.exit(2);
  if (report.steps.results?.timedOut) process.exit(3);
  if (Object.values(report.steps.rematches ?? {}).some((row) => row.timedOut)) process.exit(3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
