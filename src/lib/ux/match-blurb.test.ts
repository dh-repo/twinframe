import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyFeatures } from "../face/math.ts";
import type { FaceFeatures, TraitInsight } from "../face/types.ts";
import { verdictSubtitle } from "../face/verdict.ts";
import {
  composeBreakdownRows,
  composeMatchBlurb,
  pickAgreeingTraits,
  pickDistinctiveTraits,
  pronounFromGender,
} from "./match-blurb.ts";

/** Sparse vectors — only the keys we set are comparable. */
function feat(partial: Partial<FaceFeatures>): Partial<FaceFeatures> {
  return partial;
}

const zendaya = feat({
  eyeSpacing: 0.72,
  cheekboneProminence: 0.78,
  jawWidth: 0.48,
  faceRoundness: 0.42,
  lipFullness: 0.62,
  noseWidth: 0.5,
});

describe("pronounFromGender", () => {
  it("maps male / female / unknown exhaustively", () => {
    assert.equal(pronounFromGender("female"), "her");
    assert.equal(pronounFromGender("male"), "his");
    assert.equal(pronounFromGender("unknown"), "their");
    assert.equal(pronounFromGender(undefined), "their");
    assert.equal(pronounFromGender("other"), "their");
  });
});

describe("pickAgreeingTraits", () => {
  it("returns the closest 1–2 structural traits", () => {
    const user = feat({
      eyeSpacing: 0.71,
      cheekboneProminence: 0.8,
      jawWidth: 0.2,
      lipFullness: 0.2,
    });
    const picked = pickAgreeingTraits(user, zendaya);
    assert.ok(picked.length >= 1 && picked.length <= 2);
    assert.deepEqual(
      picked.map((t) => t.key).sort(),
      ["cheekboneProminence", "eyeSpacing"].sort(),
    );
    assert.ok(picked.every((t) => t.similarity >= 0.7));
    assert.ok(picked.some((t) => t.phrase === "eye spacing"));
    assert.ok(picked.some((t) => t.phrase === "cheekbone structure"));
  });

  it("ignores Lab / hair / gender channels even when they match perfectly", () => {
    const user = feat({
      skinL: 0.9,
      skinA: 0.9,
      hairL: 0.1,
      masculine: 0.95,
      eyeSpacing: 0.4,
      cheekboneProminence: 0.41,
    });
    const celeb = feat({
      skinL: 0.9,
      skinA: 0.9,
      hairL: 0.1,
      masculine: 0.95,
      eyeSpacing: 0.4,
      cheekboneProminence: 0.41,
    });
    const keys = pickAgreeingTraits(user, celeb).map((t) => t.key);
    assert.ok(!keys.includes("skinL"));
    assert.ok(!keys.includes("hairL"));
    assert.ok(!keys.includes("masculine"));
  });

  it("returns empty when nothing is close enough", () => {
    const user = feat({
      eyeSpacing: 0.1,
      cheekboneProminence: 0.1,
      jawWidth: 0.95,
      faceRoundness: 0.95,
    });
    assert.equal(pickAgreeingTraits(user, zendaya).length, 0);
  });
});

describe("pickDistinctiveTraits", () => {
  it("names the two most extreme structural features", () => {
    const picked = pickDistinctiveTraits(
      feat({
        cheekboneProminence: 0.88,
        eyeSpacing: 0.84,
        jawWidth: 0.51,
        noseWidth: 0.5,
      }),
    );
    assert.equal(picked.length, 2);
    const phrases = picked.map((t) => t.phrase);
    assert.ok(phrases.includes("high cheekbones"));
    assert.ok(phrases.includes("wide-set eyes"));
  });

  it("uses low-end names when the celeb sits below the midpoint", () => {
    const phrases = pickDistinctiveTraits(
      feat({ jawWidth: 0.18, eyeSpacing: 0.2, cheekboneProminence: 0.5 }),
    ).map((t) => t.phrase);
    assert.ok(phrases.includes("narrow jaw"));
    assert.ok(phrases.includes("close-set eyes"));
  });
});

