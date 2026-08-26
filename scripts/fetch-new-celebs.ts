#!/usr/bin/env tsx
/**
 * Download a canonical portrait for BRAND NEW celebrities (people not yet in
 * public/celebs/index.json) from Wikipedia/Commons, into public/celebs/<id>.jpg.
 *
 * This is the first of three phases to broaden the gallery beyond its current
 * roster. It only writes canonical portraits — it does not touch the gallery
 * binary, thumbnails, or index. Run the other phases after this one:
 *   1. fetch-new-celebs.ts       (this script) — get one portrait per person
 *   2. generate-thumbs.mjs       — build the 96/192 webp thumbs add-gallery-slot.mjs requires
 *   3. add-new-celebs.mjs        — encode with the live AdaFace pipeline, append
 *                                  gallery slots, then verify (held-out/parity/calibration)
 *
 * Network requirement: reaches en.wikipedia.org and upload.wikimedia.org over
 * HTTPS with no API key. If your environment blocks outbound requests to
 * those hosts, this script cannot run there.
 *
 * Input: a JSON file `[{ "id": "kebab-case-id", "name": "Full Name" }, ...]`.
 * See scripts/new-celebrities.example.json for the shape — copy it, fill in
 * the real people you want to add, and point --input at your copy.
 *
 * Usage:
 *   node --experimental-strip-types scripts/fetch-new-celebs.ts --input scripts/new-celebrities.json
 *   node --experimental-strip-types scripts/fetch-new-celebs.ts --input scripts/new-celebrities.json --delay-ms 400
 *
 * Ids already present in public/celebs/index.json are refused up front — use
 * patch-gallery-slot.ts to replace an existing person, not this pipeline.
 * A portrait already on disk at public/celebs/<id>.jpg is left untouched
 * (resumable across runs / Wikimedia throttling).
 *
 * Writes reports/new-celebs-fetch-report.json with a row per requested id:
 * ok (with the source URL and wiki title actually used) or failed (with a
 * reason). Never fabricates a placeholder image for a failure.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  download,
  pageImageTitle,
  pageImages,
  resolveTitle,
} from "./fetch-held-out-photos.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const INDEX = path.join(CELEBS, "index.json");
const REPORT = path.join(ROOT, "reports/new-celebs-fetch-report.json");

interface NewCelebInput {
  id: string;
  name: string;
}

interface FetchReportRow {
  id: string;
  name: string;
  status: "ok" | "skipped-exists" | "failed";
  reason?: string;
  sourceUrl?: string;
  wikiTitle?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Portrait first, then any other usable page image as fallback. */
async function orderedCandidates(
  title: string,
): Promise<Array<{ url: string; title: string }>> {
  const infobox = await pageImageTitle(title);
  const imgs = await pageImages(title);
  if (!infobox) return imgs;
  return [...imgs.filter((i) => i.title === infobox), ...imgs.filter((i) => i.title !== infobox)];
}

async function main() {
  const inputPath = arg("input");
  if (!inputPath) {
    console.error("usage: --input <new-celebrities.json> [--delay-ms 280]");
    process.exit(1);
  }
  const delayMs = Number(arg("delay-ms") ?? 280);

  const entries = readJson<NewCelebInput[]>(path.resolve(inputPath));
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${inputPath} must be a non-empty JSON array of {id, name}`);
  }
  for (const e of entries) {
    if (!e.id || !ID_RE.test(e.id)) throw new Error(`invalid id "${e.id}" — use lowercase-kebab-case`);
    if (!e.name) throw new Error(`entry "${e.id}" is missing a name`);
  }

  const index = readJson<Array<{ id: string }>>(INDEX);
  const existingIds = new Set(index.map((e) => e.id));

  const rows: FetchReportRow[] = [];
  let ok = 0;
  let skip = 0;
  let fail = 0;

  console.log(`fetch-new-celebs: ${entries.length} requested`);

  for (const entry of entries) {
    if (existingIds.has(entry.id)) {
      console.log(`- already enrolled  ${entry.id} (use patch-gallery-slot.ts to replace)`);
      rows.push({ id: entry.id, name: entry.name, status: "skipped-exists" });
      skip++;
      continue;
    }

    const dest = path.join(CELEBS, `${entry.id}.jpg`);
    if (fs.existsSync(dest)) {
      console.log(`- portrait on disk  ${entry.id}`);
      rows.push({ id: entry.id, name: entry.name, status: "skipped-exists", reason: "portrait already on disk" });
      skip++;
      continue;
    }

    try {
      const title = await resolveTitle(entry.name);
      if (!title) {
        console.log(`- no wiki title    ${entry.id} ("${entry.name}")`);
        rows.push({ id: entry.id, name: entry.name, status: "failed", reason: "no matching Wikipedia article" });
        fail++;
        await sleep(delayMs);
        continue;
      }

      const candidates = await orderedCandidates(title);
      let saved = false;
      for (const cand of candidates) {
        const result = await download(cand.url);
        if (!result) continue;
        if ("reject" in result) {
          console.log(`  skip ${cand.title}: ${result.reject}`);
          continue;
        }
        fs.mkdirSync(CELEBS, { recursive: true });
        fs.writeFileSync(dest, result.buffer);
        rows.push({
          id: entry.id,
          name: entry.name,
          status: "ok",
          sourceUrl: cand.url,
          wikiTitle: title,
        });
        console.log(`+ ${entry.id}  ← ${title}  (${cand.title})`);
        ok++;
        saved = true;
        break;
      }
      if (!saved) {
        console.log(`- no usable image  ${entry.id} (${title})`);
        rows.push({ id: entry.id, name: entry.name, status: "failed", reason: `no usable image on "${title}"` });
        fail++;
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.log(`- error ${entry.id}: ${reason}`);
      rows.push({ id: entry.id, name: entry.name, status: "failed", reason });
      fail++;
    }
    await sleep(delayMs);
  }

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(
    REPORT,
    JSON.stringify({ generatedAt: new Date().toISOString(), ok, skip, fail, rows }, null, 2),
  );
  console.log(`done ok=${ok} skip=${skip} fail=${fail} — report: ${path.relative(ROOT, REPORT)}`);
  if (fail > 0) {
    console.log(
      `${fail} entr${fail === 1 ? "y" : "ies"} need a manual photo — see the report, or re-run after adjusting the name.`,
    );
  }
}

if (process.argv[1] && process.argv[1].endsWith("fetch-new-celebs.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
