import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const out = "/workspace/screenshots/keep-testing";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1024, height: 1100 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
  const uploadStarted = Date.now();
  await page.locator("input[type='file']:not([capture])").first()
    .setInputFiles("/workspace/screenshots/crop-timeout/realistic-group.jpg");
  await page.waitForSelector("h2:has-text('Choose a face')", { timeout: 20000 });
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return (
        /found \d+ faces/i.test(t) ||
        /\d+ faces found/i.test(t) ||
        /\d+ face found/i.test(t) ||
        t.includes("Face selected") ||
        t.includes("Matching Face") ||
        t.includes("No face found") ||
        t.includes("Detection failed") ||
        t.includes("timed out")
      );
    },
    undefined,
    { timeout: 20000 },
  );
  const settleMs = Date.now() - uploadStarted;
  await page.screenshot({ path: join(out, "pw-faces-found.png"), fullPage: true });

  const chips = page.locator("button[role='option']");
  const chipCount = await chips.count();
  console.log("settleMs", settleMs, "chips", chipCount);
  for (let i = 0; i < chipCount; i++) {
    console.log("before", i, "aria", await chips.nth(i).getAttribute("aria-selected"));
  }

  if (chipCount < 2) throw new Error(`Expected >=2 faces, got ${chipCount}`);

  await chips.nth(1).click();
  await page.waitForTimeout(500);
  const aria0 = await chips.nth(0).getAttribute("aria-selected");
  const aria1 = await chips.nth(1).getAttribute("aria-selected");
  const matchBtn = await page.locator("button:has-text('Match')").last().innerText();
  console.log({ aria0, aria1, matchBtn });
  await page.screenshot({ path: join(out, "pw-after-face2.png"), fullPage: true });

  const selected = aria1 === "true" && /Face 2/i.test(matchBtn);
  let analyzingStarted = false;
  if (selected) {
    await page.locator("button:has-text('Match')").last().click();
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerText();
    analyzingStarted =
      /analyz|scanning|matching|embedding|looking for|finding your|TOP MATCH|Low face confidence|timed out/i.test(body);
    console.log("after approve snippet:", body.split("\n").slice(0, 14).join(" | "));
    await page.screenshot({ path: join(out, "pw-after-approve.png"), fullPage: true });
  }

  console.log(JSON.stringify({ selected, analyzingStarted, settleMs, consoleErrors: consoleErrors.slice(0, 10) }, null, 2));
  await browser.close();
  process.exit(selected ? 0 : 2);
} catch (e) {
  console.error("FAIL", e);
  console.error("BODY", await page.locator("body").innerText().catch(() => "<none>"));
  await page.screenshot({ path: join(out, "pw-face2-fail.png"), fullPage: true }).catch(() => {});
  await browser.close();
  process.exit(1);
}
