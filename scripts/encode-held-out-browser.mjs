#!/usr/bin/env node
/**
 * Playwright driver for /held-out-encode.
 * Writes public/celebs/held-out/descriptors.json for evaluate-held-out.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.HELDOUT_OUT
  ? path.resolve(process.env.HELDOUT_OUT)
  : path.join(ROOT, "public/celebs/held-out/descriptors.json");
const URL = process.env.HELDOUT_URL || "http://127.0.0.1:8080/held-out-encode";
const TIMEOUT_MS = Number(process.env.HELDOUT_TIMEOUT_MS || 2_400_000);

function log(msg) {
  console.log(`[held-out-encode] ${msg}`);
}

async function main() {
  log(`chromium → ${URL}`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (err) => log(`pageerror: ${err.message}`));

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const start = Date.now();
  let lastDone = -1;
  let lastSnapshot = [];
  let lastMeta = null;

  while (Date.now() - start < TIMEOUT_MS) {
    let state;
    try {
      state = await page.evaluate(() => ({
        progress: window.__heldoutProgress || null,
        total: window.__heldoutTotal ?? null,
        done: window.__heldoutDone ?? null,
        snapshot: window.__heldoutSnapshot ?? null,
        meta: window.__heldoutMeta ?? null,
        error: window.__heldoutError ?? null,
      }));
    } catch (err) {
      log(`context lost (${err.message}); flushing ${lastSnapshot.length}`);
      if (lastSnapshot.length) {
        writeOut(lastSnapshot, lastMeta);
        await browser.close();
        return;
      }
      throw err;
    }

    if (state.error) throw new Error(state.error);
    if (Array.isArray(state.snapshot) && state.snapshot.length > lastSnapshot.length) {
      lastSnapshot = state.snapshot;
    }
    if (state.meta) lastMeta = state.meta;
    if (state.progress && state.progress.done !== lastDone) {
      lastDone = state.progress.done;
      log(
        `progress ${state.progress.done}/${state.progress.total} last=${state.progress.lastId} ${state.progress.lastOk ? "OK" : "MISS"}`,
      );
    }
    if (Array.isArray(state.done) && state.done.length >= (state.total || state.done.length)) {
      writeOut(state.done, lastMeta);
      await browser.close();
      log("done");
      return;
    }
    await page.waitForTimeout(1500);
  }

  if (lastSnapshot.length) {
    writeOut(lastSnapshot, lastMeta);
    await browser.close();
    return;
  }
  await browser.close();
  throw new Error(`timeout after ${TIMEOUT_MS}ms`);
}

function writeOut(results, meta) {
  const ok = results.filter((r) => r.ok && r.descriptor?.length >= 128);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        version: "2.0.0",
        model: meta?.model || "unknown",
        alignment: meta?.alignment || "unknown",
        dim: meta?.dim || (ok[0]?.descriptor.length ?? 0),
        count: ok.length,
        cases: ok,
      },
      null,
      2,
    ),
  );
  log(`wrote ${OUT} ${ok.length}/${results.length} ok`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
