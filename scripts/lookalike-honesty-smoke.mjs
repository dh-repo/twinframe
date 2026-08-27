#!/usr/bin/env node
/**
 * Headless check of /lookalike-honesty-verify: four fixture cards using the
 * live MatchRevealCard (no models). Requires a running dev or preview server.
 *
 *   node scripts/lookalike-honesty-smoke.mjs http://127.0.0.1:8080
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { engineCopyFailures } from "./lib/engine-copy-guard.mjs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const OUT = join(process.cwd(), "screenshots", "lookalike-honesty");
mkdirSync(OUT, { recursive: true });

let failures = 0;
function fail(msg) {
  failures++;
  console.log(`[honesty] FAIL: ${msg}`);
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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const target = new URL("/lookalike-honesty-verify", url).href;
  const resp = await page.goto(target, { waitUntil: "networkidle", timeout: 45_000 });
  if (!resp || resp.status() >= 400) {
    fail(`verify page HTTP ${resp?.status() ?? "none"}`);
  }
  await page.waitForTimeout(400);

  const cases = {
    "dead-ringer": page.locator('[data-honesty-case="dead-ringer"]'),
    "soft-match": page.locator('[data-honesty-case="soft-match"]'),
    "distant-twin": page.locator('[data-honesty-case="distant-twin"]'),
    refuse: page.locator('[data-honesty-case="refuse"]'),
  };

  for (const [id, loc] of Object.entries(cases)) {
    if ((await loc.count()) === 0) fail(`missing fixture ${id}`);
  }

  const dead = await cases["dead-ringer"].innerText();
  if (!/Dead Ringer/i.test(dead) || !/Florence Pugh/.test(dead)) {
    fail("dead-ringer missing stamp or name");
  }
  if (!/GALLERY ID CHANCE/i.test(dead)) fail("dead-ringer missing calibrated caption");
  const deadHero = await cases["dead-ringer"].locator("[data-hero-percent]").first().getAttribute("data-hero-percent");
  if (deadHero !== "82") fail(`dead-ringer hero should be 82, got ${deadHero}`);

  const soft = await cases["soft-match"].innerText();
  if (!/Soft Match/i.test(soft) || !/Zendaya/.test(soft)) fail("soft-match missing stamp or name");
  const softHero = await cases["soft-match"].locator("[data-hero-percent]").first().getAttribute("data-hero-percent");
  if (softHero !== "58") fail(`soft-match hero should be 58, got ${softHero}`);

  const distant = await cases["distant-twin"].innerText();
  if (!/Distant Twin/i.test(distant) || !/Keanu Reeves/.test(distant)) {
    fail("distant-twin missing stamp or name");
  }
  if (!/NOT A TWIN CLAIM/i.test(distant)) fail("distant-twin must mute the hero percent");
  const distantMuted = await cases["distant-twin"].locator("[data-score-muted]").first().getAttribute("data-score-muted");
  if (distantMuted !== "1") fail(`distant-twin must be muted, got ${distantMuted}`);
  const distantHero = await cases["distant-twin"].locator("[data-hero-percent]").first().getAttribute("data-hero-percent");
  if (distantHero) fail(`distant-twin must not hero a percent, got ${distantHero}`);
  if (!/NEAREST/i.test(distant)) fail("distant-twin 62% must stay labeled NEAREST");

  const refuse = await cases.refuse.innerText();
  if (!/No close look-alike found/i.test(refuse)) fail("refuse missing heading");
  if ((await cases.refuse.locator("[data-match-percent]").count()) > 0) {
    fail("refuse must not render a celebrity match percent");
  }
  if (/\b\d{2,3}%/.test(refuse)) fail("refuse leaked a celebrity percent");

  const body = await page.locator("body").innerText();
  for (const msg of engineCopyFailures("honesty-verify", body)) fail(msg);

  await page.screenshot({ path: join(OUT, "fixtures.png"), fullPage: true });
  console.log(`[honesty] wrote ${join(OUT, "fixtures.png")}`);
} finally {
  await browser.close();
}

process.exit(failures > 0 ? 1 : 0);
