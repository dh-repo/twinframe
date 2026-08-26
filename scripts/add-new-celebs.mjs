#!/usr/bin/env node
/**
 * Turnkey "add N new celebrities to the gallery" pipeline. Run this AFTER
 * fetch-new-celebs.ts has put a portrait at public/celebs/<id>.jpg for every
 * entry in your input file, and after `npm run model:ensure` (or `npm run
 * build`) has downloaded public/models/adaface_ir101_webface12m.onnx — this
 * script needs both and will refuse to run without them.
 *
 * What it does, per id with a portrait on disk:
 *   1. Generate the 96/192 webp thumbnails (scripts/generate-thumbs.mjs).
 *   2. Boot the dev server and drive the real /held-out-encode?engine=adaface
 *      route (scripts/encode-held-out-browser.mjs) — the exact production
 *      SCRFD + AdaFace pipeline, not a reimplementation — to get a 512-d
 *      AdaFace-space descriptor plus face-api age/gender demographics.
 *   3. Append the slot to the shipped gallery (scripts/add-gallery-slot.mjs).
 *      Demographics are never fabricated: if face-api couldn't read age or
 *      gender for someone, that person is skipped and reported, not enrolled
 *      with a guessed value.
 *   4. Bump GALLERY_VERSION in src/lib/face/embeddings.ts so returning
 *      visitors don't keep the stale cached gallery.
 *   5. Run the same verification chain night-ci.yml runs (held-out floor,
 *      calibration drift check, full-catalog parity floor) and print PASS/FAIL
 *      for each — it does NOT revert anything on failure, that's your call.
 *
 * Usage:
 *   node scripts/add-new-celebs.mjs --input scripts/new-celebrities.json
 *
 * After it finishes: review `git status`/`git diff` (public/celebs/*, the
 * embeddings.ts version bump, reports/*), read the verification output —
 * if calibration drifted, scripts/refit-calibration.ts printed the refit
 * coefficients to consider adopting in src/lib/face/calibration.ts — then
 * commit.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const MODEL_PATH = path.join(ROOT, "public/models/adaface_ir101_webface12m.onnx");
const MANIFEST_PATH = path.join(CELEBS, "new-celebs-manifest.json");
const DESCRIPTORS_PATH = path.join(ROOT, "reports/new-celebs-descriptors.json");
const DEV_URL = "http://127.0.0.1:8080/";
const DEV_HEALTHCHECK_TIMEOUT_MS = 60_000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function startDevServer() {
  const child = spawn("npm", ["run", "dev", "--", "--strictPort"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logPath = path.join(ROOT, "reports/add-new-celebs-dev-server.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.createWriteStream(logPath);
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return child;
}

function stopDevServer(child) {
  if (!child || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function bumpGalleryVersion() {
  const file = path.join(ROOT, "src/lib/face/embeddings.ts");
  const src = fs.readFileSync(file, "utf8");
  const match = src.match(/const GALLERY_VERSION = "(\d+)\.(\d+)\.(\d+)"/);
  if (!match) {
    throw new Error(
      `could not find GALLERY_VERSION in ${path.relative(ROOT, file)} — bump it by hand and re-run verification`,
    );
  }
  const [full, major, minor] = match;
  const next = `${major}.${Number(minor) + 1}.0`;
  const patched = src.replace(full, `const GALLERY_VERSION = "${next}"`);
  fs.writeFileSync(file, patched);
  console.log(`bumped GALLERY_VERSION: ${match[0].match(/"([^"]+)"/)[1]} → ${next}`);
}

async function main() {
  const inputPath = arg("input");
  if (!inputPath) {
    console.error("usage: --input <new-celebrities.json>");
    process.exit(1);
  }

  if (!fs.existsSync(MODEL_PATH)) {
    console.error(
      `missing ${path.relative(ROOT, MODEL_PATH)} — run "npm run model:ensure" first (needs network access to Hugging Face).`,
    );
    process.exit(1);
  }

  const entries = readJson(path.resolve(inputPath));
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${inputPath} must be a non-empty JSON array of {id, name}`);
  }

  const withPhoto = [];
  const missingPhoto = [];
  for (const e of entries) {
    if (fs.existsSync(path.join(CELEBS, `${e.id}.jpg`))) withPhoto.push(e);
    else missingPhoto.push(e);
  }
  if (missingPhoto.length > 0) {
    console.log(
      `skipping ${missingPhoto.length} id(s) with no portrait yet (run fetch-new-celebs.ts first): ${missingPhoto.map((e) => e.id).join(", ")}`,
    );
  }
  if (withPhoto.length === 0) {
    console.error("no ids have a portrait on disk — nothing to do.");
    process.exit(1);
  }

  // Phase 1: thumbnails.
  const thumbStatus = run("node", [
    "scripts/generate-thumbs.mjs",
    "--ids",
    withPhoto.map((e) => e.id).join(","),
  ]);
  if (thumbStatus !== 0) {
    throw new Error("thumbnail generation failed for at least one id — fix before continuing");
  }

  // Phase 2: manifest for the browser encode route.
  const manifest = {
    cases: withPhoto.map((e) => ({ id: e.id, name: e.name, imagePath: `/celebs/${e.id}.jpg` })),
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`wrote ${path.relative(ROOT, MANIFEST_PATH)} (${manifest.cases.length} cases)`);

  // Phase 3: boot dev server, drive the real AdaFace pipeline via Playwright.
  console.log("\nstarting dev server…");
  const devServer = startDevServer();
  try {
    const up = await waitForServer(DEV_URL, DEV_HEALTHCHECK_TIMEOUT_MS);
    if (!up) throw new Error(`dev server did not come up within ${DEV_HEALTHCHECK_TIMEOUT_MS}ms — see reports/add-new-celebs-dev-server.log`);

    const encodeUrl = `http://127.0.0.1:8080/held-out-encode?engine=adaface&manifest=${encodeURIComponent("/celebs/new-celebs-manifest.json")}`;
    const encodeStatus = run("node", ["scripts/encode-held-out-browser.mjs"], {
      env: {
        ...process.env,
        HELDOUT_URL: encodeUrl,
        HELDOUT_OUT: DESCRIPTORS_PATH,
      },
    });
    if (encodeStatus !== 0) throw new Error("encode-held-out-browser.mjs failed");
  } finally {
    console.log("\nstopping dev server…");
    stopDevServer(devServer);
  }

  // Phase 4: append each successfully-encoded, fully-demographic id as a gallery slot.
  const descriptors = readJson(DESCRIPTORS_PATH);
  const cases = descriptors.cases ?? [];
  const added = [];
  const needsManualDemographics = [];
  const encodeFailed = [];

  for (const e of withPhoto) {
    const row = cases.find((c) => c.id === e.id);
    if (!row || !row.ok || !row.descriptor || row.descriptor.length < 256) {
      encodeFailed.push(e.id);
      continue;
    }
    if (row.age === null || row.age === undefined || (row.gender !== "male" && row.gender !== "female")) {
      needsManualDemographics.push({ id: e.id, name: e.name, descriptor: row });
      continue;
    }
    const status = run("node", [
      "scripts/add-gallery-slot.mjs",
      "--desc",
      DESCRIPTORS_PATH,
      "--id",
      e.id,
      "--age",
      String(row.age),
      "--gender",
      row.gender,
      "--genderProb",
      String(row.genderProb ?? 0.5),
      "--name",
      e.name,
    ]);
    if (status === 0) added.push(e.id);
    else encodeFailed.push(e.id);
  }

  console.log("\n=== add-new-celebs summary ===");
  console.log(`added:                    ${added.join(", ") || "(none)"}`);
  console.log(`skipped (no photo):       ${missingPhoto.map((e) => e.id).join(", ") || "(none)"}`);
  console.log(`encode/add failed:        ${encodeFailed.join(", ") || "(none)"}`);
  if (needsManualDemographics.length > 0) {
    console.log(
      `needs manual demographics: ${needsManualDemographics.map((n) => n.id).join(", ")} — ` +
        `face-api could not read age/gender from the portrait; supply --age/--gender/--genderProb ` +
        `by hand via add-gallery-slot.mjs --desc ${path.relative(ROOT, DESCRIPTORS_PATH)} --id <id> ...`,
    );
  }

  if (added.length === 0) {
    console.log("\nnothing was added to the gallery — stopping before version bump / verification.");
    process.exitCode = 1;
    return;
  }

  // Phase 5: version bump + verification.
  bumpGalleryVersion();

  console.log("\n=== verification ===");
  const heldOutStatus = run("npm", ["run", "test:heldout", "--", "--floor", "75"]);
  const calibrationStatus = run("node", ["--experimental-strip-types", "scripts/refit-calibration.ts"]);
  const parityStatus = run("npm", ["run", "test:parity", "--", "--floor", "75"]);

  console.log("\n=== verification summary ===");
  console.log(`held-out floor:   ${heldOutStatus === 0 ? "PASS" : "FAIL"}`);
  console.log(`calibration:      ${calibrationStatus === 0 ? "PASS (no drift)" : "DRIFTED — see output above; consider updating src/lib/face/calibration.ts"}`);
  console.log(`parity floor:     ${parityStatus === 0 ? "PASS" : "FAIL"}`);
  console.log(
    "\nNext: review git status/git diff (public/celebs/*, embeddings.ts version bump, reports/*), " +
      "address anything above that isn't PASS, then commit.",
  );

  if (heldOutStatus !== 0 || parityStatus !== 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
