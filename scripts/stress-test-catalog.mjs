import fs from "node:fs";
import path from "node:path";
import { catalogFor } from "../src/lib/celebrities/catalog.ts";

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "public/celebs/index.json");
const CURATED_FILE = path.join(ROOT, "src/lib/celebrities/catalog.ts");

console.log("=== EMPIRICAL STRESS TEST: CATALOG & ASSET FALLBACK ===");

// 1. Load catalog index
const indexData = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
console.log(`Loaded ${indexData.length} total entries from public/celebs/index.json`);

const indexIds = new Set(indexData.map((e) => e.id));

// 2. Parse CURATED keys directly from catalog.ts
const catalogContent = fs.readFileSync(CURATED_FILE, "utf-8");
const curatedBlockMatch = catalogContent.match(/const CURATED: Record<string, CatalogEntry> = \{([\s\S]*?)\n\};/);
if (!curatedBlockMatch) {
  console.error("FAIL: Could not locate CURATED block in src/lib/celebrities/catalog.ts");
  process.exit(1);
}

const curatedKeysMatches = Array.from(curatedBlockMatch[1].matchAll(/"([^"]+)":\s*\{/g)).map((m) => m[1]);
console.log(`Found ${curatedKeysMatches.length} curated keys in CURATED map.`);

// 3. Test CURATED key integrity against index.json
let orphanCuratedKeys = [];
let invalidCuratedEntries = [];

for (const key of curatedKeysMatches) {
  if (!indexIds.has(key)) {
    orphanCuratedKeys.push(key);
  }
  const entry = catalogFor(key);
  if (!entry.knownFor || typeof entry.accentHue !== "number" || isNaN(entry.accentHue) || !Array.isArray(entry.tags)) {
    invalidCuratedEntries.push({ key, entry });
  }
  if (entry.accentHue < 0 || entry.accentHue >= 360) {
    invalidCuratedEntries.push({ key, issue: "accentHue out of bounds [0, 360)", entry });
  }
  if (entry.tags.length === 0) {
    invalidCuratedEntries.push({ key, issue: "empty tags array", entry });
  }
}

console.log(`Curated Orphan Keys (in CURATED but not in gallery index.json): ${orphanCuratedKeys.length}`);
if (orphanCuratedKeys.length > 0) {
  console.log("Orphan keys list:", orphanCuratedKeys);
}

console.log(`Invalid Curated Entries: ${invalidCuratedEntries.length}`);
if (invalidCuratedEntries.length > 0) {
  console.log("Invalid curated entries detail:", invalidCuratedEntries);
}

// 4. Test catalogFor across all 1000 gallery IDs
const validKnownForCategories = new Set(["Actor", "Artist", "Athlete", "Public figure", "Model"]);
let indexCatalogErrors = [];

for (const item of indexData) {
  const cat = catalogFor(item.id);
  if (!validKnownForCategories.has(cat.knownFor)) {
    indexCatalogErrors.push({ id: item.id, issue: `invalid knownFor: ${cat.knownFor}` });
  }
  if (typeof cat.accentHue !== "number" || isNaN(cat.accentHue) || cat.accentHue < 0 || cat.accentHue >= 360) {
    indexCatalogErrors.push({ id: item.id, issue: `invalid accentHue: ${cat.accentHue}` });
  }
  if (!Array.isArray(cat.tags)) {
    indexCatalogErrors.push({ id: item.id, issue: `tags is not array` });
  }
}
console.log(`Index catalogFor validation errors: ${indexCatalogErrors.length}`);

// 5. Test catalogFor with extreme edge case inputs
const edgeCases = [
  "",
  "   ",
  "12345",
  "李小龙",
  "a".repeat(1000),
  "BRAD-PITT",
  "non-existent-celebrity-xyz",
  "some_underscore_id",
  "special-!@#$%^&*()-chars",
];

let edgeCaseErrors = [];
for (const input of edgeCases) {
  try {
    const res = catalogFor(input);
    if (!res || typeof res.accentHue !== "number" || isNaN(res.accentHue) || res.accentHue < 0 || res.accentHue >= 360) {
      edgeCaseErrors.push({ input, issue: "invalid result", res });
    }
  } catch (err) {
    edgeCaseErrors.push({ input, issue: `threw exception: ${err.message}` });
  }
}
console.log(`Edge case catalogFor errors: ${edgeCaseErrors.length}`);

// 6. Asset availability analysis for all index.json entries
let count192WebP = 0;
let count96WebP = 0;
let countJpg = 0;
let countNoWebP = 0;
let countNoImageAtAll = 0;

