#!/usr/bin/env tsx
/**
 * Download a *different* Wikipedia / Commons portrait per celebrity for
 * held-out Rank-1. Writes public/celebs/held-out/<id>/001.jpg + manifest.json.
 *
 * Does not add these images to the gallery — 001 is the eval-only query photo
 * (slots 002+ are enrolled as extra views by scripts/lib/enroll-jobs.mjs).
 *
 * The whole catalog is in scope by default (index.json length, currently 1000);
 * HELD_OUT_LIMIT / --limit narrow it for a quick pass. Wikimedia is throttled,
 * so expect to run this repeatedly — already-downloaded ids are skipped by
 * looking at the files on disk, not at manifest rows.
 *
 * Candidates that decode too small or compress like flat art are rejected (see
 * photoRejectReason) — Wikipedia's image list includes interface chrome, and one
 * such icon shipped as a celebrity's held-out probe before this guard.
 *
 * The manifest is rebuilt from the directory tree on every run, so it lists
 * EVERY image slot present (001, 002, 003, …) instead of only the rows this
 * process happened to write. Rebuild it on its own with:
 *   node --experimental-strip-types scripts/fetch-held-out-photos.ts --manifest-only
 *
 * Usage:
 *   node --experimental-strip-types scripts/fetch-held-out-photos.ts [--limit N] [--ids a,b] [--manifest-only]
 *   HELD_OUT_LIMIT=50 node --experimental-strip-types scripts/fetch-held-out-photos.ts
 *   HELD_OUT_DELAY_MS=2000 node --experimental-strip-types scripts/fetch-held-out-photos.ts --ids adam-sandler,al-pacino
 *
 * --audit re-checks every image already on disk against the same guard, which is
 * how you find probes an earlier run let through.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "public/celebs/index.json");
const OUT_DIR = path.join(ROOT, "public/celebs/held-out");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const UA = "TwinframeHeldOut/1.0 (local accuracy eval; github.com/twinframe) Node.js";

const DELAY_MS = Number(process.env.HELD_OUT_DELAY_MS || 280);
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
/** Slot 001 is the held-out query photo; later slots are enrollment extras. */
export const EVAL_SLOT = "001";
export const MANIFEST_VERSION = "2.0.0";

interface IndexEntry {
  id: string;
  name: string;
  fallbackPath?: string;
  path?: string;
}

export interface ManifestRow {
  id: string;
  name: string;
  slot: string;
  imagePath: string;
  bytes: number;
  evalSlot: boolean;
  sourceUrl?: string;
  wikiTitle?: string;
}

export interface Manifest {
  version: string;
  description: string;
  generatedAt: string;
  count: number;
  identities: number;
  evalSlotCount: number;
  cases: ManifestRow[];
}

const SKIP_NAME =
  /logo|icon|flag|coat|signature|wordmark|poster|soundtrack|\.svg|symbol|map of|diagram|audio-input|speaker|padlock|ambox|question_book|commons-|edit-|magnify|star_full|folder|arrow|mural|graffiti|waxwork|statue|crowd|audience|cast[ _]|group[ _]/i;

