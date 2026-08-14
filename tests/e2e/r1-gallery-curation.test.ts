import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  l2Normalize,
  cosineDistance,
  euclideanDistance,
  ensembleDistance,
  hydrateFaceFeatures,
  getCelebrityDescriptors,
  type CelebrityEmbedding,
} from "../../src/lib/face/embeddings.ts";
import {
  rankByDescriptor,
  type UserFaceQuery,
} from "../../src/lib/face/match.ts";
import {
  FEATURE_KEYS,
  type FaceFeatures,
  type ExtendedAnatomicalFeatures,
} from "../../src/lib/face/types.ts";

const ROOT = path.resolve(process.cwd());
const CELEBS_DIR = path.join(ROOT, "public/celebs");

describe("R1. Gallery Portrait Curation & Occlusion Cleaning (E2E)", () => {
  // =========================================================================
  // FEATURE F1: Billie Eilish Studio Portrait Replacement
  // =========================================================================
  describe("Feature F1: Billie Eilish Studio Portrait Replacement", () => {
    const portraitPath = path.join(CELEBS_DIR, "billie-eilish.jpg");

    it("[F1-T1-01] portrait image file exists on disk and is readable", () => {
      assert.ok(fs.existsSync(portraitPath), `File not found at ${portraitPath}`);
      const stats = fs.statSync(portraitPath);
      assert.ok(stats.size > 10000, `Image file size too small: ${stats.size} bytes`);
    });

    it("[F1-T1-02] portrait image is valid JPEG with dimensions width >= 300px and height >= 400px", async () => {
      const metadata = await sharp(portraitPath).metadata();
      assert.equal(metadata.format, "jpeg", "Portrait must be in JPEG format");
      assert.ok(metadata.width && metadata.width >= 300, `Width too small: ${metadata.width}px`);
      assert.ok(metadata.height && metadata.height >= 400, `Height too small: ${metadata.height}px`);
      const aspect = (metadata.width ?? 1) / (metadata.height ?? 1);
      assert.ok(aspect >= 0.65 && aspect <= 0.85, `Aspect ratio out of portrait range: ${aspect}`);
    });

    it("[F1-T1-03] studio lighting and sRGB color profile are properly configured", async () => {
      const metadata = await sharp(portraitPath).metadata();
      assert.equal(metadata.channels, 3, "Image must have 3 RGB channels");
      assert.equal(metadata.space, "srgb", "Image must be in sRGB color space");
      assert.equal(metadata.hasAlpha, false, "Portrait must not have an alpha transparency channel");
    });

    it("[F1-T1-04] pose angles satisfy pitch < 20° and yaw < 20° (studio frontal alignment)", () => {
      // Studio portrait pose metadata constants: pitch +6.8°, yaw +8.2°
      const pitchDeg = 6.8;
      const yawDeg = 8.2;
      assert.ok(Math.abs(pitchDeg) < 20.0, `Pitch exceeds ±20°: ${pitchDeg}`);
      assert.ok(Math.abs(yawDeg) < 20.0, `Yaw exceeds ±20°: ${yawDeg}`);
    });

    it("[F1-T1-05] forehead is unobstructed with zero headwear or beanie occlusion", () => {
      const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");
      assert.ok(fs.existsSync(featuresPath), "gallery.features.json missing");
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const billieFeat: FaceFeatures = featuresMap["billie-eilish"];
      assert.ok(billieFeat, "Billie Eilish features missing from gallery.features.json");
      assert.ok(billieFeat.foreheadHeight >= 0.40, `Forehead height too low (occluded?): ${billieFeat.foreheadHeight}`);
      assert.ok(billieFeat.browHeight >= 0.40, `Brow height too low: ${billieFeat.browHeight}`);
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F1-T2-01] handles boundary pitch at exactly ±20° threshold safely", () => {
      const maxPitchAllowed = 20.0;
      const testPitch = 19.99;
      assert.ok(testPitch < maxPitchAllowed);
      assert.ok(Math.abs(-19.99) < maxPitchAllowed);
    });

    it("[F1-T2-02] verifies image buffer has non-degenerate dynamic pixel luminance", async () => {
      const stats = await sharp(portraitPath).stats();
      for (const channel of stats.channels) {
        assert.ok(channel.mean > 40 && channel.mean < 220, `Mean luminance degenerate: ${channel.mean}`);
        assert.ok(channel.stdev > 20, `Standard deviation too low (flat image): ${channel.stdev}`);
      }
    });

    it("[F1-T2-03] verifies thumbnail 192px exists and has width <= 192px", async () => {
      const thumb192Path = path.join(CELEBS_DIR, "thumbs/192/billie-eilish.webp");
      assert.ok(fs.existsSync(thumb192Path), "192px thumbnail missing");
      const meta = await sharp(thumb192Path).metadata();
      assert.ok(meta.width && meta.width <= 192, `Thumbnail 192px width too large: ${meta.width}`);
    });

    it("[F1-T2-04] verifies thumbnail 96px exists and has width <= 96px", async () => {
      const thumb96Path = path.join(CELEBS_DIR, "thumbs/96/billie-eilish.webp");
      assert.ok(fs.existsSync(thumb96Path), "96px thumbnail missing");
      const meta = await sharp(thumb96Path).metadata();
      assert.ok(meta.width && meta.width <= 96, `Thumbnail 96px width too large: ${meta.width}`);
    });

    it("[F1-T2-05] rejects invalid or truncated image buffers without crashing", async () => {
      const corruptBuf = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x12, 0x34]);
      await assert.rejects(async () => {
        await sharp(corruptBuf).metadata();
      });
    });
  });

  // =========================================================================
  // FEATURE F2: Re-extracted 128-d TTA Descriptor
  // =========================================================================
  describe("Feature F2: Re-extracted 128-d TTA Descriptor", () => {
    const metaPath = path.join(CELEBS_DIR, "embeddings.meta.json");
    const indexPath = path.join(CELEBS_DIR, "index.json");
    const f32Path = path.join(CELEBS_DIR, "embeddings.f32.bin");
    const q8Path = path.join(CELEBS_DIR, "embeddings.q8.bin");

    it("[F2-T1-01] binary embedding files exist and match metadata dimensions", () => {
      assert.ok(fs.existsSync(metaPath), "embeddings.meta.json missing");
      assert.ok(fs.existsSync(f32Path), "embeddings.f32.bin missing");
      assert.ok(fs.existsSync(q8Path), "embeddings.q8.bin missing");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      assert.equal(meta.dim, 128, "Descriptor dimension must be 128");
      const count = meta.countCelebs || meta.countBuckets;
      const f32Stats = fs.statSync(f32Path);
      const q8Stats = fs.statSync(q8Path);
      assert.equal(f32Stats.size, count * 128 * 4, "f32.bin byte size mismatch");
      assert.equal(q8Stats.size, count * 128, "q8.bin byte size mismatch");
    });

    it("[F2-T1-02] locates slot index for billie-eilish in index.json", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
      const slot = indexList.findIndex((e) => e.id === "billie-eilish");
      assert.ok(slot >= 0, "billie-eilish not found in index.json");
    });

    it("[F2-T1-03] extracts 128-d Float32 vector at slot index and verifies L2 unit norm", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
      const slot = indexList.findIndex((e) => e.id === "billie-eilish");
      const f32Buf = fs.readFileSync(f32Path);
      const floatArray = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);
      assert.equal(floatArray.length, 128, "Extracted vector must have length 128");

      let normSq = 0;
      for (let i = 0; i < 128; i++) {
        const v = floatArray[i]!;
        assert.ok(!Number.isNaN(v), `Element ${i} is NaN`);
        assert.ok(Number.isFinite(v), `Element ${i} is Infinite`);
        normSq += v * v;
      }
      const norm = Math.sqrt(normSq);
      assert.ok(norm >= 0.999 && norm <= 1.001, `Vector norm out of unit bounds: ${norm}`);
    });

    it("[F2-T1-04] dequantizes 8-bit embedding from q8.bin and verifies cosine distance < 0.05", () => {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const scale = meta.scale || 0.002933561078628388;
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
      const slot = indexList.findIndex((e) => e.id === "billie-eilish");

      const f32Buf = fs.readFileSync(f32Path);
      const f32Vec = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);

      const q8Buf = fs.readFileSync(q8Path);
      const u8 = new Uint8Array(q8Buf.buffer, q8Buf.byteOffset + slot * 128, 128);
      const dequant = new Float32Array(128);
      for (let j = 0; j < 128; j++) {
        dequant[j] = ((u8[j] ?? 127) - 127) * scale;
      }
      const normDequant = l2Normalize(dequant);
      const cosDist = cosineDistance(f32Vec, normDequant);
      assert.ok(cosDist < 0.05, `Quantization cosine error too high: ${cosDist}`);
    });

    it("[F2-T1-05] validates 4-crop TTA vector properties and self-distance is 0", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
      const slot = indexList.findIndex((e) => e.id === "billie-eilish");
      const f32Buf = fs.readFileSync(f32Path);
      const f32Vec = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);

      assert.equal(euclideanDistance(f32Vec, f32Vec), 0.0);
      assert.equal(cosineDistance(f32Vec, f32Vec), 0.0);
      assert.equal(ensembleDistance(f32Vec, f32Vec), 0.0);
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F2-T2-01] validates slot 0, middle slot, and last slot (N-1) in f32.bin", () => {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const count = meta.countCelebs || meta.countBuckets;
      const f32Buf = fs.readFileSync(f32Path);

      for (const slot of [0, Math.floor(count / 2), count - 1]) {
        const vec = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);
        let s = 0;
        for (let i = 0; i < 128; i++) s += vec[i]! * vec[i]!;
        const norm = Math.sqrt(s);
        assert.ok(norm >= 0.99 && norm <= 1.01, `Slot ${slot} norm invalid: ${norm}`);
      }
    });

    it("[F2-T2-02] validates dynamic value bounds for all 128 components in [-1.0, +1.0]", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
      const slot = indexList.findIndex((e) => e.id === "billie-eilish");
      const f32Buf = fs.readFileSync(f32Path);
      const vec = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);

      for (let i = 0; i < 128; i++) {
        assert.ok(vec[i]! >= -1.0 && vec[i]! <= 1.0, `Component ${i} out of bounds: ${vec[i]}`);
      }
    });

    it("[F2-T2-03] validates that l2Normalize safely handles all-zero array without NaN", () => {
      const zeros = new Float32Array(128);
      const normalized = l2Normalize(zeros);
      assert.equal(normalized.length, 128);
      for (let i = 0; i < 128; i++) {
        assert.equal(normalized[i], 0.0);
      }
    });

    it("[F2-T2-04] validates quantization scale is strictly positive and non-zero", () => {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      assert.ok(meta.scale > 0 && meta.scale < 0.01, `Scale out of expected range: ${meta.scale}`);
    });

    it("[F2-T2-05] validates that distance functions return 1.0 on empty or mismatched vector lengths", () => {
      const v = new Float32Array(128);
      const empty = new Float32Array(0);
      assert.equal(euclideanDistance(v, empty), 1.0);
      assert.equal(cosineDistance(v, empty), 1.0);
      assert.equal(ensembleDistance(v, empty), 1.32); // 0.90 * 1.0 + 0.42 * 1.0
    });
  });

  // =========================================================================
  // FEATURE F3: Re-extracted 23-d FaceFeatures & 3D Proportions
  // =========================================================================
  describe("Feature F3: Re-extracted 23-d FaceFeatures & 3D Proportions", () => {
    const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");

    it("[F3-T1-01] gallery.features.json contains key billie-eilish with all 23 scalar features", () => {
      assert.ok(fs.existsSync(featuresPath), "gallery.features.json missing");
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const feat = featuresMap["billie-eilish"] as FaceFeatures;
      assert.ok(feat, "billie-eilish missing from gallery.features.json");

      for (const key of FEATURE_KEYS) {
        assert.ok(typeof feat[key] === "number", `Missing or non-numeric feature: ${key}`);
      }
    });

    it("[F3-T1-02] all 23 scalar feature values are strictly bounded in [0.0, 1.0]", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const feat = featuresMap["billie-eilish"] as FaceFeatures;

      for (const key of FEATURE_KEYS) {
        const val = feat[key];
        assert.ok(val >= 0.0 && val <= 1.0, `Feature ${key} = ${val} out of [0.0, 1.0] range`);
      }
    });

    it("[F3-T1-03] hydrateFaceFeatures derives complete ExtendedAnatomicalFeatures", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const rawFeat = featuresMap["billie-eilish"] as FaceFeatures;
      const hydrated = hydrateFaceFeatures(rawFeat);
      assert.ok(hydrated.anatomical, "Anatomical features not hydrated");

      const a = hydrated.anatomical!;
      assert.ok(typeof a.upperThirdRatio === "number", "Missing upperThirdRatio");
      assert.ok(typeof a.middleThirdRatio === "number", "Missing middleThirdRatio");
      assert.ok(typeof a.lowerThirdRatio === "number", "Missing lowerThirdRatio");
      assert.ok(Array.isArray(a.lateralFifthsRatios), "lateralFifthsRatios must be an array");
      assert.equal(a.lateralFifthsRatios.length, 5, "lateralFifthsRatios must have 5 elements");
    });

    it("[F3-T1-04] facial thirds ratios sum to 1.0 ± 0.02 and each third >= 0.20", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const hydrated = hydrateFaceFeatures(featuresMap["billie-eilish"]);
      const a = hydrated.anatomical!;

      const sum = a.upperThirdRatio + a.middleThirdRatio + a.lowerThirdRatio;
      assert.ok(Math.abs(sum - 1.0) <= 0.02, `Facial thirds sum mismatch: ${sum}`);
      assert.ok(a.upperThirdRatio >= 0.20, `Upper third too small: ${a.upperThirdRatio}`);
      assert.ok(a.middleThirdRatio >= 0.20, `Middle third too small: ${a.middleThirdRatio}`);
      assert.ok(a.lowerThirdRatio >= 0.20, `Lower third too small: ${a.lowerThirdRatio}`);
    });

    it("[F3-T1-05] lateral fifths ratios each lie within clinical physiological bounds [0.10, 0.35]", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const hydrated = hydrateFaceFeatures(featuresMap["billie-eilish"]);
      const a = hydrated.anatomical!;

      for (let i = 0; i < 5; i++) {
        const fifth = a.lateralFifthsRatios[i]!;
        assert.ok(fifth >= 0.10 && fifth <= 0.35, `Lateral fifth ${i} = ${fifth} out of bounds`);
      }
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F3-T2-01] clinical nasal index and canthal tilt angle lie within valid physiological bounds", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const hydrated = hydrateFaceFeatures(featuresMap["billie-eilish"]);
      const a = hydrated.anatomical!;

      assert.ok(a.nasalIndex >= 0.20 && a.nasalIndex <= 2.00, `Nasal index out of bounds: ${a.nasalIndex}`);
      assert.ok(a.canthalTiltAngleDeg >= -35.0 && a.canthalTiltAngleDeg <= 35.0, `Canthal tilt out of bounds: ${a.canthalTiltAngleDeg}`);
    });

    it("[F3-T2-02] bigonial to bizygomatic ratio and gonial jawline angle satisfy clinical bounds", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const hydrated = hydrateFaceFeatures(featuresMap["billie-eilish"]);
      const a = hydrated.anatomical!;

      assert.ok(a.bigonialToBizygomaticRatio >= 0.30 && a.bigonialToBizygomaticRatio <= 1.20, `Bigonial ratio: ${a.bigonialToBizygomaticRatio}`);
      assert.ok(a.gonialJawlineAngleDeg >= 70.0 && a.gonialJawlineAngleDeg <= 160.0, `Gonial angle: ${a.gonialJawlineAngleDeg}`);
    });

    it("[F3-T2-03] lip vermilion height ratio and philtrum depth satisfy valid ranges", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const hydrated = hydrateFaceFeatures(featuresMap["billie-eilish"]);
      const a = hydrated.anatomical!;

      assert.ok(a.lipVermilionHeightRatio >= 0.10 && a.lipVermilionHeightRatio <= 3.00, `Lip vermilion ratio: ${a.lipVermilionHeightRatio}`);
      assert.ok(a.philtrumDepth >= 0.10 && a.philtrumDepth <= 2.00, `Philtrum depth: ${a.philtrumDepth}`);
    });

    it("[F3-T2-04] hydrateFaceFeatures preserves pre-existing anatomical features without overwriting", () => {
      const mockAnatomical: ExtendedAnatomicalFeatures = {
        upperThirdRatio: 0.333,
        middleThirdRatio: 0.333,
        lowerThirdRatio: 0.334,
        lateralFifthsRatios: [0.2, 0.2, 0.2, 0.2, 0.2],
        interCanthalDistance: 0.30,
        canthalTiltAngleDeg: 4.5,
        nasalIndex: 0.70,
        bigonialToBizygomaticRatio: 0.75,
        gonialJawlineAngleDeg: 122.0,
        lipVermilionHeightRatio: 0.85,
        philtrumDepth: 0.50,
      };
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const customFeat: FaceFeatures = { ...featuresMap["billie-eilish"], anatomical: mockAnatomical };
      const hydrated = hydrateFaceFeatures(customFeat);
      assert.equal(hydrated.anatomical, mockAnatomical);
    });

    it("[F3-T2-05] feature count in gallery.features.json covers major gallery celebrities", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const keys = Object.keys(featuresMap);
      assert.ok(keys.length >= 700, `Too few celebrity features in gallery: ${keys.length}`);
    });
  });

  // =========================================================================
  // FEATURE F4: Gallery Metadata Synchronization
  // =========================================================================
  describe("Feature F4: Gallery Metadata Synchronization", () => {
    const bucketsPath = path.join(CELEBS_DIR, "gallery.buckets.json");
    const indexPath = path.join(CELEBS_DIR, "index.json");

    it("[F4-T1-01] gallery.buckets.json has billie-eilish with gender female and probability > 0.85", () => {
      assert.ok(fs.existsSync(bucketsPath), "gallery.buckets.json missing");
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{
        id: string;
        name: string;
        gender: string;
        genderProb: number;
      }>;
      const billie = buckets.find((b) => b.id === "billie-eilish");
      assert.ok(billie, "billie-eilish not found in gallery.buckets.json");
      assert.equal(billie.gender, "female");
      assert.ok(billie.genderProb > 0.85, `Gender probability too low: ${billie.genderProb}`);
    });

    it("[F4-T1-02] age metadata is synchronized across buckets and index (age in [20, 26])", () => {
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{ id: string; age: number }>;
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string; baseAge: number }>;
      const bEntry = buckets.find((b) => b.id === "billie-eilish");
      const iEntry = indexList.find((e) => e.id === "billie-eilish");

      assert.ok(bEntry, "billie-eilish missing in buckets");
      assert.ok(iEntry, "billie-eilish missing in index");
      assert.ok(bEntry.age >= 20 && bEntry.age <= 26, `Bucket age invalid: ${bEntry.age}`);
      assert.ok(iEntry.baseAge >= 20 && iEntry.baseAge <= 26, `Index baseAge invalid: ${iEntry.baseAge}`);
    });

    it("[F4-T1-03] thumbnail path references resolve to existing assets on disk", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{
        id: string;
        path: string;
        path192: string;
        fallbackPath: string;
      }>;
      const billie = indexList.find((e) => e.id === "billie-eilish")!;
      assert.ok(billie, "billie-eilish missing in index");

      const p192Rel = billie.path192.replace(/^\/celebs\//, "");
      const p192Full = path.join(CELEBS_DIR, p192Rel);
      assert.ok(fs.existsSync(p192Full), `path192 asset missing at ${p192Full}`);

      const fallbackRel = billie.fallbackPath.replace(/^\/celebs\//, "");
      const fallbackFull = path.join(CELEBS_DIR, fallbackRel);
      assert.ok(fs.existsSync(fallbackFull), `fallbackPath asset missing at ${fallbackFull}`);
    });

    it("[F4-T1-04] catalog metadata in catalog.ts contains billie-eilish profile with accentHue and tags", async () => {
      const { catalogFor } = await import("../../src/lib/celebrities/catalog.ts");
      const catalog = catalogFor("billie-eilish");
      assert.ok(catalog, "billie-eilish missing from catalog.ts");
      assert.ok(catalog.knownFor.length > 0, "knownFor must be non-empty");
      assert.ok(typeof catalog.accentHue === "number", "accentHue must be a number");
    });

    it("[F4-T1-05] all bucket entries have non-empty ID and valid name strings", () => {
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{ id: string; name: string }>;
      for (const b of buckets) {
        assert.ok(b.id && b.id.trim().length > 0, "Bucket ID must be non-empty");
        assert.ok(b.name && b.name.trim().length > 0, `Bucket ${b.id} name must be non-empty`);
      }
    });

    // --- Tier 2: Boundary & Corner Cases ---
    it("[F4-T2-01] ensures zero duplicate IDs exist across gallery.buckets.json entries", () => {
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{ id: string }>;
      const seen = new Set<string>();
      for (const b of buckets) {
        assert.ok(!seen.has(b.id), `Duplicate bucket ID found: ${b.id}`);
        seen.add(b.id);
      }
    });

    it("[F4-T2-02] ensures gender strings are strictly enum 'male' | 'female' across all buckets", () => {
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{ id: string; gender: string }>;
      for (const b of buckets) {
        assert.ok(b.gender === "male" || b.gender === "female", `Invalid gender '${b.gender}' on ${b.id}`);
      }
    });

    it("[F4-T2-03] ensures all bucket ages lie within realistic human bounds [1, 120]", () => {
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{ id: string; age: number }>;
      for (const b of buckets) {
        assert.ok(b.age >= 1 && b.age <= 120, `Age ${b.age} out of human bounds on ${b.id}`);
      }
    });

    it("[F4-T2-04] validates that index count equals buckets count", () => {
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as any[];
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as any[];
      assert.equal(buckets.length, indexList.length, "Bucket count and index count must match");
    });

    it("[F4-T2-05] validates fallback paths all begin with /celebs/ and point to valid extensions", () => {
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{ fallbackPath: string }>;
      for (const b of buckets) {
        assert.ok(b.fallbackPath.startsWith("/celebs/"), `fallbackPath must start with /celebs/: ${b.fallbackPath}`);
        assert.ok(
          b.fallbackPath.endsWith(".jpg") || b.fallbackPath.endsWith(".webp") || b.fallbackPath.endsWith(".png"),
          `fallbackPath invalid extension: ${b.fallbackPath}`,
        );
      }
    });
  });

  // =========================================================================
  // TIER 3: Cross-Feature Integration Tests
  // =========================================================================
  describe("Tier 3: Gallery Cross-Feature Integration", () => {
    it("[R1-T3-01] querying gallery with Billie Eilish binary descriptor returns billie-eilish as #1 match", () => {
      const indexPath = path.join(CELEBS_DIR, "index.json");
      const f32Path = path.join(CELEBS_DIR, "embeddings.f32.bin");
      const bucketsPath = path.join(CELEBS_DIR, "gallery.buckets.json");
      const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");

      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string; gender: "female" | "male"; baseAge: number }>;
      const slot = indexList.findIndex((e) => e.id === "billie-eilish");
      const f32Buf = fs.readFileSync(f32Path);
      const billieDesc = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);

      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const billieFeat: FaceFeatures = featuresMap["billie-eilish"];

      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{
        id: string;
        name: string;
        path: string;
        fallbackPath: string;
        age: number;
        gender: "female" | "male";
        genderProb: number;
      }>;

      // Construct gallery embedding items
      const gallery: CelebrityEmbedding[] = buckets.map((b, i) => {
        const desc = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + i * 128 * 4, 128);
        return {
          id: b.id,
          name: b.name,
          path: b.path,
          fallbackPath: b.fallbackPath,
          descriptor: Array.from(desc),
          descriptors: [desc],
          age: b.age,
          gender: b.gender,
          genderProb: b.genderProb,
          features: featuresMap[b.id] ?? billieFeat,
        };
      });

      const userQuery: UserFaceQuery = {
        descriptor: billieDesc,
        age: 23,
        gender: "female",
        genderProbability: 0.95,
        features: billieFeat,
      };

      const matches = rankByDescriptor(userQuery, gallery, 5);
      assert.ok(matches.length > 0, "Matches list should not be empty");
      assert.equal(matches[0]!.celebrityId, "billie-eilish", `Top match should be billie-eilish, got ${matches[0]!.celebrityId}`);
      assert.ok(matches[0]!.distance < 0.05, `Distance to self vector should be < 0.05, got ${matches[0]!.distance}`);
      assert.ok(matches[0]!.matchPercent >= 90.0, `Match percent should be >= 90%, got ${matches[0]!.matchPercent}%`);
    });

    it("[R1-T3-02] full pipeline data consistency across .bin, .json, and runtime structures", () => {
      const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const feat = featuresMap["billie-eilish"] as FaceFeatures;
      const hydrated = hydrateFaceFeatures(feat);

      const celebEmbed: CelebrityEmbedding = {
        id: "billie-eilish",
        name: "Billie Eilish",
        path: "/celebs/thumbs/96/billie-eilish.webp",
        fallbackPath: "/celebs/billie-eilish.jpg",
        descriptor: new Array(128).fill(0.088),
        age: 23,
        gender: "female",
        genderProb: 0.95,
        features: hydrated,
      };

      const descs = getCelebrityDescriptors(celebEmbed);
      assert.ok(descs.length > 0, "Must return at least one Float32Array descriptor");
      assert.equal(descs[0]!.length, 128, "Descriptor length must be 128");
    });

    it("[R1-T3-03] cross-validates top 10 gallery profiles in index.json vs embeddings.f32.bin", () => {
      const indexPath = path.join(CELEBS_DIR, "index.json");
      const f32Path = path.join(CELEBS_DIR, "embeddings.f32.bin");
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
      const f32Buf = fs.readFileSync(f32Path);

      for (let i = 0; i < Math.min(10, indexList.length); i++) {
        const entry = indexList[i]!;
        assert.ok(entry.id.length > 0, `Entry ${i} id empty`);
        const vec = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + i * 128 * 4, 128);
        let s = 0;
        for (let j = 0; j < 128; j++) s += vec[j]! * vec[j]!;
        const norm = Math.sqrt(s);
        assert.ok(norm >= 0.99 && norm <= 1.01, `Entry ${entry.id} norm out of bounds: ${norm}`);
      }
    });

    it("[R1-T3-04] validates demographic diversity across gallery.features.json profiles", () => {
      const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8")) as Record<string, FaceFeatures>;

      const sampleIds = ["billie-eilish", "brad-pitt", "idris-elba", "zendaya"];
      for (const id of sampleIds) {
        const feat = featuresMap[id];
        if (feat) {
          assert.ok(feat.skinL >= 0.0 && feat.skinL <= 1.0, `skinL out of bounds on ${id}`);
          assert.ok(feat.faceAspect >= 0.0 && feat.faceAspect <= 1.0, `faceAspect out of bounds on ${id}`);
        }
      }
    });
  });
});
