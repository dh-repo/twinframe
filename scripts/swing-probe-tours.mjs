#!/usr/bin/env node
/**
 * Launch parallel Playwright agents against the standing-swing fixture.
 * Each child records its own video + screenshots under screenshots/swing-tour/.
 *
 *   node scripts/swing-probe-tours.mjs
 *   node scripts/swing-probe-tours.mjs --only solo,friend
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cliArg } from "./lib/playwright-app.mjs";
import { assertFriendFixture, assertSwingFixture } from "./lib/swing-probe.mjs";

const ALL_JOBS = [
  { mode: "landing", out: "screenshots/swing-tour/landing" },
  { mode: "solo", out: "screenshots/swing-tour/solo" },
  { mode: "friend", out: "screenshots/swing-tour/friend" },
  { mode: "friend-start", out: "screenshots/swing-tour/friend-start" },
  { mode: "packs", out: "screenshots/swing-tour/packs" },
];

const onlyRaw = cliArg("only", "");
const only = onlyRaw
  ? String(onlyRaw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : ALL_JOBS.map((j) => j.mode);
const jobs = ALL_JOBS.filter((j) => only.includes(j.mode));
const concurrency = Number(cliArg("concurrency", 1));

function runJob(job) {
  return new Promise((resolveJob) => {
    const child = spawn(
      process.execPath,
      ["scripts/swing-probe-tour.mjs", "--mode", job.mode, "--out", job.out],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(`[${job.mode}] ${chunk}`);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(`[${job.mode}] ${chunk}`);
    });
    child.on("close", (code) => {
      resolveJob({ ...job, code: code ?? 1, stdout, stderr });
    });
  });
}

async function runPool(items, limit, worker) {
  const results = [];
  let cursor = 0;
  async function next() {
    const index = cursor++;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}

assertSwingFixture();
assertFriendFixture();
mkdirSync("screenshots/swing-tour", { recursive: true });

const startedAt = new Date().toISOString();
const results = await runPool(jobs, Math.max(1, concurrency), runJob);
const summary = {
  startedAt,
  finishedAt: new Date().toISOString(),
  concurrency,
  results: results.map(({ mode, out, code }) => ({ mode, out, code })),
};
writeFileSync(resolve("screenshots/swing-tour/summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (results.some((row) => row.code !== 0)) process.exit(1);