/** Two people in the frame — largest-face still embeds the wrong subject. */
const SKIP_PAIR = /(^|[ _(])(and|with|&|feat\.?|vs\.?)[ _]|withdaughters|withfamily/i;

/**
 * Shortest side a usable held-out portrait must have. Interface chrome is small
 * and square; SCRFD needs real pixels to find a face at all.
 */
export const PHOTO_MIN_DIMENSION = 200;
/**
 * Bytes per pixel below which an image is flat art, not a photograph. A 900px
 * photograph carries ~0.05-0.3 bytes per pixel; flat vector-ish art rasterized
 * to the same size lands near 0.008.
 */
export const PHOTO_MIN_BYTES_PER_PIXEL = 0.02;

/**
 * Why a candidate is not a usable portrait, or null when it looks like one.
 *
 * Wikipedia's article-image list returns interface chrome alongside photographs,
 * and a filename blocklist always misses the next one — a 128px microphone icon
 * shipped as `rihanna/001.jpg`, scoring as a model miss, is how this guard was
 * found. Both tests run on the decoded bytes rather than on the API's reported
 * size, because the API described that icon as a 900px thumbnail.
 */
export function photoRejectReason(candidate: {
  bytes: number;
  width?: number;
  height?: number;
}): "too-small" | "flat-art" | null {
  const { bytes, width, height } = candidate;
  if (!width || !height || width <= 0 || height <= 0) return null;
  if (Math.min(width, height) < PHOTO_MIN_DIMENSION) return "too-small";
  if (bytes / (width * height) < PHOTO_MIN_BYTES_PER_PIXEL) return "flat-art";
  return null;
}

/**
 * Why a Wikipedia/Commons filename is not a usable solo portrait, or null when
 * it looks like one. Pair shots (Aishwarya+Abhishek, Sandler+daughters) were
 * landing as held-out 001s and then scoring as model misses.
 */
export function heldOutFileNameRejectReason(title: string): "non-photo" | "pair" | null {
  const bare = title.replace(/^File:/i, "");
  if (SKIP_PAIR.test(bare)) return "pair";
  if (SKIP_NAME.test(bare)) return "non-photo";
  return null;
}

/** Full catalog by default; HELD_OUT_LIMIT or --limit narrow it. */
export function resolveLimit(
  catalogSize: number,
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv,
): number {
  const flagIdx = argv.indexOf("--limit");
  const raw = flagIdx >= 0 ? argv[flagIdx + 1] : env.HELD_OUT_LIMIT;
  if (raw === undefined || raw === "") return catalogSize;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new Error(`Invalid held-out limit "${raw}"`);
  return Math.min(catalogSize, Math.floor(n));
}

/** `--ids a,b` fetches those catalog rows only. Null when the flag is absent. */
export function resolveFetchIds(
  catalog: Array<{ id: string }>,
  argv: string[] = process.argv,
): string[] | null {
  const idx = argv.indexOf("--ids");
  if (idx < 0) return null;
  const raw = argv[idx + 1];
  if (!raw || raw.startsWith("--")) throw new Error("Missing --ids value (comma-separated catalog ids)");
  const wanted = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (wanted.length === 0) throw new Error("Empty --ids list");
  const known = new Set(catalog.map((c) => c.id));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown catalog ids: ${unknown.join(",")}`);
  return wanted;
}

/** Every image slot on disk: [{ id, slot, filePath }], sorted by id then slot. */
export function listHeldOutSlots(
  heldOutDir: string,
): Array<{ id: string; slot: string; filePath: string }> {
  if (!fs.existsSync(heldOutDir)) return [];
  const out: Array<{ id: string; slot: string; filePath: string }> = [];
  for (const entry of fs.readdirSync(heldOutDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(heldOutDir, entry.name);
    for (const file of fs.readdirSync(dir).sort()) {
      if (!IMAGE_RE.test(file)) continue;
      out.push({
        id: entry.name,
        slot: file.replace(IMAGE_RE, ""),
        filePath: path.join(dir, file),
      });
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id) || a.slot.localeCompare(b.slot));
  return out;
}

/**
 * Rebuild the manifest from the directory tree. Provenance (sourceUrl,
 * wikiTitle) is carried over from the previous manifest, keyed by image path,
 * so a rebuild never loses what an earlier fetch recorded.
 */
export function rebuildManifestFromDisk(args: {
  heldOutDir: string;
  index: IndexEntry[];
  previous?: { cases?: Array<Partial<ManifestRow>> } | null;
  now?: string;
}): Manifest {
  const nameById = new Map(args.index.map((e) => [e.id, e.name]));
  const provenance = new Map<string, { sourceUrl?: string; wikiTitle?: string }>();
  for (const row of args.previous?.cases ?? []) {
    if (!row?.imagePath) continue;
    provenance.set(row.imagePath, { sourceUrl: row.sourceUrl, wikiTitle: row.wikiTitle });
  }

  const cases: ManifestRow[] = [];
  const identities = new Set<string>();
  let evalSlotCount = 0;
  for (const slot of listHeldOutSlots(args.heldOutDir)) {
    const imagePath = `/celebs/held-out/${slot.id}/${path.basename(slot.filePath)}`;
    const prior = provenance.get(imagePath);
    const isEvalSlot = slot.slot === EVAL_SLOT;
    if (isEvalSlot) evalSlotCount++;
    identities.add(slot.id);
    cases.push({
      id: slot.id,
      name: nameById.get(slot.id) ?? slot.id,
      slot: slot.slot,
      imagePath,
      bytes: fs.statSync(slot.filePath).size,
      evalSlot: isEvalSlot,
      ...(prior?.sourceUrl ? { sourceUrl: prior.sourceUrl } : {}),
      ...(prior?.wikiTitle ? { wikiTitle: prior.wikiTitle } : {}),
    });
  }

  return {
    version: MANIFEST_VERSION,
    description:
      "Held-out photos on disk. Slot 001 is the eval-only query photo; 002+ are enrolled as extra views.",
    generatedAt: args.now ?? new Date().toISOString(),
    count: cases.length,
    identities: identities.size,
    evalSlotCount,
    cases,
  };
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeManifest(manifest: Manifest): void {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function politeFetch(url: URL | string, attempt = 0): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, "Api-User-Agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (attempt >= 2) throw err;
    await sleep(Math.max(DELAY_MS, 1_000) * 2 ** attempt);
    return politeFetch(url, attempt + 1);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfter = Number(res.headers.get("retry-after")) * 1000;
    const wait = Math.min(
      30_000,
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : Math.max(DELAY_MS, 2_000) * 2 ** (attempt + 1),
    );
    await sleep(wait);
    return politeFetch(url, attempt + 1);
  }
  return res;
}

async function wiki(params: Record<string, string>): Promise<any> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`wiki ${res.status} ${url.searchParams.get("action")}`);
  return res.json();
}

function fileSha(p: string): string | null {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function enrollPath(entry: IndexEntry): string | null {
  const rel = entry.fallbackPath || entry.path;
  if (!rel) return null;
  const abs = path.join(ROOT, "public", rel.replace(/^\//, ""));
  return fs.existsSync(abs) ? abs : null;
}

async function resolveTitle(name: string): Promise<string | null> {
  const j = await wiki({
    action: "query",
    list: "search",
    srsearch: name,
    srlimit: "3",
    srnamespace: "0",
  });
  const hit = j.query?.search?.[0];
  return hit?.title ?? null;
}

async function pageImageTitle(title: string): Promise<string | null> {
  const j = await wiki({
    action: "query",
    titles: title,
    prop: "pageimages",
    pithumbsize: "320",
    pilicense: "any",
  });
  const page = Object.values(j.query?.pages ?? {})[0] as any;
  return page?.pageimage ? `File:${page.pageimage}` : null;
}

async function pageImages(
  title: string,
): Promise<Array<{ url: string; title: string; width: number; height: number }>> {
  const j = await wiki({
    action: "query",
    titles: title,
    generator: "images",
    gimlimit: "16",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "900",
  });
  const pages = Object.values(j.query?.pages ?? {}) as any[];
  const out: Array<{ url: string; title: string; width: number; height: number }> = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const mime = String(info.mime || "");
    if (!mime.startsWith("image/") || mime.includes("svg")) continue;
    if (heldOutFileNameRejectReason(p.title || "") || heldOutFileNameRejectReason(info.url || "")) {
      continue;
    }
    const w = Number(info.thumbwidth || info.width || 0);
    const h = Number(info.thumbheight || info.height || 0);
    if (Math.min(w, h) < 160) continue;
    out.push({ url: info.thumburl || info.url, title: p.title, width: w, height: h });
  }
  return out;
}

async function download(url: string): Promise<{ buffer: Buffer } | { reject: string } | null> {
  const res = await politeFetch(url);
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 4_000) return { reject: "too-small" };
  const meta = await sharp(buffer)
    .metadata()
    .catch(() => null);
  if (!meta) return { reject: "undecodable" };
  const reason = photoRejectReason({
    bytes: buffer.length,
    width: meta.width,
    height: meta.height,
  });
  return reason ? { reject: reason } : { buffer };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const index = readJson<IndexEntry[]>(INDEX, []);
  if (index.length === 0) throw new Error(`no catalog at ${INDEX}`);
  const previous = readJson<{ cases?: Array<Partial<ManifestRow>> }>(MANIFEST, { cases: [] });

  if (process.argv.includes("--audit")) {
    const suspects: string[] = [];
    for (const slot of listHeldOutSlots(OUT_DIR)) {
      const meta = await sharp(slot.filePath)
        .metadata()
        .catch(() => null);
      const reason = meta
        ? photoRejectReason({
            bytes: fs.statSync(slot.filePath).size,
            width: meta.width,
            height: meta.height,
          })
        : "undecodable";
      if (reason) suspects.push(`${slot.id}/${slot.slot}: ${reason} (${meta?.width}x${meta?.height})`);
    }
    console.log(
      suspects.length === 0
        ? "audit: every held-out image looks like a photograph"
        : `audit: ${suspects.length} suspect image(s) — delete them and re-fetch:\n  ${suspects.join("\n  ")}`,
    );
    return;
  }

  if (process.argv.includes("--manifest-only")) {
    const manifest = rebuildManifestFromDisk({ heldOutDir: OUT_DIR, index, previous });
    writeManifest(manifest);
    console.log(
      `manifest rebuilt from disk: ${manifest.count} images across ${manifest.identities} ids (${manifest.evalSlotCount} eval slots)`,
    );
    return;
  }

  const wantedIds = resolveFetchIds(index);
  const slice = wantedIds
    ? wantedIds.map((id) => index.find((entry) => entry.id === id)!)
    : index.slice(0, resolveLimit(index.length));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Provenance is only used to avoid re-downloading; presence on disk decides.
  const fetched = new Map<string, { sourceUrl: string; wikiTitle: string }>();
  for (const row of previous.cases ?? []) {
    if (row?.imagePath && row.sourceUrl && row.wikiTitle) {
      fetched.set(row.imagePath, { sourceUrl: row.sourceUrl, wikiTitle: row.wikiTitle });
    }
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;

  console.log(`held-out fetch: ${slice.length} of ${index.length} catalog ids`);

  for (const entry of slice) {
    const destDir = path.join(OUT_DIR, entry.id);
    const dest = path.join(destDir, `${EVAL_SLOT}.jpg`);
    if (fs.existsSync(dest)) {
      skip++;
      continue;
    }

    try {
      const title = await resolveTitle(entry.name);
      if (!title) {
        console.log(`- no wiki title  ${entry.id}`);
        fail++;
        await sleep(DELAY_MS);
        continue;
      }
      const infobox = await pageImageTitle(title);
      const imgs = await pageImages(title);
      const enroll = enrollPath(entry);
      const enrollSha = enroll ? fileSha(enroll) : null;

      const ordered = [
        ...imgs.filter((i) => infobox && i.title !== infobox),
        ...imgs.filter((i) => !infobox || i.title === infobox),
      ];

      let saved = false;
      for (const cand of ordered) {
        const result = await download(cand.url);
        if (!result) continue;
        if ("reject" in result) {
          console.log(`  skip ${cand.title}: ${result.reject}`);
          continue;
        }
        const buf = result.buffer;
        const sha = crypto.createHash("sha256").update(buf).digest("hex");
        if (enrollSha && sha === enrollSha) continue;
        if (enroll && Math.abs(buf.length - fs.statSync(enroll).size) < 80) continue;
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(dest, buf);
        fetched.set(`/celebs/held-out/${entry.id}/${EVAL_SLOT}.jpg`, {
          sourceUrl: cand.url,
          wikiTitle: title,
        });
        console.log(`+ ${entry.id}  ← ${title}  (${cand.title})`);
        ok++;
        saved = true;
        break;
      }
      if (!saved) {
        console.log(`- no alt image   ${entry.id} (${title})`);
        fail++;
      }
    } catch (e) {
      console.log(`- error ${entry.id}: ${e instanceof Error ? e.message : e}`);
      fail++;
    }
    await sleep(DELAY_MS);
  }

  const carried = [
    ...(previous.cases ?? []),
    ...Array.from(fetched, ([imagePath, prov]) => ({ imagePath, ...prov })),
  ];
  const manifest = rebuildManifestFromDisk({
    heldOutDir: OUT_DIR,
    index,
    previous: { cases: carried },
  });
  writeManifest(manifest);
  console.log(
    `done ok=${ok} skip=${skip} fail=${fail} manifest=${manifest.count} images / ${manifest.identities} ids`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("fetch-held-out-photos.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