describe("composeMatchBlurb", () => {
  it("says a shared-trait sentence from agreeing user + celeb features", () => {
    const blurb = composeMatchBlurb({
      name: "Zendaya",
      gender: "female",
      tags: ["angular", "actress"],
      celebFeatures: zendaya,
      userFeatures: feat({
        eyeSpacing: 0.7,
        cheekboneProminence: 0.76,
        jawWidth: 0.22,
      }),
    });
    assert.equal(
      blurb,
      "You share her eye spacing and cheekbone structure.",
    );
  });

  it("uses his / their from gender", () => {
    const input = {
      name: "Idris Elba",
      tags: ["broad jaw"],
      celebFeatures: feat({ jawWidth: 0.86, cheekboneProminence: 0.8 }),
      userFeatures: feat({ jawWidth: 0.84, cheekboneProminence: 0.79 }),
    };
    assert.match(
      composeMatchBlurb({ ...input, gender: "male" }),
      /^You share his /,
    );
    assert.match(
      composeMatchBlurb({ ...input, gender: "unknown" }),
      /^You share their /,
    );
  });

  it("falls back to tags + distinctive celeb names when the user vector is missing", () => {
    const blurb = composeMatchBlurb({
      name: "Zendaya",
      gender: "female",
      tags: ["angular"],
      celebFeatures: zendaya,
    });
    assert.match(blurb, /^You share her /);
    assert.match(blurb, /high cheekbones/);
    assert.match(blurb, /wide-set eyes/);
    assert.ok(!blurb.includes("angular") || blurb.includes("high cheekbones"));
  });

  it("uses appearance tags when features are mid-range or missing", () => {
    const fromTags = composeMatchBlurb({
      name: "Pedro Pascal",
      gender: "male",
      tags: ["warm eyes", "classic", "actor"],
    });
    assert.equal(fromTags, "You share his warm eyes.");

    const midFeatures = composeMatchBlurb({
      name: "Someone",
      gender: "female",
      tags: ["strong jaw"],
      celebFeatures: emptyFeatures(),
    });
    assert.equal(midFeatures, "You share her strong jaw.");
  });

  it("skips career tags and names the person when nothing facial is available", () => {
    assert.equal(
      composeMatchBlurb({
        name: "Zendaya",
        gender: "female",
        tags: ["actress", "classic", "Oscar Winner"],
      }),
      "You share a look with Zendaya.",
    );
    assert.equal(
      composeMatchBlurb({ name: "", tags: [] }),
      "You share a look with this face.",
    );
  });

  it("never invents a biometric percent or reads accentHue", () => {
    const a = composeMatchBlurb({
      name: "Zendaya",
      gender: "female",
      tags: ["angular"],
      celebFeatures: zendaya,
    });
    const b = composeMatchBlurb({
      name: "Zendaya",
      gender: "female",
      tags: ["angular"],
      celebFeatures: zendaya,
    });
    assert.equal(a, b);
    assert.ok(!/%/.test(a));
    assert.ok(!/accent/i.test(a));
    assert.ok(!/\d{2}/.test(a));
  });

  it("does not sell celebrity traits on a distant twin", () => {
    const blurb = composeMatchBlurb({
      name: "Moira Kirland",
      gender: "female",
      tags: ["high cheekbones", "long face"],
      celebFeatures: zendaya,
      userFeatures: feat({
        eyeSpacing: 0.71,
        cheekboneProminence: 0.8,
      }),
      verdict: "distant-twin",
    });
    assert.equal(blurb, verdictSubtitle("distant-twin"));
    assert.ok(!/You share/i.test(blurb));
    assert.ok(!/cheekbone/i.test(blurb));
  });

  it("caps the sentence at two traits", () => {
    const blurb = composeMatchBlurb({
      name: "Chris Hemsworth",
      gender: "male",
      celebFeatures: feat({
        jawWidth: 0.9,
        cheekboneProminence: 0.88,
        faceAspect: 0.86,
        chinSharpness: 0.84,
      }),
      userFeatures: feat({
        jawWidth: 0.89,
        cheekboneProminence: 0.87,
        faceAspect: 0.85,
        chinSharpness: 0.83,
      }),
    });
    const ands = blurb.match(/ and /g) ?? [];
    assert.equal(ands.length, 1);
  });
});

describe("composeBreakdownRows", () => {
  const traits: TraitInsight[] = [
    {
      trait: "facialStructure",
      userValue: 0.72,
      celebValue: 1,
      similarity: 0.72,
      label: "Facial Structure",
    },
    {
      trait: "ageAffinity",
      userValue: 0.3,
      celebValue: 0.32,
      similarity: 0.91,
      label: "Age Affinity",
    },
    {
      trait: "genderPresentation",
      userValue: 0.9,
      celebValue: 0.92,
      similarity: 0.88,
      label: "Gender Presentation",
    },
    {
      trait: "lightingQuality",
      userValue: 0.8,
      celebValue: 0.92,
      similarity: 0.64,
      label: "Lighting & Quality",
    },
  ];

  it("uses real trait similarities, not accentHue", () => {
    const rows = composeBreakdownRows(traits, { accentHue: 347 });
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((r) => r.id),
      [
        "facialStructure",
        "ageAffinity",
        "genderPresentation",
        "lightingQuality",
      ],
    );
    assert.equal(rows.find((r) => r.id === "facialStructure")?.score, 72);
    assert.equal(rows.find((r) => r.id === "ageAffinity")?.score, 91);
    const hueShifted = composeBreakdownRows(traits, { accentHue: 12 });
    assert.deepEqual(
      rows.map((r) => r.score),
      hueShifted.map((r) => r.score),
    );
  });

  it("appends agreeing feature rows when both faces are present", () => {
    const rows = composeBreakdownRows(traits, {
      userFeatures: feat({ eyeSpacing: 0.7, cheekboneProminence: 0.76 }),
      celebFeatures: zendaya,
    });
    const extra = rows.filter(
      (r) =>
        r.id === "eyeSpacing" || r.id === "cheekboneProminence",
    );
    assert.equal(extra.length, 2);
    assert.ok(extra.every((r) => r.score >= 70 && r.score <= 100));
    assert.ok(!rows.some((r) => r.id === "eye-contour"));
  });

  it("skips agreeing extras on a distant twin", () => {
    const rows = composeBreakdownRows(traits, {
      userFeatures: feat({ eyeSpacing: 0.7, cheekboneProminence: 0.76 }),
      celebFeatures: zendaya,
      verdict: "distant-twin",
    });
    assert.equal(
      rows.some((r) => r.id === "eyeSpacing" || r.id === "cheekboneProminence"),
      false,
    );
    assert.equal(rows.length, 4);
  });

  it("survives empty traits without inventing scores", () => {
    assert.deepEqual(composeBreakdownRows([]), []);
    const onlyAgree = composeBreakdownRows([], {
      userFeatures: feat({ eyeSpacing: 0.72 }),
      celebFeatures: zendaya,
    });
    assert.ok(onlyAgree.length >= 1);
    assert.equal(onlyAgree[0]?.id, "eyeSpacing");
  });
});
