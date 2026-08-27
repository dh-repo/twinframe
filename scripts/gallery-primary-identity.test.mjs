import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CELEBS = path.join(ROOT, "public/celebs");

function sha(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

describe("gallery primary portraits are not the mislabeled 192-px thumbs", () => {
  for (const id of ["jack-black", "anne-hathaway", "bella-ramsey"]) {
    it(`${id}.jpg exists and differs from thumbs/192/${id}.webp`, () => {
      const jpg = path.join(CELEBS, `${id}.jpg`);
      const thumb = path.join(CELEBS, "thumbs/192", `${id}.webp`);
      assert.equal(fs.existsSync(jpg), true, `missing primary ${id}.jpg`);
      assert.equal(fs.existsSync(thumb), true, `missing thumb ${id}`);
      assert.notEqual(sha(jpg), sha(thumb), `${id} primary is still the 192-px thumb`);
      assert.ok(fs.statSync(jpg).size > 20_000, `${id}.jpg too small to be a portrait`);
    });
  }
});
