#!/usr/bin/env node
/**
 * Accessibility smoke: run axe-core against the app's public routes and fail on
 * serious/critical violations. Requires a running dev or built server.
 *
 *   node scripts/a11y-smoke.mjs http://127.0.0.1:8080
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const url = process.argv[2] || "http://127.0.0.1:8080/";

const ROUTES = ["/", "/held-out-encode"];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

let failures = 0;

try {
  const page = await browser.newPage();
  for (const route of ROUTES) {
    await page.goto(new URL(route, url).href, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(800);
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async () => {
      const axe = window.axe;
      return axe.run(document, {
        resultTypes: ["violations"],
        rules: { "color-contrast": { enabled: false } },
      });
    });
    const serious = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact),
    );
    console.log(`[a11y] ${route}: ${results.violations.length} violations, ${serious.length} serious/critical`);
    for (const v of serious) {
      failures++;
      console.log(`  ${v.impact.toUpperCase()} ${v.id}: ${v.help}`);
      for (const node of v.nodes.slice(0, 3)) {
        console.log(`    -> ${node.target.join(" ")}`);
      }
    }
    // Minor violations are reported but do not gate.
    for (const v of results.violations.filter((x) => !["serious", "critical"].includes(x.impact))) {
      console.log(`  minor ${v.id}: ${v.nodes.length} node(s)`);
    }
  }
} finally {
  await browser.close();
}

process.exit(failures > 0 ? 1 : 0);
