import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_EXTRA_PHOTOS,
  baseKey,
  eraKey,
  isLikelyPortraitFileName,
  matchesSubject,
  nextPhotoIndex,
  normalizeTitleWords,
  rankSubcategories,
  selectDiverseCandidates,
} from "./fetch-commons-extras.ts";

describe("commons filename filtering", () => {
  it("keeps solo portraits and drops non-face media", () => {
    assert.ok(isLikelyPortraitFileName("File:Tom Hanks 2014.jpg"));
    assert.ok(isLikelyPortraitFileName("File:Emma_Stone_2018_(cropped).png"));
    for (const bad of [
      "File:Tom Hanks signature.svg",
      "File:Forrest Gump poster.jpg",
      "File:Tom Hanks and Rita Wilson 2012.jpg",
      "File:Tom Hanks with fans.jpg",
      "File:Cast of Toy Story 2019.jpg",
      "File:Tom Hanks star on Walk of Fame.jpg",
      "File:Tom Hanks waxwork.jpg",
      "File:Tom Hanks handprint.jpg",
      "File:Adele album cover.jpg",
      "File:Adele logo.png",
      "File:Adele painting.jpg",
      "File:Adele 2016.webm",
    ]) {
      assert.ok(!isLikelyPortraitFileName(bad), bad);
    }
  });
});

describe("subject matching", () => {
  it("requires the subject's surname so unrelated category files drop out", () => {
    assert.ok(matchesSubject("File:Brad Pitt 2009 Academy Awards.jpg", "Brad Pitt"));
    assert.ok(matchesSubject("File:Brad_Pitt_Fury_2014.jpg", "Brad Pitt"));
    assert.ok(!matchesSubject("File:Bus 13A 12u07.JPG", "Brad Pitt"));
    assert.ok(!matchesSubject("File:Angelina Jolie at Davos2.jpg", "Brad Pitt"));
  });

  it("also requires the given name for short surnames", () => {
    assert.ok(matchesSubject("File:Lee Min-ho 2016.jpg", "Lee Min-ho"));
    assert.ok(!matchesSubject("File:Bruce Ho 2016.jpg", "Lee Min-ho"));
    assert.ok(matchesSubject("File:Penelope Cruz Cannes 2018.jpg", "Penelope Cruz"));
    assert.ok(!matchesSubject("File:Santa Cruz beach.jpg", "Penelope Cruz"));
  });

  it("folds accents when comparing", () => {
    assert.equal(normalizeTitleWords("Penélope_Cruz_(2018)"), "penelope cruz 2018");
    assert.ok(matchesSubject("File:Penélope Cruz 2018.jpg", "Penelope Cruz"));
  });
});

describe("diversity selection", () => {
  it("reads era and base keys off Commons filenames", () => {
    assert.equal(eraKey("File:Tom Hanks 2011 Shankbone.jpg"), "2011");
    assert.equal(eraKey("File:Tom Hanks portrait.jpg"), "unknown");
    assert.equal(baseKey("File:Tom Hanks 2014 (cropped).jpg"), "tom hanks 2014");
    assert.equal(baseKey("File:Tom_Hanks_2014.jpg"), "tom hanks 2014");
  });

  it("spreads picks across eras and collapses crops of the same file", () => {
    const candidates = [
      { title: "File:X 2011.jpg" },
      { title: "File:X 2011 (cropped).jpg" },
      { title: "File:X 2011b.jpg" },
      { title: "File:X 2018.jpg" },
      { title: "File:X 2018 (retouched).jpg" },
      { title: "File:X 2023.jpg" },
    ];
    const picked = selectDiverseCandidates(candidates, 3).map((c) => c.title);
    assert.deepEqual(picked, ["File:X 2011.jpg", "File:X 2018.jpg", "File:X 2023.jpg"]);

    const all = selectDiverseCandidates(candidates, 10).map((c) => c.title);
    assert.equal(all.length, 4);
    assert.ok(!all.includes("File:X 2011 (cropped).jpg"));
  });

  it("prefers dated files over an undated grab-bag", () => {
    const picked = selectDiverseCandidates(
      [{ title: "File:X portrait.jpg" }, { title: "File:X 2019.jpg" }],
      1,
    );
    assert.deepEqual(picked.map((c) => c.title), ["File:X 2019.jpg"]);
  });
});

describe("subcategory ranking", () => {
  it("descends into dated containers before generic subcategories", () => {
    assert.deepEqual(
      rankSubcategories([
        "Category:Ryan Reynolds at Comic-Con International",
        "Category:Ryan Reynolds by year",
        "Category:Ryan Reynolds by decade",
      ]),
      [
        "Category:Ryan Reynolds by decade",
        "Category:Ryan Reynolds by year",
        "Category:Ryan Reynolds at Comic-Con International",
      ],
    );
  });
});

describe("photo numbering", () => {
  it("never reuses 001 or an existing index", () => {
    assert.equal(nextPhotoIndex([]), 2);
    assert.equal(nextPhotoIndex(["002.jpg", "003.jpg"]), 4);
    assert.equal(nextPhotoIndex(["side.png"]), 2);
    assert.equal(MAX_EXTRA_PHOTOS, 8);
  });
});
