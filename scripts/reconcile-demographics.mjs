#!/usr/bin/env node
/**
 * Reconcile gallery demographics (age, gender) against Wikidata ground truth.
 *
 * Public figures' birth dates and genders are uncontroversial catalog metadata
 * (repo precedent: milestone F5 corrected inverted age/gender metadata). The
 * detector estimates that enrollment records are exactly that — estimates — and
 * single-photo reads can be years off. This script resolves each celeb through
 * their English Wikipedia sitelink (ambiguity-guarded), reads P569/P21, and
 * reports drift. Pass --apply to write corrections into buckets.json/index.json.
 *
 *   node scripts/reconcile-demographics.mjs [--ids id1,id2] [--all] [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");
const UA = "TwinframeDemographicReconcile/1.0 (local catalog quality) Node.js";
const CURRENT_YEAR = new Date().getFullYear();
const AGE_DRIFT_THRESHOLD = 2;

// Exact enwiki titles for names whose catalog form resists canonicalization.
const TITLE_OVERRIDES = {
  "daisy-edgar-jones": "Daisy Edgar-Jones",
  "stephan-james": "Stephan James (actor)",
};
const idsArg = process.argv.indexOf("--ids");
const targets = idsArg >= 0 ? process.argv[idsArg + 1].split(",") : null;
const applyAll = process.argv.includes("--all");
const apply = process.argv.includes("--apply");

async function enwiki(params) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error(`enwiki ${res.status}`);
  return res.json();
}

async function wikidata(params) {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`wikidata ${res.status}`);
    return res.json();
  }
  throw new Error("wikidata 429");
}

/**
 * Resolve a person via their en.wikipedia sitelink title; guard against
 * ambiguity. Canonicalization runs first on enwiki (handles redirects like
 * "Lakeith Stanfield" -> "LaKeith Stanfield") because wbgetentities needs
 * exact titles and does not follow redirects.
 */
async function resolveEntity(name) {
  try {
    const canon = await enwiki({
      action: "query",
      titles: name,
      redirects: 1,
      converttitles: 1,
    });
    const pages = Object.values(canon.query?.pages ?? {});
    const page = pages.find((p) => !String(p.pageid ?? -1).startsWith("-"));
    if (page?.title) name = page.title;
  } catch {
    /* fall through to direct lookup */
  }
  const j = await wikidata({
    action: "wbgetentities",
    sites: "enwiki",
    titles: name,
    props: "claims|sitelinks|labels",
    languages: "en",
  });
  const entities = Object.values(j.entities ?? {});
  const entity = entities.find((e) => e.type === "item" && !String(e.id).startsWith("-"));
  if (!entity) return { status: "unresolved" };
  // Sitelink must normalize back to the requested name (case-insensitive) so a
  // disambiguation redirect cannot silently bind the wrong person.
  const normalize = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const sitelink = entity.sitelinks?.enwiki?.title;
  if (!sitelink || normalize(sitelink) !== normalize(name)) {
    return { status: "ambiguous", sitelink };
  }
  return { status: "ok", entity };
}

function extractBirthYear(entity) {
  const claims = entity.claims?.P569 ?? [];
  for (const c of claims) {
    const dv = c.mainsnak?.datavalue?.value;
    const t = typeof dv?.time === "string" ? dv.time : "";
    const m = t.match(/^\+(\d{4})/);
    if (m) return Number(m[1]);
  }
  return null;
}

function extractGender(entity) {
  const qid = entity.claims?.P21?.[0]?.mainsnak?.datavalue?.value?.id;
  if (qid === "Q6581097") return "male";
  if (qid === "Q6581072") return "female";
  return null;
}

function batched(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const buckets = JSON.parse(fs.readFileSync(path.join(CELEBS, "gallery.buckets.json"), "utf8"));
  const index = JSON.parse(fs.readFileSync(path.join(CELEBS, "index.json"), "utf8"));

  let pool = buckets;
  if (targets) pool = buckets.filter((b) => targets.includes(b.id));
  for (const b of pool) {
    if (TITLE_OVERRIDES[b.id]) b.name = TITLE_OVERRIDES[b.id];
  }
  if (!targets && !applyAll && !apply) {
    console.error("nothing to do: pass --ids a,b,c, or --all, or --apply (applies to all)");
    process.exit(1);
  }

  const corrections = [];
  const skipped = [];

  for (const group of batched(pool, 20)) {
    const resolved = await Promise.all(
      group.map(async (b) => ({ b, ...(await resolveEntity(b.name)) })),
    );
    for (const { b, status, entity } of resolved) {
      if (status !== "ok") {
        skipped.push(`${b.id} (${status})`);
        continue;
      }
      const birthYear = extractBirthYear(entity);
      const gtGender = extractGender(entity);
      if (birthYear === null && !gtGender) {
        skipped.push(`${b.id} (no P569/P21)`);
        continue;
      }
      const realAge = birthYear ? Math.max(0, CURRENT_YEAR - birthYear) : null;
      const ageDrift = realAge !== null && Number.isFinite(b.age) ? Math.abs(realAge - b.age) : null;
      const genderMismatch = gtGender && b.gender !== gtGender;

      if ((ageDrift !== null && ageDrift > AGE_DRIFT_THRESHOLD) || genderMismatch) {
        corrections.push({
          id: b.id,
          oldAge: b.age,
          newAge: realAge,
          ageDrift,
          oldGender: b.gender,
          newGender: gtGender,
        });
      }
    }
  }

  console.log(`checked ${pool.length}, corrections ${corrections.length}, skipped ${skipped.length}`);
  for (const c of corrections) {
    console.log(
      `  ${c.id}: age ${c.oldAge}->${c.newAge} (drift ${c.ageDrift}) | gender ${c.oldGender}->${c.newGender ?? "keep"}`,
    );
  }
  if (skipped.length) console.log("skipped:", skipped.join(", "));

  if (apply && corrections.length) {
    for (const c of corrections) {
      const b = buckets.find((x) => x.id === c.id);
      if (!b) continue;
      if (c.newAge !== null) {
        b.age = c.newAge;
        const ie = index.find((e) => e.id === c.id);
        if (ie) {
          ie.baseAge = c.newAge;
          ie.ageBuckets = [c.newAge];
        }
      }
      if (c.newGender) b.gender = c.newGender;
    }
    fs.writeFileSync(path.join(CELEBS, "gallery.buckets.json"), JSON.stringify(buckets, null, 2));
    fs.writeFileSync(path.join(CELEBS, "index.json"), JSON.stringify(index, null, 2));
    console.log(`applied ${corrections.length} corrections — bump GALLERY_VERSION before shipping`);
  } else if (!apply) {
    console.log("(report-only; pass --apply to write corrections)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
