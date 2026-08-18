#!/usr/bin/env tsx
/**
 * Fetch DIVERSE extra portraits per celebrity from Wikimedia Commons into
 * public/celebs/extra-photos/<id>/ so multi-shot centroids have more than one
 * canonical infobox thumbnail to average.
 *
 * Diversity beats volume: the centroid builder collapses near-identical crops,
 * so we spread picks across distinct Commons files/years/events and skip the
 * group shots, posters and logos that would poison the prototype.
 *
 * Held-out probes are never touched — this only writes extra-photos/.
 *
 * Usage (sample run):
 *   EXTRAS_LIMIT=40 EXTRAS_MAX_SECONDS=240 \
 *     node --experimental-strip-types scripts/fetch-commons-extras.ts
 *
 * Usage (full crawl, hours — run detached):
 *   EXTRAS_LIMIT=1000 EXTRAS_TARGET=6 EXTRAS_MAX_SECONDS=0 \
 *     node --experimental-strip-types scripts/fetch-commons-extras.ts
 *
 * Env:
 *   EXTRAS_LIMIT        celebs to consider from index.json (default 40)
 *   EXTRAS_TARGET       photos wanted per celeb, clamped to 8 (default 4)
 *   EXTRAS_IDS          comma-separated ids instead of the index order
 *   EXTRAS_DELAY_MS     throttle between API/download calls (default 300)
 *   EXTRAS_MAX_SECONDS  wall-clock budget, 0 = unlimited (default 300)
 *   EXTRAS_SKIP_EXISTING=0  re-visit celebs that already have photos
 *   EXTRAS_MAX_EXISTING     only visit celebs with at most this many views
 *                           (0 = the single-shot celebs, the ones that need it most)
 *   EXTRAS_REPAIR_MANIFEST=1  skip fetching; recover provenance for photos on
 *                           disk that no manifest row covers (SHA-1 lookup)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const OUT_ROOT = path.join(CELEBS, "extra-photos");
const MANIFEST = path.join(OUT_ROOT, "commons-manifest.json");
const UA = "TwinframeExtras/1.0 (local accuracy work; multi-shot enrollment) Node.js";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** Hard ceiling shared with scripts/lib/enroll-jobs.mjs — more views are never enrolled. */
export const MAX_EXTRA_PHOTOS = 8;
export const MIN_IMAGE_EDGE = 220;

/** Filenames that are almost never a usable solo portrait of the subject. */
export const SKIP_NAME =
  /logo|icon|flag|coat[ _]of|signature|autograph|wordmark|poster|soundtrack|album|book[ _]cover|\.svg|symbol|map[ _]of|diagram|statue|waxwork|madame[ _]tussaud|wax[ _]|handprint|hand[ _]print|footprint|grave|tomb|plaque|star[ _]on|walk[ _]of[ _]fame|crowd|audience|cast[ _]of|group[ _]|panel|ensemble|premiere[ _]of[ _]the[ _]film|scan|comic|caricature|drawing|painting|sketch|silhouette/i;