let missing192List = [];
let missing96List = [];

for (const item of indexData) {
  const p192 = path.join(ROOT, "public", item.path192.replace(/^\//, ""));
  const p96 = path.join(ROOT, "public", item.path.replace(/^\//, ""));
  const pJpg = item.fallbackPath ? path.join(ROOT, "public", item.fallbackPath.replace(/^\//, "")) : null;

  const has192 = fs.existsSync(p192);
  const has96 = fs.existsSync(p96);
  const hasJpg = pJpg ? fs.existsSync(pJpg) : false;

  if (has192) count192WebP++;
  else missing192List.push(item.id);

  if (has96) count96WebP++;
  else missing96List.push(item.id);

  if (hasJpg) countJpg++;

  if (!has192 && !has96) countNoWebP++;
  if (!has192 && !has96 && !hasJpg) countNoImageAtAll++;
}

console.log("\n--- Asset Availability Stats ---");
console.log(`Total gallery items: ${indexData.length}`);
console.log(`192px WebP images existing: ${count192WebP} / ${indexData.length}`);
console.log(`96px WebP images existing: ${count96WebP} / ${indexData.length}`);
console.log(`JPG fallback images existing: ${countJpg} / ${indexData.length}`);
console.log(`Items missing BOTH 192px and 96px WebP: ${countNoWebP}`);
console.log(`Items missing ALL images (192, 96, JPG): ${countNoImageAtAll}`);

// 7. Component logic simulation for CelebrityPortrait fallback state machine
function simulatePortraitFallback(item, options = {}) {
  // options can simulate image load failures
  const photoUrl192Exists = !options.fail192 && item.path192 && fs.existsSync(path.join(ROOT, "public", item.path192.replace(/^\//, "")));
  const photoUrl96Exists = !options.fail96 && item.path && fs.existsSync(path.join(ROOT, "public", item.path.replace(/^\//, "")));

  const photoUrl192 = item.path192;
  const photoUrl = item.path;

  // Initial stage
  let stage = photoUrl192 ? "192" : photoUrl ? "96" : "failed";

  // Simulate initial load attempt
  if (stage === "192" && !photoUrl192Exists) {
    // onError handler
    if (photoUrl) {
      stage = "96";
      // Second load attempt for 96
      if (!photoUrl96Exists) {
        stage = "failed";
      }
    } else {
      stage = "failed";
    }
  } else if (stage === "96" && !photoUrl96Exists) {
    stage = "failed";
  }

  const showPhoto = (stage === "192" && photoUrl192Exists) || (stage === "96" && photoUrl96Exists);
  const currentSrc = stage === "192" ? photoUrl192 : stage === "96" ? photoUrl : undefined;

  return { stage, showPhoto, currentSrc };
}

let fallbackFailures = [];
for (const item of indexData) {
  // Test normal case
  const norm = simulatePortraitFallback(item);
  if (!norm.showPhoto && (fs.existsSync(path.join(ROOT, "public", item.path192.replace(/^\//, ""))) || fs.existsSync(path.join(ROOT, "public", item.path.replace(/^\//, ""))))) {
    fallbackFailures.push({ id: item.id, issue: "Failed to show photo when valid WebP image exists" });
  }

  // Test failure case (simulating 192 WebP 404/corruption)
  const fail192 = simulatePortraitFallback(item, { fail192: true });
  if (fs.existsSync(path.join(ROOT, "public", item.path.replace(/^\//, ""))) && !fail192.showPhoto) {
    fallbackFailures.push({ id: item.id, issue: "Failed to fallback to 96 WebP when 192 fails" });
  }

  // Test failure of both 192 and 96
  const failBoth = simulatePortraitFallback(item, { fail192: true, fail96: true });
  if (failBoth.showPhoto || failBoth.stage !== "failed") {
    fallbackFailures.push({ id: item.id, issue: "Failed to fallback to 'failed' (initials avatar) when both WebP fail" });
  }
}

console.log(`Portrait fallback simulation errors: ${fallbackFailures.length}`);

// Final Summary
console.log("\n=== STRESS TEST SUMMARY ===");
const totalErrors = orphanCuratedKeys.length + invalidCuratedEntries.length + indexCatalogErrors.length + edgeCaseErrors.length + countNoImageAtAll + fallbackFailures.length;
console.log(`Total Errors/Violations: ${totalErrors}`);

if (totalErrors === 0) {
  console.log("RESULT: ALL STRESS TESTS PASSED PERFECTLY!");
} else {
  console.log("RESULT: STRESS TEST DETECTED ISSUES");
}
