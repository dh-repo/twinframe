import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  morphologicalDistance,
  crossDemographicMismatchPenalty,
  morphologicalAffinity,
  geomAffinity,
  MORPH_FEATURE_WEIGHTS,
} from "../src/lib/face/geometry.ts";
import { emptyFeatures, mergeFeatures } from "../src/lib/face/math.ts";
import type { FaceFeatures } from "../src/lib/face/types.ts";

describe("Milestone 2 Recalibrated Challenger Stress Harness (teamwork_preview_challenger_m2_4)", () => {
  // Load gallery features from public/celebs/gallery.features.json
  const galleryPath = path.join(process.cwd(), "public/celebs/gallery.features.json");
  let galleryData: Record<string, FaceFeatures> = {};
  if (fs.existsSync(galleryPath)) {
    galleryData = JSON.parse(fs.readFileSync(galleryPath, "utf8"));
  }

  describe("1. Identity Property D(A, A) === 0.0", () => {
    test("Identity holds for emptyFeatures default vector", () => {
      const f = emptyFeatures();
      const d = morphologicalDistance(f, f);
      assert.equal(d, 0.0, `Identity failed for emptyFeatures: expected 0.0, got ${d}`);
    });

    test("Identity holds for extreme zero vector", () => {
      const zeros = mergeFeatures({
        faceAspect: 0, jawWidth: 0, chinSharpness: 0, foreheadHeight: 0,
        eyeSpacing: 0, eyeOpenness: 0, eyeSlant: 0, browHeight: 0,
        noseLength: 0, noseWidth: 0, mouthWidth: 0, lipFullness: 0,
        cheekboneProminence: 0, faceRoundness: 0, skinL: 0, skinA: 0, skinB: 0,
        hairL: 0, hairA: 0, hairB: 0, masculine: 0, feminine: 0, youthfulness: 0,
      });
      const d = morphologicalDistance(zeros, zeros);
      assert.equal(d, 0.0, `Identity failed for zero vector: expected 0.0, got ${d}`);
    });

    test("Identity holds for extreme ones vector", () => {
      const ones = mergeFeatures({
        faceAspect: 1, jawWidth: 1, chinSharpness: 1, foreheadHeight: 1,
        eyeSpacing: 1, eyeOpenness: 1, eyeSlant: 1, browHeight: 1,
        noseLength: 1, noseWidth: 1, mouthWidth: 1, lipFullness: 1,
        cheekboneProminence: 1, faceRoundness: 1, skinL: 1, skinA: 1, skinB: 1,
        hairL: 1, hairA: 1, hairB: 1, masculine: 1, feminine: 1, youthfulness: 1,
      });
      const d = morphologicalDistance(ones, ones);
      assert.equal(d, 0.0, `Identity failed for ones vector: expected 0.0, got ${d}`);
    });

    test("Identity holds for all entries in real celebrity gallery", () => {
      const keys = Object.keys(galleryData);
      assert.ok(keys.length > 0, "Gallery features dataset must non-empty");
      for (const key of keys) {
        const feat = galleryData[key];
        const d = morphologicalDistance(feat, feat);
        assert.equal(d, 0.0, `Identity failed for gallery celeb [${key}]: expected 0.0, got ${d}`);
      }
    });
  });

  describe("2. Symmetry Property D(A, B) === D(B, A)", () => {
    test("Symmetry holds across synthetic feature vectors", () => {
      const f1 = emptyFeatures();
      const f2 = mergeFeatures({ skinL: 0.8, eyeSlant: 0.7, jawWidth: 0.3 });
      const f3 = mergeFeatures({ masculine: 0.9, feminine: 0.1, noseWidth: 0.8 });

      assert.equal(morphologicalDistance(f1, f2), morphologicalDistance(f2, f1));
      assert.equal(morphologicalDistance(f1, f3), morphologicalDistance(f3, f1));
      assert.equal(morphologicalDistance(f2, f3), morphologicalDistance(f3, f2));
    });

    test("Symmetry holds across real celebrity gallery pairs", () => {
      const celebs = ["brad-pitt", "simu-liu", "idris-elba", "pedro-pascal", "zendaya", "taylor-swift"];
      for (let i = 0; i < celebs.length; i++) {
        for (let j = i + 1; j < celebs.length; j++) {
          const c1 = galleryData[celebs[i]];
          const c2 = galleryData[celebs[j]];
          if (c1 && c2) {
            const d12 = morphologicalDistance(c1, c2);
            const d21 = morphologicalDistance(c2, c1);
            assert.equal(d12, d21, `Symmetry failed between ${celebs[i]} and ${celebs[j]}: ${d12} !== ${d21}`);
          }
        }
      }
    });
  });

  describe("3. Missing / Null / Partial Inputs Handling", () => {
    test("Returns 0.50 when uFeat or cFeat is null or undefined", () => {
      const f = emptyFeatures();
      assert.equal(morphologicalDistance(null, f), 0.50);
      assert.equal(morphologicalDistance(f, null), 0.50);
      assert.equal(morphologicalDistance(undefined, f), 0.50);
      assert.equal(morphologicalDistance(f, undefined), 0.50);
      assert.equal(morphologicalDistance(null, null), 0.50);
      assert.equal(morphologicalDistance(undefined, undefined), 0.50);
    });

    test("crossDemographicMismatchPenalty handles null/undefined uFeat or cFeat", () => {
      const f = emptyFeatures();
      assert.equal(crossDemographicMismatchPenalty(null, f), 0.0);
      assert.equal(crossDemographicMismatchPenalty(f, null), 0.0);
      assert.equal(crossDemographicMismatchPenalty(null, null), 0.0);
      assert.equal(crossDemographicMismatchPenalty(undefined), 0.0);
    });

    test("morphologicalAffinity and geomAffinity return 0.5 when uFeat or cFeat is missing", () => {
      const f = emptyFeatures();
      assert.equal(morphologicalAffinity(null, f), 0.5);
      assert.equal(geomAffinity(f, undefined), 0.5);
    });
  });

  describe("4. Extreme & Out-of-Bounds Values & NaN Stress", () => {
    test("Out-of-bounds negative and positive values are bounded in [0, 1]", () => {
      const outOfBounds1 = mergeFeatures({
        faceAspect: -5.0,
        jawWidth: 10.0,
        skinL: -2.0,
        masculine: 3.5,
      });
      const outOfBounds2 = mergeFeatures({
        faceAspect: 5.0,
        jawWidth: -10.0,
        skinL: 3.0,
        masculine: -2.0,
      });

      const d = morphologicalDistance(outOfBounds1, outOfBounds2);
      assert.ok(Number.isFinite(d), `Distance must be finite: ${d}`);
      assert.ok(d >= 0.0 && d <= 1.0, `Distance must be in [0, 1], got ${d}`);

      const penalty = crossDemographicMismatchPenalty(outOfBounds1, outOfBounds2);
      assert.ok(penalty >= 0.0 && penalty <= 0.25, `Penalty must be in [0, 0.25], got ${penalty}`);
    });

    test("Scalar crossDemographicMismatchPenalty bounds check", () => {
      assert.equal(crossDemographicMismatchPenalty(0.0), 0.0);
      assert.equal(crossDemographicMismatchPenalty(0.35), 0.0);
      assert.equal(crossDemographicMismatchPenalty(0.36), 0.50 * 0.01);
      assert.equal(crossDemographicMismatchPenalty(0.85), 0.25); // cap at 0.25
      assert.equal(crossDemographicMismatchPenalty(1.0), 0.25);  // cap at 0.25
      assert.equal(crossDemographicMismatchPenalty(5.0), 0.25);  // cap at 0.25
      assert.equal(crossDemographicMismatchPenalty(-1.0), 0.0);  // negative distance gives 0
    });
  });

  describe("5. Demographic Boundary Separation on Real Celebrity Gallery Data", () => {
    test("Real Cross-Demographic Celebrity Pairs yield D_morph > 0.35 and non-zero Penalty", () => {
      const brad = galleryData["brad-pitt"];        // Caucasian male
      const simu = galleryData["simu-liu"];          // East Asian male
      const idris = galleryData["idris-elba"];        // African male
      const pedro = galleryData["pedro-pascal"];      // Hispanic male
      const zendaya = galleryData["zendaya"];        // Mixed/African female
      const jisoo = galleryData["jisoo"];            // East Asian female

      assert.ok(brad && simu && idris && pedro, "Gallery must contain benchmark celebrities");

      const pairs = [
        { name: "Brad Pitt (Caucasian) vs Simu Liu (East Asian)", a: brad, b: simu },
        { name: "Brad Pitt (Caucasian) vs Idris Elba (African)", a: brad, b: idris },
        { name: "Brad Pitt (Caucasian) vs Pedro Pascal (Hispanic)", a: brad, b: pedro },
        { name: "Simu Liu (East Asian) vs Idris Elba (African)", a: simu, b: idris },
        { name: "Simu Liu (East Asian) vs Pedro Pascal (Hispanic)", a: simu, b: pedro },
        { name: "Idris Elba (African) vs Pedro Pascal (Hispanic)", a: idris, b: pedro },
      ];

      if (jisoo) {
        pairs.push({ name: "Brad Pitt (Caucasian) vs Jisoo (East Asian)", a: brad, b: jisoo });
      }

      for (const { name, a, b } of pairs) {
        const d = morphologicalDistance(a, b);
        const penalty = crossDemographicMismatchPenalty(a, b);
        assert.ok(d > 0.35, `Expected ${name} D_morph > 0.35, got ${d.toFixed(4)}`);
        assert.ok(penalty > 0.0, `Expected ${name} penalty > 0.0, got ${penalty.toFixed(4)}`);
      }
    });

    test("Real Intra-Demographic / Self Celebrity Pairs yield D_morph <= 0.35 and Penalty === 0.0", () => {
      const brad = galleryData["brad-pitt"];
      const leonardo = galleryData["leonardo-dicaprio"];
      const simu = galleryData["simu-liu"];
      const jackie = galleryData["jackie-chan"];

      if (brad && leonardo) {
        const d = morphologicalDistance(brad, leonardo);
        const p = crossDemographicMismatchPenalty(brad, leonardo);
        assert.ok(d <= 0.35, `Expected Brad Pitt vs Leonardo DiCaprio D_morph <= 0.35, got ${d.toFixed(4)}`);
        assert.equal(p, 0.0, `Expected Brad Pitt vs Leonardo DiCaprio penalty === 0.0, got ${p}`);
      }

      if (simu && jackie) {
        const d = morphologicalDistance(simu, jackie);
        const p = crossDemographicMismatchPenalty(simu, jackie);
        assert.ok(d <= 0.35, `Expected Simu Liu vs Jackie Chan D_morph <= 0.35, got ${d.toFixed(4)}`);
        assert.equal(p, 0.0, `Expected Simu Liu vs Jackie Chan penalty === 0.0, got ${p}`);
      }
    });
  });

  describe("6. Overload Consistency & Scalar Parity", () => {
    test("crossDemographicMismatchPenalty(uFeat, cFeat) equals crossDemographicMismatchPenalty(dMorph)", () => {
      const brad = galleryData["brad-pitt"];
      const simu = galleryData["simu-liu"];
      if (brad && simu) {
        const d = morphologicalDistance(brad, simu);
        const pObj = crossDemographicMismatchPenalty(brad, simu);
        const pScal = crossDemographicMismatchPenalty(d);
        assert.equal(pObj, pScal, `Mismatch between object overload (${pObj}) and scalar overload (${pScal})`);
      }
    });
  });
});