/** Two people in the frame — SCRFD would happily enroll the wrong one. */
export const SKIP_PAIR = /(^|[ _(])(and|with|&|feat\.?|vs\.?)[ _]/i;

export interface CommonsCandidate {
  title: string;
  url: string;
  width: number;
  height: number;
}

export interface IndexEntry {
  id: string;
  name: string;
}

interface ManifestRow {
  id: string;
  file: string;
  commonsTitle: string;
  sourceUrl: string;
  fetchedAt: string;
}

export function isLikelyPortraitFileName(title: string): boolean {
  const bare = title.replace(/^File:/i, "");
  if (!/\.(jpe?g|png)$/i.test(bare)) return false;
  if (SKIP_NAME.test(bare)) return false;
  if (SKIP_PAIR.test(bare)) return false;
  return true;
}

export function normalizeTitleWords(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Person categories on Commons carry plenty of unrelated media (co-stars,
 * street scenes, event crowds). Requiring the subject's surname in the filename
 * is a cheap, high-precision filter.
 */
export function matchesSubject(title: string, name: string): boolean {
  const words = new Set(normalizeTitleWords(title.replace(/^File:/i, "")).split(" "));
  const nameTokens = normalizeTitleWords(name).split(" ").filter((t) => t.length >= 3);
  if (nameTokens.length === 0) return true;
  const surname = nameTokens[nameTokens.length - 1]!;
  if (!words.has(surname)) return false;
  // Short/common surnames (Lee, Kim, Cruz…) also need the given name present.
  if (surname.length <= 4 && nameTokens.length > 1) return words.has(nameTokens[0]!);
  return true;
}

/** Year tokens are the cheapest era signal Commons filenames carry. */
export function eraKey(title: string): string {
  const year = title.match(/(?:^|[^0-9])(19[5-9][0-9]|20[0-4][0-9])(?:[^0-9]|$)/);
  return year?.[1] ?? "unknown";
}

/** Collapse filenames that differ only by a crop/size suffix. */
export function baseKey(title: string): string {
  return title
    .replace(/^File:/i, "")
    .replace(/\.(jpe?g|png)$/i, "")
    .replace(/[ _]?\((cropped|crop|retouched|edited|resized|[0-9]+)\)/gi, "")
    .replace(/[ _]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Round-robin across eras, one file per base name, so N picks are N different
 * photos rather than N crops of the same press shot.
 */
export function selectDiverseCandidates<T extends { title: string }>(
  candidates: T[],
  want: number,
): T[] {
  const byBase = new Map<string, T>();
  for (const c of candidates) {
    const key = baseKey(c.title);
    if (!byBase.has(key)) byBase.set(key, c);
  }
  const byEra = new Map<string, T[]>();
  for (const c of byBase.values()) {
    const key = eraKey(c.title);
    const list = byEra.get(key) ?? [];
    list.push(c);
    byEra.set(key, list);
  }
  // Prefer dated files: an "unknown" era bucket is a grab-bag of near-duplicates.
  const buckets = [...byEra.entries()]
    .sort((a, b) => (a[0] === "unknown" ? 1 : b[0] === "unknown" ? -1 : a[0].localeCompare(b[0])))
    .map(([, list]) => list);

  const out: T[] = [];
  for (let round = 0; out.length < want; round++) {
    let progressed = false;
    for (const bucket of buckets) {
      const item = bucket[round];
      if (!item) continue;
      progressed = true;
      out.push(item);
      if (out.length >= want) break;
    }
    if (!progressed) break;
  }
  return out;
}

export function nextPhotoIndex(existingFiles: string[]): number {
  let max = 1; // 001 is reserved for the enrolled primary naming convention
  for (const f of existingFiles) {
    const m = f.match(/^(\d{1,3})\./);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** One wedged celebrity must not eat the whole crawl budget. */
function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

const LIMIT = Number(process.env.EXTRAS_LIMIT || 40);
const TARGET = Math.min(MAX_EXTRA_PHOTOS, Number(process.env.EXTRAS_TARGET || 4));
const DELAY_MS = Number(process.env.EXTRAS_DELAY_MS || 300);
const MAX_SECONDS = Number(process.env.EXTRAS_MAX_SECONDS ?? 300);
const SKIP_EXISTING = process.env.EXTRAS_SKIP_EXISTING !== "0";
const REQUEST_TIMEOUT_MS = Number(process.env.EXTRAS_TIMEOUT_MS || 20_000);
const MAX_BACKOFF_MS = 10_000;
const CELEB_DEADLINE_MS = Number(process.env.EXTRAS_CELEB_DEADLINE_MS || 120_000);
const MAX_EXISTING =
  process.env.EXTRAS_MAX_EXISTING === undefined
    ? Infinity
    : Number(process.env.EXTRAS_MAX_EXISTING);
const ONLY_IDS = (process.env.EXTRAS_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Commons answers 429 under load; back off rather than hammering it. A hung
 * upload.wikimedia.org connection would otherwise stall the whole crawl, so
 * every request carries a timeout and the backoff is bounded.
 */
async function politeFetch(url: URL | string, attempt = 0): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, "Api-User-Agent": UA },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (attempt >= 2) throw err;
    await sleep(DELAY_MS * 2 ** attempt);
    return politeFetch(url, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfter = Number(res.headers.get("retry-after")) * 1000;
    const wait = Math.min(
      MAX_BACKOFF_MS,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DELAY_MS * 2 ** (attempt + 2),
    );
    await sleep(wait);
    return politeFetch(url, attempt + 1);
  }
  return res;
}

async function api(endpoint: string, params: Record<string, string>): Promise<any> {
  const url = new URL(endpoint);
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`${new URL(endpoint).hostname} ${res.status}`);
  return res.json();
}

/** Commons category for the person, via the Wikipedia article's Commons link. */
async function resolveCategory(name: string): Promise<string | null> {
  const direct = await api(COMMONS_API, {
    action: "query",
    titles: `Category:${name}`,
    prop: "categoryinfo",
  });
  const page = direct.query?.pages?.[0];
  if (page && !page.missing) return `Category:${name}`;

  await sleep(DELAY_MS);
  const search = await api(COMMONS_API, {
    action: "query",
    list: "search",
    srsearch: name,
    srnamespace: "14",
    srlimit: "3",
  });
  const hit = (search.query?.search ?? []).find((s: { title: string }) =>
    s.title.toLowerCase().includes(name.split(" ")[0]!.toLowerCase()),
  );
  return hit?.title ?? null;
}

/** "<Person> by year" / "in 2016" containers hold the era spread; plain subcats rarely do. */
export function rankSubcategories(subcats: string[]): string[] {
  const weight = (title: string) =>
    /by year|by decade|in the \d{4}s|in \d{4}/i.test(title) ? 0 : 1;
  return [...subcats].sort((a, b) => weight(a) - weight(b) || a.localeCompare(b));
}

async function categoryFiles(category: string, depth = 2): Promise<string[]> {
  const j = await api(COMMONS_API, {
    action: "query",
    list: "categorymembers",
    cmtitle: category,
    cmtype: depth > 0 ? "file|subcat" : "file",
    cmlimit: "80",
  });
  const members = (j.query?.categorymembers ?? []) as Array<{ title: string; ns: number }>;
  const files = members.filter((m) => m.ns === 6).map((m) => m.title);
  const subcats = rankSubcategories(members.filter((m) => m.ns === 14).map((m) => m.title));

  // Big categories keep their photos two levels down under "by year" containers.
  if (depth > 0 && files.length < 30 && subcats.length > 0) {
    for (const sub of subcats.slice(0, depth > 1 ? 5 : 3)) {
      if (files.length >= 40) break;
      await sleep(DELAY_MS);
      files.push(...(await categoryFiles(sub, depth - 1)));
    }
  }
  return files;
}

async function imageInfo(titles: string[]): Promise<CommonsCandidate[]> {
  const out: CommonsCandidate[] = [];
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const j = await api(COMMONS_API, {
      action: "query",
      titles: chunk.join("|"),
      prop: "imageinfo",
      iiprop: "url|size|mime",
      iiurlwidth: "900",
    });
    for (const p of (j.query?.pages ?? []) as any[]) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const mime = String(info.mime || "");
      if (!mime.startsWith("image/") || mime.includes("svg")) continue;
      const width = Number(info.thumbwidth || info.width || 0);
      const height = Number(info.thumbheight || info.height || 0);
      if (Math.min(width, height) < MIN_IMAGE_EDGE) continue;
      out.push({ title: p.title, url: info.thumburl || info.url, width, height });
    }
    if (i + 40 < titles.length) await sleep(DELAY_MS);
  }
  return out;
}

async function download(url: string): Promise<Buffer | null> {
  const res = await politeFetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length < 8_000 ? null : buf;
}

function sha(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** SHA of everything already on disk for this id, so we never re-save a dupe. */
function knownShas(id: string): Set<string> {
  const out = new Set<string>();
  const files = [
    path.join(CELEBS, `${id}.jpg`),
    ...listPhotos(path.join(OUT_ROOT, id)).map((f) => path.join(OUT_ROOT, id, f)),
  ];
  const heldOut = path.join(CELEBS, "held-out", id);
  if (fs.existsSync(heldOut)) {
    for (const f of listPhotos(heldOut)) files.push(path.join(heldOut, f));
  }
  for (const f of files) {
    if (fs.existsSync(f)) out.add(sha(fs.readFileSync(f)));
  }
  return out;
}

function listPhotos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
}

/** Enrollable views this celeb already has: held-out 002+ (001 is eval-only) plus extra-photos. */
function existingViewCount(id: string): number {
  const heldOut = listPhotos(path.join(CELEBS, "held-out", id)).filter(
    (f) => !/^0*1\.(jpe?g|png)$/i.test(f),
  );
  return heldOut.length + listPhotos(path.join(OUT_ROOT, id)).length;
}

/** Written after every celebrity: an interrupted crawl must not lose provenance. */
function saveManifest(rows: ManifestRow[]): void {
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = `${row.id}/${row.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        version: "1.0.0",
        description: "Diverse Wikimedia Commons views fetched for multi-shot gallery centroids.",
        count: unique.length,
        photos: unique,
      },
      null,
      2,
    ),
  );
}

/**
 * Recover provenance for photos on disk that no manifest row covers (an
 * interrupted run), by asking Commons which file has that SHA-1.
 */
async function repairManifest(rows: ManifestRow[]): Promise<void> {
  const known = new Set(rows.map((r) => `${r.id}/${r.file}`));
  const orphans: Array<{ id: string; file: string }> = [];
  for (const id of fs.readdirSync(OUT_ROOT)) {
    const dir = path.join(OUT_ROOT, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of listPhotos(dir)) {
      if (!known.has(`${id}/${file}`)) orphans.push({ id, file });
    }
  }
  console.log(`manifest repair: ${orphans.length} photos without provenance`);
  let fixed = 0;
  for (const o of orphans) {
    const buf = fs.readFileSync(path.join(OUT_ROOT, o.id, o.file));
    const sha1 = crypto.createHash("sha1").update(buf).digest("hex");
    try {
      const j = await api(COMMONS_API, {
        action: "query",
        list: "allimages",
        aisha1: sha1,
        ailimit: "1",
        aiprop: "url",
      });
      const hit = j.query?.allimages?.[0];
      if (hit) {
        rows.push({
          id: o.id,
          file: o.file,
          commonsTitle: hit.title ?? `File:${hit.name}`,
          sourceUrl: hit.url ?? "",
          fetchedAt: new Date().toISOString(),
        });
        fixed++;
      } else {
        console.log(`  no commons match ${o.id}/${o.file}`);
      }
    } catch (err) {
      console.log(`  lookup failed ${o.id}/${o.file}: ${err instanceof Error ? err.message : err}`);
    }
    saveManifest(rows);
    await sleep(DELAY_MS);
  }
  console.log(`manifest repair: recovered ${fixed}/${orphans.length}`);
}

async function main(): Promise<void> {
  const index = JSON.parse(fs.readFileSync(path.join(CELEBS, "index.json"), "utf8")) as IndexEntry[];
  const byId = new Map(index.map((e) => [e.id, e]));
  const targets = ONLY_IDS.length
    ? ONLY_IDS.map((id) => byId.get(id)).filter((e): e is IndexEntry => Boolean(e))
    : index.slice(0, LIMIT);

  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const manifest: ManifestRow[] = fs.existsSync(MANIFEST)
    ? (JSON.parse(fs.readFileSync(MANIFEST, "utf8")).photos ?? [])
    : [];

  if (process.env.EXTRAS_REPAIR_MANIFEST === "1") {
    await repairManifest(manifest);
    return;
  }

  const startedAt = Date.now();
  let saved = 0;
  let celebsTouched = 0;
  let skipped = 0;
  let failed = 0;
  let budgetHit = false;

  console.log(
    `commons extras: ${targets.length} celebs, target ${TARGET}/celeb, budget ${MAX_SECONDS || "∞"}s`,
  );

  for (const entry of targets) {
    if (MAX_SECONDS > 0 && (Date.now() - startedAt) / 1000 > MAX_SECONDS) {
      budgetHit = true;
      console.log(`\ntime budget reached after ${celebsTouched} celebs — stopping cleanly`);
      break;
    }
    const destDir = path.join(OUT_ROOT, entry.id);
    const have = listPhotos(destDir);
    const existing = existingViewCount(entry.id);
    const want = Math.min(TARGET, MAX_EXTRA_PHOTOS) - have.length;
    if (want <= 0 || existing > MAX_EXISTING || (SKIP_EXISTING && existing >= TARGET)) {
      skipped++;
      continue;
    }

    try {
      const got = await withDeadline(
        fetchForCeleb(entry, { destDir, have, want, manifest }),
        CELEB_DEADLINE_MS,
        entry.id,
      );
      if (got > 0) {
        celebsTouched++;
        saved += got;
        saveManifest(manifest);
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      console.log(`- error ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  saveManifest(manifest);

  console.log(
    `done saved=${saved} celebs=${celebsTouched} skipped=${skipped} failed=${failed} ` +
      `elapsed=${Math.round((Date.now() - startedAt) / 1000)}s${budgetHit ? " (budget)" : ""}`,
  );
}

async function fetchForCeleb(
  entry: IndexEntry,
  ctx: { destDir: string; have: string[]; want: number; manifest: ManifestRow[] },
): Promise<number> {
  const { destDir, have, want, manifest } = ctx;
  const category = await resolveCategory(entry.name);
  await sleep(DELAY_MS);
  if (!category) {
    console.log(`- no commons category  ${entry.id}`);
    return 0;
  }
  const titles = (await categoryFiles(category)).filter(
    (t) => isLikelyPortraitFileName(t) && matchesSubject(t, entry.name),
  );
  await sleep(DELAY_MS);
  if (titles.length === 0) {
    console.log(`- no usable files      ${entry.id} (${category})`);
    return 0;
  }
  const infos = await imageInfo(titles.slice(0, 80));
  // Over-select: some picks fail download or land as a SHA dupe.
  const picks = selectDiverseCandidates(infos, want * 3);
  const blocked = knownShas(entry.id);

  let nextIndex = nextPhotoIndex(have);
  let got = 0;
  for (const cand of picks) {
    if (got >= want) break;
    await sleep(DELAY_MS);
    const buf = await download(cand.url);
    if (!buf) continue;
    const digest = sha(buf);
    if (blocked.has(digest)) continue;
    blocked.add(digest);
    fs.mkdirSync(destDir, { recursive: true });
    const file = `${String(nextIndex).padStart(3, "0")}.jpg`;
    fs.writeFileSync(path.join(destDir, file), buf);
    manifest.push({
      id: entry.id,
      file,
      commonsTitle: cand.title,
      sourceUrl: cand.url,
      fetchedAt: new Date().toISOString(),
    });
    nextIndex++;
    got++;
  }
  console.log(
    got > 0
      ? `+ ${entry.id}  ${got} view(s) from ${category}`
      : `- nothing landed       ${entry.id} (${category})`,
  );
  return got;
}

if (process.argv[1] && process.argv[1].endsWith("fetch-commons-extras.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
