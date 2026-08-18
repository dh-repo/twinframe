import { chromium } from "playwright";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function cliArg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return fallback;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

export function verdictPresent(text) {
  return /DEAD RINGER|STRONG RESEMBLANCE|SOFT MATCH|DISTANT TWIN|Hold the phone|Photo quality|No close look-alike|timed out/i.test(
    text,
  );
}

export function friendComparePresent(text) {
  return /Friend mode/i.test(text) && /Closer twin:|Tied Twins|It's a tie/i.test(text);
}

export async function waitForBody(page, test, { timeoutMs, label }) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const text = await page.locator("body").innerText();
    if (test(text)) return text;
    await sleep(1000);
  }
  const text = await page.locator("body").innerText();
  throw new Error(`[${label}] timed out after ${timeoutMs}ms. Body:\n${text.slice(0, 1200)}`);
}

export async function uploadPhoto(page, filePath) {
  const input = page.locator("input[type='file']").first();
  await input.setInputFiles(filePath);
}

export async function approveCrop(page) {
  await waitForBody(
    page,
    (t) => /Choose a face|Approve & Match|Use this crop|Match Face|Retake/i.test(t),
    { timeoutMs: 45000, label: "crop-review" },
  );
  const matchBtn = page.getByRole("button", { name: /Approve & Match|Use this crop|Match /i }).last();
  await matchBtn.waitFor({ state: "visible", timeout: 45000 });
  for (let i = 0; i < 40; i++) {
    if (await matchBtn.isEnabled()) break;
    await sleep(500);
  }
  await matchBtn.click({ force: true });
}

export async function readSettledMatch(page) {
  await page.locator("[data-match-percent]").first().waitFor({ state: "attached", timeout: 8000 }).catch(() => {});
  const el = page.locator("[data-match-percent]").first();
  if ((await el.count()) === 0) {
    return { matchPercent: null, verdict: null };
  }
  const percent = Number(await el.getAttribute("data-match-percent"));
  return {
    matchPercent: Number.isFinite(percent) ? percent : null,
    verdict: await el.getAttribute("data-verdict"),
  };
}

export async function clickNamedButton(page, name) {
  const clicked = await page.evaluate((needle) => {
    const re = new RegExp(needle, "i");
    const btn = [...document.querySelectorAll("button")].find((el) =>
      re.test((el.textContent || "").trim()),
    );
    if (!btn) return false;
    btn.scrollIntoView({ block: "center", inline: "nearest" });
    btn.click();
    return true;
  }, name);
  return clicked;
}

export function launchChromium(options = {}) {
  return chromium.launch({
    headless: options.headless !== false,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
}

export async function openAppPage(browser, { url, videoDir, viewport = { width: 1280, height: 900 } }) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "reduce",
    recordVideo: videoDir
      ? { dir: videoDir, size: { width: viewport.width, height: viewport.height } }
      : undefined,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err?.message || err)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(1500);
  return { context, page, consoleErrors };
}
