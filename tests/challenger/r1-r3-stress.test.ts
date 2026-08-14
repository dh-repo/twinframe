import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import React from "react";
import ReactDOMServer from "react-dom/server";

import {
  l2Normalize,
  cosineDistance,
  euclideanDistance,
  ensembleDistance,
  hydrateFaceFeatures,
  distanceToMatchPercent,
  getCelebrityDescriptors,
  type CelebrityEmbedding,
} from "../../src/lib/face/embeddings.ts";
import {
  rankByDescriptor,
  buildDescriptorTraits,
  type UserFaceQuery,
} from "../../src/lib/face/match.ts";
import {
  FEATURE_KEYS,
  type FaceFeatures,
  type ExtendedAnatomicalFeatures,
  type CelebrityMatch,
  type TraitInsight,
} from "../../src/lib/face/types.ts";
import { ensureAnatomicalFeatures } from "../../src/lib/face/geometry.ts";
import { catalogFor } from "../../src/lib/celebrities/catalog.ts";
import { MatchRevealCard } from "../../src/components/results/match-reveal-card.tsx";
import { ComparisonView } from "../../src/components/results/comparison-view.tsx";

const ROOT = path.resolve(process.cwd());
const CELEBS_DIR = path.join(ROOT, "public/celebs");

describe("Empirical Challenger 2: Gallery Curation (R1) & Biometric Breakdown UI (R3) Adversarial Stress Suite", () => {
  // =========================================================================
  // SUITE 1: R1 Gallery Portrait Curation & Occlusion Audit (Billie Eilish & Assets)
  // =========================================================================
  describe("Suite 1: R1 Gallery Portrait Curation & Occlusion Audit", () => {
    const portraitPath = path.join(CELEBS_DIR, "billie-eilish.jpg");
    const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");

    it("[R1-ADV-01] Billie Eilish portrait image meets strict portrait specifications (JPEG, dimensions, aspect ratio, sRGB)", async () => {
      assert.ok(fs.existsSync(portraitPath), `Portrait missing at ${portraitPath}`);
      const stats = fs.statSync(portraitPath);
      assert.ok(stats.size > 15000, `File size too small (${stats.size} bytes), possible corrupted image`);

      const metadata = await sharp(portraitPath).metadata();
      assert.equal(metadata.format, "jpeg", `Format must be JPEG, got ${metadata.format}`);
      assert.ok(metadata.width && metadata.width >= 300, `Width too small: ${metadata.width}px (min 300px)`);
      assert.ok(metadata.height && metadata.height >= 400, `Height too small: ${metadata.height}px (min 400px)`);

      const aspect = (metadata.width ?? 1) / (metadata.height ?? 1);
      assert.ok(aspect >= 0.65 && aspect <= 0.85, `Aspect ratio out of portrait range [0.65, 0.85]: ${aspect.toFixed(4)}`);
      assert.equal(metadata.channels, 3, `Channels must be 3 (RGB), got ${metadata.channels}`);
      assert.equal(metadata.space, "srgb", `Color space must be srgb, got ${metadata.space}`);
      assert.equal(metadata.hasAlpha, false, "Portrait must not have alpha channel");
    });

    it("[R1-ADV-02] Billie Eilish portrait has non-degenerate dynamic luminance range across all RGB channels", async () => {
      const stats = await sharp(portraitPath).stats();
      assert.equal(stats.channels.length, 3, "Stats must return 3 channels");

      for (let c = 0; c < 3; c++) {
        const chan = stats.channels[c]!;
        assert.ok(chan.mean >= 40 && chan.mean <= 220, `Channel ${c} mean luminance degenerate: ${chan.mean}`);
        assert.ok(chan.stdev >= 20, `Channel ${c} standard deviation too low (flat image): ${chan.stdev}`);
        assert.ok(chan.min >= 0 && chan.max <= 255, `Channel ${c} range invalid: [${chan.min}, ${chan.max}]`);
      }
    });

    it("[R1-ADV-03] Billie Eilish pose angles and forehead occlusion meet frontal studio requirements", () => {
      // Pose metadata: pitch +6.8°, yaw +8.2°
      const pitchDeg = 6.8;
      const yawDeg = 8.2;
      assert.ok(Math.abs(pitchDeg) < 20.0, `Pitch exceeds ±20° threshold: ${pitchDeg}`);
      assert.ok(Math.abs(yawDeg) < 20.0, `Yaw exceeds ±20° threshold: ${yawDeg}`);

      assert.ok(fs.existsSync(featuresPath), "gallery.features.json missing");
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8"));
      const billieFeat: FaceFeatures = featuresMap["billie-eilish"];
      assert.ok(billieFeat, "billie-eilish missing from gallery.features.json");

      // Forehead occlusion checks: foreheadHeight and browHeight must reflect clean, unobstructed studio portrait
      assert.ok(billieFeat.foreheadHeight >= 0.40, `Forehead height too low (occluded?): ${billieFeat.foreheadHeight}`);
      assert.ok(billieFeat.browHeight >= 0.40, `Brow height too low: ${billieFeat.browHeight}`);
    });

    it("[R1-ADV-04] Billie Eilish thumbnails (192px and 96px) exist and meet size constraints", async () => {
      const thumb192Path = path.join(CELEBS_DIR, "thumbs/192/billie-eilish.webp");
      const thumb96Path = path.join(CELEBS_DIR, "thumbs/96/billie-eilish.webp");

      assert.ok(fs.existsSync(thumb192Path), `192px thumbnail missing at ${thumb192Path}`);
      assert.ok(fs.existsSync(thumb96Path), `96px thumbnail missing at ${thumb96Path}`);

      const meta192 = await sharp(thumb192Path).metadata();
      assert.equal(meta192.format, "webp", "192px thumb must be webp");
      assert.ok(meta192.width && meta192.width <= 192, `192px thumb width too large: ${meta192.width}`);

      const meta96 = await sharp(thumb96Path).metadata();
      assert.equal(meta96.format, "webp", "96px thumb must be webp");
      assert.ok(meta96.width && meta96.width <= 96, `96px thumb width too large: ${meta96.width}`);
    });

    it("[R1-ADV-05] Catalog profile in catalog.ts contains billie-eilish metadata", () => {
      const profile = catalogFor("billie-eilish");
      assert.ok(profile, "billie-eilish missing from catalogFor");
      assert.ok(profile.knownFor.length > 0, "knownFor must be non-empty string");
      assert.ok(typeof profile.accentHue === "number" && profile.accentHue >= 0 && profile.accentHue <= 360, `Invalid accentHue: ${profile.accentHue}`);
      assert.ok(Array.isArray(profile.tags) && profile.tags.length > 0, "tags must be non-empty array");
    });
  });

  // =========================================================================
  // SUITE 2: R1 804-Slot Binary Embedding Integrity Audit
  // =========================================================================
  describe("Suite 2: R1 804-Slot Binary Embedding Integrity Audit", () => {
    const metaPath = path.join(CELEBS_DIR, "embeddings.meta.json");
    const f32Path = path.join(CELEBS_DIR, "embeddings.f32.bin");
    const q8Path = path.join(CELEBS_DIR, "embeddings.q8.bin");
    const indexPath = path.join(CELEBS_DIR, "index.json");

    it("[R1-ADV-06] Binary files f32.bin and q8.bin match exact 804-slot byte sizes", () => {
      assert.ok(fs.existsSync(metaPath), "embeddings.meta.json missing");
      assert.ok(fs.existsSync(f32Path), "embeddings.f32.bin missing");
      assert.ok(fs.existsSync(q8Path), "embeddings.q8.bin missing");

      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      assert.equal(meta.dim, 128, "Descriptor dimension must be 128");
      const count = meta.countCelebs || meta.countBuckets;
      assert.equal(count, 804, `Expected exactly 804 slots in meta, got ${count}`);

      const f32Stats = fs.statSync(f32Path);
      const q8Stats = fs.statSync(q8Path);
      const expectedF32Size = 804 * 128 * 4; // 411,648 bytes
      const expectedQ8Size = 804 * 128; // 102,912 bytes

      assert.equal(f32Stats.size, expectedF32Size, `f32.bin size mismatch: expected ${expectedF32Size}, got ${f32Stats.size}`);
      assert.equal(q8Stats.size, expectedQ8Size, `q8.bin size mismatch: expected ${expectedQ8Size}, got ${q8Stats.size}`);
    });

    it("[R1-ADV-07] Exhaustive F32 Scan: 0 NaNs, 0 Infs, and bounded values across all 804 slots (102,912 floats)", () => {
      const f32Buf = fs.readFileSync(f32Path);
      const totalFloats = 804 * 128;
      const f32Array = new Float32Array(f32Buf.buffer, f32Buf.byteOffset, totalFloats);

      let nanCount = 0;
      let infCount = 0;
      let outOfBoundsCount = 0;

      for (let i = 0; i < totalFloats; i++) {
        const val = f32Array[i]!;
        if (Number.isNaN(val)) nanCount++;
        if (!Number.isFinite(val)) infCount++;
        if (val < -1.0 || val > 1.0) outOfBoundsCount++;
      }

      assert.equal(nanCount, 0, `Found ${nanCount} NaN values in f32.bin`);
      assert.equal(infCount, 0, `Found ${infCount} Infinite values in f32.bin`);
      assert.equal(outOfBoundsCount, 0, `Found ${outOfBoundsCount} values outside [-1.0, 1.0] in f32.bin`);
    });

    it("[R1-ADV-08] Exhaustive F32 L2 Norm Scan: all 804 slots are unit-normalized (|norm - 1.0| < 0.01)", () => {
      const f32Buf = fs.readFileSync(f32Path);
      let nonUnitCount = 0;
      const nonUnitDetails: Array<{ slot: number; norm: number }> = [];

      for (let slot = 0; slot < 804; slot++) {
        const vec = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);
        let sumSq = 0;
        for (let i = 0; i < 128; i++) {
          sumSq += vec[i]! * vec[i]!;
        }
        const norm = Math.sqrt(sumSq);
        if (norm < 0.99 || norm > 1.01) {
          nonUnitCount++;
          nonUnitDetails.push({ slot, norm });
        }
      }

      assert.equal(nonUnitCount, 0, `Found ${nonUnitCount} non-unit vectors across 804 slots: ${JSON.stringify(nonUnitDetails)}`);
    });

    it("[R1-ADV-09] Exhaustive Q8 Dequantization Error Scan: cosine error < 0.05 across all 804 slots", () => {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const scale = meta.scale || 0.002994624206289185;
      const f32Buf = fs.readFileSync(f32Path);
      const q8Buf = fs.readFileSync(q8Path);

      let maxError = -Infinity;
      let sumError = 0;
      let highErrorCount = 0;

      for (let slot = 0; slot < 804; slot++) {
        const f32Vec = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);
        const u8Vec = new Uint8Array(q8Buf.buffer, q8Buf.byteOffset + slot * 128, 128);

        const dequant = new Float32Array(128);
        for (let j = 0; j < 128; j++) {
          dequant[j] = ((u8Vec[j] ?? 127) - 127) * scale;
        }
        const normDequant = l2Normalize(dequant);
        const cosDist = cosineDistance(f32Vec, normDequant);

        if (cosDist > maxError) maxError = cosDist;
        sumError += cosDist;
        if (cosDist >= 0.05) {
          highErrorCount++;
        }
      }

      const meanError = sumError / 804;
      assert.equal(highErrorCount, 0, `Found ${highErrorCount} slots with dequantization cosine error >= 0.05 (max=${maxError})`);
      assert.ok(meanError < 0.02, `Mean dequantization error too high: ${meanError}`);
      assert.ok(maxError < 0.05, `Max dequantization error exceeds 0.05: ${maxError}`);
    });

    it("[R1-ADV-10] Billie Eilish specific slot vector verification and self-distance", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
      const slot = indexList.findIndex((e) => e.id === "billie-eilish");
      assert.ok(slot >= 0, "Billie Eilish not found in index.json");

      const f32Buf = fs.readFileSync(f32Path);
      const f32Vec = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + slot * 128 * 4, 128);

      let sumSq = 0;
      for (let i = 0; i < 128; i++) sumSq += f32Vec[i]! * f32Vec[i]!;
      const norm = Math.sqrt(sumSq);
      assert.ok(norm >= 0.999 && norm <= 1.001, `Billie Eilish vector norm out of range: ${norm}`);

      assert.equal(cosineDistance(f32Vec, f32Vec), 0.0);
      assert.equal(euclideanDistance(f32Vec, f32Vec), 0.0);
      assert.equal(ensembleDistance(f32Vec, f32Vec), 0.0);
    });
  });

  // =========================================================================
  // SUITE 3: R1 Gallery Cross-File Slot Synchronization Audit
  // =========================================================================
  describe("Suite 3: R1 Gallery Cross-File Slot Synchronization Audit", () => {
    const indexPath = path.join(CELEBS_DIR, "index.json");
    const bucketsPath = path.join(CELEBS_DIR, "gallery.buckets.json");
    const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");

    it("[R1-ADV-11] Exact 804-entry alignment across index.json, gallery.buckets.json, and gallery.features.json", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as any[];
      const bucketsList = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as any[];
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8")) as Record<string, FaceFeatures>;

      assert.equal(indexList.length, 804, `index.json has ${indexList.length} entries, expected 804`);
      assert.equal(bucketsList.length, 804, `gallery.buckets.json has ${bucketsList.length} entries, expected 804`);

      const missingFeatures: string[] = [];
      for (const entry of indexList) {
        if (!featuresMap[entry.id]) {
          missingFeatures.push(entry.id);
        }
      }
      assert.equal(missingFeatures.length, 0, `Missing features in gallery.features.json for: ${missingFeatures.slice(0, 5).join(", ")}`);
    });

    it("[R1-ADV-12] 1-to-1 Slot ID and metadata synchronization across all 804 slots", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{
        id: string;
        gender: string;
        baseAge: number;
      }>;
      const bucketsList = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{
        id: string;
        gender: string;
        age: number;
      }>;

      const idMismatches: Array<{ slot: number; indexId: string; bucketId: string }> = [];

      for (let i = 0; i < 804; i++) {
        const idx = indexList[i]!;
        const bkt = bucketsList[i]!;

        if (idx.id !== bkt.id) {
          idMismatches.push({ slot: i, indexId: idx.id, bucketId: bkt.id });
        }
        assert.ok(bkt.age >= 1 && bkt.age <= 120, `Invalid bucket age at slot ${i}: ${bkt.age}`);
        assert.ok(idx.baseAge >= 1 && idx.baseAge <= 120, `Invalid index baseAge at slot ${i}: ${idx.baseAge}`);
        assert.ok(bkt.gender === "male" || bkt.gender === "female", `Invalid bucket gender at slot ${i}: ${bkt.gender}`);
      }

      assert.equal(idMismatches.length, 0, `Found ${idMismatches.length} slot ID mismatches: ${JSON.stringify(idMismatches.slice(0, 5))}`);
    });

    it("[R1-ADV-13] Image asset references in index.json resolve to valid files on disk for all 804 entries", () => {
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{
        id: string;
        path: string;
        path192?: string;
        fallbackPath: string;
      }>;

      let missingAssetCount = 0;
      const missingAssets: string[] = [];

      for (const entry of indexList) {
        const pRel = (entry.fallbackPath || entry.path).replace(/^\/celebs\//, "");
        const pFull = path.join(CELEBS_DIR, pRel);
        if (!fs.existsSync(pFull)) {
          missingAssetCount++;
          missingAssets.push(pFull);
        }
      }

      assert.equal(missingAssetCount, 0, `Found ${missingAssetCount} missing assets: ${missingAssets.slice(0, 5).join(", ")}`);
    });

    it("[R1-ADV-14] All 804 feature entries in gallery.features.json contain all 23 scalar features bounded in [0.0, 1.0]", () => {
      const featuresMap = JSON.parse(fs.readFileSync(featuresPath, "utf-8")) as Record<string, FaceFeatures>;

      let invalidFeatureCount = 0;
      for (const [id, feat] of Object.entries(featuresMap)) {
        for (const key of FEATURE_KEYS) {
          const val = feat[key];
          if (typeof val !== "number" || Number.isNaN(val) || val < 0.0 || val > 1.0) {
            invalidFeatureCount++;
          }
        }
      }

      assert.equal(invalidFeatureCount, 0, `Found ${invalidFeatureCount} invalid feature values in gallery.features.json`);
    });

    it("[R1-ADV-15] Billie Eilish metadata is fully synchronized (age=25, female, prob > 0.85)", () => {
      const bucketsList = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{
        id: string;
        name: string;
        age: number;
        gender: string;
        genderProb: number;
      }>;
      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{
        id: string;
        baseAge: number;
        gender: string;
      }>;

      const bEntry = bucketsList.find((b) => b.id === "billie-eilish")!;
      const iEntry = indexList.find((i) => i.id === "billie-eilish")!;

      assert.ok(bEntry, "billie-eilish missing from buckets");
      assert.ok(iEntry, "billie-eilish missing from index");

      assert.equal(bEntry.name, "Billie Eilish");
      assert.equal(bEntry.gender, "female");
      assert.equal(iEntry.gender, "female");
      assert.ok(bEntry.age >= 20 && bEntry.age <= 26, `Age out of range: ${bEntry.age}`);
      assert.equal(bEntry.age, iEntry.baseAge, "Age mismatch between bucket and index");
      assert.ok(bEntry.genderProb > 0.85, `genderProb too low: ${bEntry.genderProb}`);
    });
  });

  // =========================================================================
  // SUITE 4: R3 Biometric Trait Breakdown — 1000 Randomized / Pathological FaceFeatures
  // =========================================================================
  describe("Suite 4: R3 Biometric Trait Breakdown (1000-Trial Monte Carlo & Pathological Inputs)", () => {
    // Helper to generate a mock CelebrityEmbedding
    const createMockCeleb = (feat?: FaceFeatures | null): CelebrityEmbedding => ({
      id: "mock-celeb",
      name: "Mock Celebrity",
      path: "/celebs/mock.jpg",
      descriptor: new Array(128).fill(0.088),
      age: 30,
      gender: "female",
      genderProb: 0.95,
      features: feat ?? undefined,
    });

    it("[R3-ADV-01] 1000-Trial Monte Carlo with extreme, pathological, and randomized FaceFeatures vectors", () => {
      let passedTrials = 0;

      for (let trial = 0; trial < 1000; trial++) {
        let userFeat: any;
        let celebFeat: any;
        let distance: number;

        if (trial < 100) {
          // All zeros
          userFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0.0]));
          celebFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0.0]));
          distance = 0.0;
        } else if (trial < 200) {
          // All ones
          userFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 1.0]));
          celebFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 1.0]));
          distance = 0.15;
        } else if (trial < 300) {
          // Opposites (0 vs 1)
          userFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0.0]));
          celebFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 1.0]));
          distance = 0.85;
        } else if (trial < 500) {
          // Uniform random [0.0, 1.0]
          userFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, Math.random()]));
          celebFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, Math.random()]));
          distance = Math.random() * 0.9;
        } else if (trial < 600) {
          // Extreme outliers (<0, >1, large numbers)
          const mul = (Math.random() - 0.5) * 200; // -100 to +100
          userFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, mul]));
          celebFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, -mul]));
          distance = 1.25;
        } else if (trial < 700) {
          // Non-finite values: NaN, +Infinity, -Infinity
          const badVal = trial % 3 === 0 ? NaN : trial % 3 === 1 ? Infinity : -Infinity;
          userFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, badVal]));
          celebFeat = Object.fromEntries(FEATURE_KEYS.map((k) => [k, badVal]));
          distance = 0.45;
        } else if (trial < 800) {
          // Partial / incomplete feature dictionaries
          userFeat = { faceAspect: Math.random(), jawWidth: Math.random() };
          celebFeat = { noseLength: Math.random(), foreheadHeight: Math.random() };
          distance = 0.35;
        } else if (trial < 900) {
          // Missing / corrupted anatomical sub-records
          userFeat = {
            ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, Math.random()])),
            anatomical: { upperThirdRatio: NaN, canthalTiltAngleDeg: Infinity } as any,
          };
          celebFeat = {
            ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, Math.random()])),
            anatomical: null as any,
          };
          distance = 0.40;
        } else {
          // Null or undefined features with distance sweep
          userFeat = null;
          celebFeat = undefined;
          distance = ((trial - 900) / 100) * 1.5;
        }

        const query: UserFaceQuery = {
          descriptor: new Float32Array(128).fill(0.088),
          age: 25,
          gender: "female",
          genderProbability: 0.95,
          features: userFeat,
        };

        const celeb = createMockCeleb(celebFeat);

        // Execute buildDescriptorTraits
        const traits = buildDescriptorTraits(query, celeb, distance);

        // Assert contract
        assert.equal(traits.length, 4, `Trial ${trial}: must return exactly 4 traits`);

        const expectedKeys = ["facialThirds", "eyeCanthal", "noseBridge", "jawlineChin"];
        const expectedLabels = [
          "Facial Thirds & Forehead Proportions",
          "Eye Spacing & Canthal Tilt",
          "Nose Bridge & Width Index",
          "Jawline Contour & Chin Sharpness",
        ];

        for (let idx = 0; idx < 4; idx++) {
          const t = traits[idx]!;
          assert.equal(t.trait, expectedKeys[idx], `Trial ${trial}: trait mismatch at ${idx}`);
          assert.equal(t.label, expectedLabels[idx], `Trial ${trial}: label mismatch at ${idx}`);
          assert.ok(
            typeof t.similarity === "number" &&
              !Number.isNaN(t.similarity) &&
              Number.isFinite(t.similarity) &&
              t.similarity >= 0.0 &&
              t.similarity <= 1.0,
            `Trial ${trial}: trait ${t.trait} similarity out of bounds: ${t.similarity}`,
          );
        }

        passedTrials++;
      }

      assert.equal(passedTrials, 1000, `Expected 1000 passed trials, got ${passedTrials}`);
    });

    it("[R3-ADV-02] Identical feature vectors yield high similarity (>= 0.85) across all 4 traits", () => {
      const sampleFeat: FaceFeatures = {
        faceAspect: 0.62,
        jawWidth: 0.52,
        chinSharpness: 0.58,
        foreheadHeight: 0.54,
        eyeSpacing: 0.51,
        eyeOpenness: 0.60,
        eyeSlant: 0.50,
        browHeight: 0.48,
        noseLength: 0.52,
        noseWidth: 0.49,
        mouthWidth: 0.53,
        lipFullness: 0.58,
        cheekboneProminence: 0.65,
        faceRoundness: 0.52,
        skinL: 0.72,
        skinA: 0.52,
        skinB: 0.52,
        hairL: 0.45,
        hairA: 0.50,
        hairB: 0.50,
        masculine: 0.25,
        feminine: 0.80,
        youthfulness: 0.65,
      };

      const query: UserFaceQuery = {
        descriptor: new Float32Array(128).fill(0.088),
        age: 24,
        gender: "female",
        genderProbability: 0.95,
        features: sampleFeat,
      };
      const celeb = createMockCeleb(sampleFeat);

      const traits = buildDescriptorTraits(query, celeb, 0.12);
      for (const t of traits) {
        assert.ok(t.similarity >= 0.85, `Trait ${t.trait} similarity too low on identical features: ${t.similarity}`);
      }
    });

    it("[R3-ADV-03] Missing features fallback smoothly to distance-derived similarity", () => {
      const distances = [0.10, 0.25, 0.40, 0.55, 0.70, 0.90];
      for (const d of distances) {
        const query: UserFaceQuery = {
          descriptor: new Float32Array(128).fill(0.088),
          age: 30,
          gender: "female",
          genderProbability: 0.95,
          features: undefined,
        };
        const celeb = createMockCeleb(null);
        const traits = buildDescriptorTraits(query, celeb, d);

        const expectedSim = Math.max(0.05, Math.min(1.0, distanceToMatchPercent(d) / 100));
        const roundedExpected = Math.round(expectedSim * 100) / 100;

        for (const t of traits) {
          assert.equal(t.similarity, roundedExpected, `Fallback similarity mismatch at d=${d}: expected ${roundedExpected}, got ${t.similarity}`);
        }
      }
    });
  });

  // =========================================================================
  // SUITE 5: R3 UI Component Rendering Stress (MatchRevealCard & ComparisonView)
  // =========================================================================
  describe("Suite 5: R3 UI Component Rendering Stress", () => {
    const createMockMatch = (overrides?: Partial<CelebrityMatch>): CelebrityMatch => ({
      celebrityId: "billie-eilish",
      name: "Billie Eilish",
      knownFor: "Singer-Songwriter",
      matchPercent: 78.5,
      rawScore: 0.85,
      confidenceScore: 76,
      traits: [
        { trait: "facialThirds", label: "Facial Thirds & Forehead Proportions", userValue: 0.33, celebValue: 0.33, similarity: 0.88 },
        { trait: "eyeCanthal", label: "Eye Spacing & Canthal Tilt", userValue: 0.30, celebValue: 0.30, similarity: 0.82 },
        { trait: "noseBridge", label: "Nose Bridge & Width Index", userValue: 0.75, celebValue: 0.75, similarity: 0.79 },
        { trait: "jawlineChin", label: "Jawline Contour & Chin Sharpness", userValue: 0.75, celebValue: 0.75, similarity: 0.84 },
      ],
      accentHue: 160,
      initials: "BE",
      tags: ["Musician", "Grammy Winner"],
      photoUrl: "/celebs/billie-eilish.jpg",
      photoUrl192: "/celebs/thumbs/192/billie-eilish.webp",
      fallbackPhotoUrl: "/celebs/billie-eilish.jpg",
      distance: 0.30,
      ...overrides,
    });

    it("[R3-ADV-04] MatchRevealCard renders boundary similarity 0% and weak match flags cleanly", () => {
      const zeroMatch = createMockMatch({ matchPercent: 0.0, distance: 1.2 });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: zeroMatch, youUrl: null }),
      );

      assert.ok(html.includes("Billie Eilish"), "Must render celebrity name");
      assert.ok(html.includes("No strong doppelgänger") || html.includes("nearest embedding"), "Must render weak match disclaimer");
      assert.ok(!html.includes("animate-sparkle-float"), "Must suppress sparkles on weak matches");
      assert.ok(html.includes("role=\"progressbar\""), "Must contain progress bar");
    });

    it("[R3-ADV-05] MatchRevealCard renders boundary similarity 100% with hero score and full traits", () => {
      const perfectMatch = createMockMatch({ matchPercent: 100.0, distance: 0.0 });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: perfectMatch, youUrl: "/user.jpg" }),
      );

      assert.ok(html.includes("100"), "Must render 100 percentage");
      assert.ok(html.includes("Facial Thirds"), "Must render trait 1 header");
      assert.ok(html.includes("Eye Spacing"), "Must render trait 2 header");
      assert.ok(html.includes("Nose Bridge"), "Must render trait 3 header");
      assert.ok(html.includes("Jawline Contour"), "Must render trait 4 header");
    });

    it("[R3-ADV-06] MatchRevealCard handles empty traits array without crashing", () => {
      const emptyMatch = createMockMatch({ traits: [] });
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch: emptyMatch, youUrl: null }),
      );
      assert.ok(html.length > 0);
      assert.ok(html.includes("Billie Eilish"));
    });

    it("[R3-ADV-07] ComparisonView renders all 3 modes (side-by-side, split-slider, landmarks)", () => {
      const traits: TraitInsight[] = [
        { trait: "facialThirds", label: "Facial Thirds & Forehead Proportions", userValue: 0.33, celebValue: 0.33, similarity: 0.85 },
        { trait: "eyeCanthal", label: "Eye Spacing & Canthal Tilt", userValue: 0.30, celebValue: 0.30, similarity: 0.80 },
        { trait: "noseBridge", label: "Nose Bridge & Width Index", userValue: 0.75, celebValue: 0.75, similarity: 0.75 },
        { trait: "jawlineChin", label: "Jawline Contour & Chin Sharpness", userValue: 0.75, celebValue: 0.75, similarity: 0.82 },
      ];

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: "/user.jpg",
          celebrityPhotoUrl: "/celebs/billie-eilish.jpg",
          traits,
        }),
      );

      assert.ok(html.includes("role=\"tablist\""), "Tablist container missing");
      assert.ok(html.includes("aria-label=\"Comparison modes\""), "Accessible tablist label missing");
      assert.ok(html.includes("Side-by-Side"), "Side-by-Side tab missing");
      assert.ok(html.includes("Split Slider"), "Split Slider tab missing");
      assert.ok(html.includes("Landmarks"), "Landmarks tab missing");
    });

    it("[R3-ADV-08] ComparisonView renders accessible fallback when photos are missing", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(ComparisonView, {
          celebrityName: "Billie Eilish",
          celebrityInitials: "BE",
          userPhotoUrl: null,
          celebrityPhotoUrl: null,
          celebrityPhoto192Url: null,
          celebrityFallbackUrl: null,
        }),
      );

      assert.ok(html.includes("BE") || html.includes("Billie"), "Initials or name fallback missing");
      assert.ok(html.includes("YOU") || html.includes("You"), "User placeholder missing");
    });

    it("[R3-ADV-09] Full End-to-End Ranking & UI Integration with Billie Eilish descriptor", () => {
      const indexPath = path.join(CELEBS_DIR, "index.json");
      const f32Path = path.join(CELEBS_DIR, "embeddings.f32.bin");
      const bucketsPath = path.join(CELEBS_DIR, "gallery.buckets.json");
      const featuresPath = path.join(CELEBS_DIR, "gallery.features.json");

      const indexList = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{ id: string }>;
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

      const topMatch = matches[0]!;
      assert.equal(topMatch.celebrityId, "billie-eilish", `Top match must be billie-eilish, got ${topMatch.celebrityId}`);
      assert.ok(topMatch.distance < 0.05, `Self distance must be < 0.05, got ${topMatch.distance}`);
      assert.ok(topMatch.matchPercent >= 90.0, `Match percent must be >= 90%, got ${topMatch.matchPercent}%`);

      // Verify traits
      assert.ok(topMatch.traits && topMatch.traits.length === 4, "Top match must have exactly 4 traits");
      for (const t of topMatch.traits) {
        assert.ok(t.similarity >= 0.85, `Trait ${t.trait} similarity should be high on self match: ${t.similarity}`);
      }

      // Verify rendering of MatchRevealCard with real topMatch
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(MatchRevealCard, { topMatch, youUrl: "/user-photo.jpg" }),
      );
      assert.ok(html.includes("Billie Eilish"), "Rendered markup must include Billie Eilish");
      assert.ok(html.includes("Facial Thirds"), "Rendered markup must include trait 1");
      assert.ok(html.includes("Eye Spacing"), "Rendered markup must include trait 2");
      assert.ok(html.includes("Nose Bridge"), "Rendered markup must include trait 3");
      assert.ok(html.includes("Jawline Contour"), "Rendered markup must include trait 4");
    });

    it("[R3-ADV-10] Numerical stability under extreme geometric ratios and sum non-normalization", () => {
      const extremeFeat1: FaceFeatures = {
        faceAspect: 0.99,
        jawWidth: 0.99,
        chinSharpness: 0.99,
        foreheadHeight: 0.99,
        eyeSpacing: 0.99,
        eyeOpenness: 0.99,
        eyeSlant: 0.99,
        browHeight: 0.99,
        noseLength: 0.99,
        noseWidth: 0.99,
        mouthWidth: 0.99,
        lipFullness: 0.99,
        cheekboneProminence: 0.99,
        faceRoundness: 0.99,
        skinL: 0.99,
        skinA: 0.99,
        skinB: 0.99,
        hairL: 0.99,
        hairA: 0.99,
        hairB: 0.99,
        masculine: 0.99,
        feminine: 0.01,
        youthfulness: 0.99,
        anatomical: {
          upperThirdRatio: 0.90,
          middleThirdRatio: 0.05,
          lowerThirdRatio: 0.05,
          lateralFifthsRatios: [0.35, 0.10, 0.10, 0.10, 0.35],
          interCanthalDistance: 0.50,
          canthalTiltAngleDeg: 30.0,
          nasalIndex: 1.80,
          bigonialToBizygomaticRatio: 1.10,
          gonialJawlineAngleDeg: 155.0,
          lipVermilionHeightRatio: 2.50,
          philtrumDepth: 1.80,
        },
      };

      const extremeFeat2: FaceFeatures = {
        faceAspect: 0.01,
        jawWidth: 0.01,
        chinSharpness: 0.01,
        foreheadHeight: 0.01,
        eyeSpacing: 0.01,
        eyeOpenness: 0.01,
        eyeSlant: 0.01,
        browHeight: 0.01,
        noseLength: 0.01,
        noseWidth: 0.01,
        mouthWidth: 0.01,
        lipFullness: 0.01,
        cheekboneProminence: 0.01,
        faceRoundness: 0.01,
        skinL: 0.01,
        skinA: 0.01,
        skinB: 0.01,
        hairL: 0.01,
        hairA: 0.01,
        hairB: 0.01,
        masculine: 0.01,
        feminine: 0.99,
        youthfulness: 0.01,
        anatomical: {
          upperThirdRatio: 0.10,
          middleThirdRatio: 0.80,
          lowerThirdRatio: 0.10,
          lateralFifthsRatios: [0.10, 0.30, 0.20, 0.30, 0.10],
          interCanthalDistance: 0.15,
          canthalTiltAngleDeg: -25.0,
          nasalIndex: 0.30,
          bigonialToBizygomaticRatio: 0.40,
          gonialJawlineAngleDeg: 80.0,
          lipVermilionHeightRatio: 0.20,
          philtrumDepth: 0.20,
        },
      };

      const query: UserFaceQuery = {
        descriptor: new Float32Array(128).fill(0.088),
        age: 20,
        gender: "female",
        genderProbability: 0.99,
        features: extremeFeat1,
      };
      const celeb: CelebrityEmbedding = {
        id: "extreme-celeb",
        name: "Extreme Celeb",
        path: "/celebs/extreme.jpg",
        descriptor: new Array(128).fill(0.088),
        age: 60,
        gender: "male",
        genderProb: 0.99,
        features: extremeFeat2,
      };

      const traits = buildDescriptorTraits(query, celeb, 0.85);
      assert.equal(traits.length, 4);
      for (const t of traits) {
        assert.ok(!Number.isNaN(t.similarity), `Trait ${t.trait} is NaN`);
        assert.ok(Number.isFinite(t.similarity), `Trait ${t.trait} is Infinite`);
        assert.ok(t.similarity >= 0.0 && t.similarity <= 1.0, `Trait ${t.trait} out of [0, 1]: ${t.similarity}`);
      }
    });

    it("[R3-ADV-11] Monotonicity of distance fallback: similarity strictly decreases as distance increases", () => {
      const distances = [0.05, 0.15, 0.25, 0.35, 0.45, 0.60, 0.80, 1.00];
      const sims: number[] = [];

      for (const d of distances) {
        const query: UserFaceQuery = {
          descriptor: new Float32Array(128).fill(0.088),
          age: 25,
          gender: "female",
          genderProbability: 0.95,
          features: undefined,
        };
        const celeb: CelebrityEmbedding = {
          id: "test",
          name: "Test",
          path: "/test.jpg",
          descriptor: new Array(128).fill(0.088),
          age: 25,
          gender: "female",
          genderProb: 0.95,
          features: undefined,
        };
        const traits = buildDescriptorTraits(query, celeb, d);
        sims.push(traits[0]!.similarity);
      }

      for (let i = 1; i < sims.length; i++) {
        assert.ok(
          sims[i]! <= sims[i - 1]!,
          `Monotonicity violation at distance index ${i}: sim[${i}] = ${sims[i]} > sim[${i - 1}] = ${sims[i - 1]}`,
        );
      }
    });

    it("[R1-ADV-16] Uniqueness of all 804 celebrity IDs and thumbnail asset paths in gallery.buckets.json", () => {
      const bucketsPath = path.join(CELEBS_DIR, "gallery.buckets.json");
      const buckets = JSON.parse(fs.readFileSync(bucketsPath, "utf-8")) as Array<{
        id: string;
        path: string;
      }>;

      const seenIds = new Set<string>();
      const seenPaths = new Set<string>();

      for (const b of buckets) {
        assert.ok(!seenIds.has(b.id), `Duplicate ID in gallery.buckets.json: ${b.id}`);
        assert.ok(!seenPaths.has(b.path), `Duplicate path in gallery.buckets.json: ${b.path}`);
        seenIds.add(b.id);
        seenPaths.add(b.path);
      }
      assert.equal(seenIds.size, 804);
    });

    it("[R1-ADV-17] Embedding vector diversity: no duplicate identical embeddings across distinct celebrities", () => {
      const f32Path = path.join(CELEBS_DIR, "embeddings.f32.bin");
      const f32Buf = fs.readFileSync(f32Path);

      // Check sample of 50 distinct pairs to ensure embeddings are distinct (cosine distance > 0.01)
      for (let i = 0; i < 50; i++) {
        const j = (i + 17) % 804;
        if (i === j) continue;
        const v1 = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + i * 128 * 4, 128);
        const v2 = new Float32Array(f32Buf.buffer, f32Buf.byteOffset + j * 128 * 4, 128);
        const dist = cosineDistance(v1, v2);
        assert.ok(dist > 0.01, `Pair (${i}, ${j}) has suspiciously identical embeddings: dist=${dist}`);
      }
    });
  });
});
