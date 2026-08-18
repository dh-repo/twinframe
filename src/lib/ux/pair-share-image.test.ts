import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PAIR_SHARE_HEIGHT,
  PAIR_SHARE_WIDTH,
  pairShareFilename,
  pairShareText,
  pairShareWinner,
} from "./pair-share-image.ts";

describe("pair share card", () => {
  it("stays a 1080×1080 meme square", () => {
    assert.equal(PAIR_SHARE_WIDTH, 1080);
    assert.equal(PAIR_SHARE_HEIGHT, 1080);
  });

  it("uses a stable pair filename", () => {
    assert.equal(pairShareFilename(), "twinframe-closer-twin.png");
  });
});

describe("pairShareText", () => {
  it("names the winner and both percents", () => {
    assert.match(
      pairShareText({
        winner: "a",
        aName: "Zendaya",
        bName: "Timothée Chalamet",
        aPercent: 87.2,
        bPercent: 71.6,
      }),
      /Closer twin: I beat my friend[\s\S]*Zendaya 87%[\s\S]*Timothée Chalamet 72%/,
    );
    assert.match(
      pairShareText({
        winner: "b",
        aName: "Zendaya",
        bName: "Florence Pugh",
        aPercent: 60,
        bPercent: 81,
      }),
      /my friend won[\s\S]*Florence Pugh 81%/,
    );
    assert.match(
      pairShareText({
        winner: "tie",
        aName: "Keanu Reeves",
        bName: "Dev Patel",
        aPercent: 54,
        bPercent: 54,
      }),
      /Tied twins[\s\S]*Keanu Reeves 54%[\s\S]*Dev Patel 54%/,
    );
  });
});

describe("pairShareWinner", () => {
  it("delegates to closerTwin (distance first)", () => {
    assert.equal(
      pairShareWinner({
        you: {
          label: "You",
          youUrl: null,
          celebrityName: "A",
          matchPercent: 60,
          adjustedDistance: 0.21,
        },
        friend: {
          label: "Friend",
          youUrl: null,
          celebrityName: "B",
          matchPercent: 90,
          adjustedDistance: 0.48,
        },
      }),
      "a",
    );
  });
});
