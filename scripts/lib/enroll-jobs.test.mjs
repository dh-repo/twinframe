import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_EXTRA_VIEW_CAP,
  collectEnrollJobs,
  extraImagePaths,
  resolveExtraViewCap,
} from "./enroll-jobs.mjs";

function makeCelebDir(id, { heldOut = [], extraPhotos = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "enroll-jobs-"));
  fs.writeFileSync(path.join(root, `${id}.jpg`), "x");
  if (heldOut.length > 0) {
    fs.mkdirSync(path.join(root, "held-out", id), { recursive: true });
    for (const f of heldOut) fs.writeFileSync(path.join(root, "held-out", id, f), "h");
  }
  if (extraPhotos.length > 0) {
    fs.mkdirSync(path.join(root, "extra-photos", id), { recursive: true });
    for (const f of extraPhotos) fs.writeFileSync(path.join(root, "extra-photos", id, f), "e");
  }
  return root;
}

describe("collectEnrollJobs", () => {
  it("fans primary + extra views and skips held-out 001", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "enroll-jobs-"));
    const thumbs = path.join(root, "thumbs");
    fs.mkdirSync(thumbs);
    fs.writeFileSync(path.join(root, "adele.jpg"), "x");
    fs.mkdirSync(path.join(root, "held-out", "adele"), { recursive: true });
    fs.writeFileSync(path.join(root, "held-out", "adele", "001.jpg"), "q");
    fs.writeFileSync(path.join(root, "held-out", "adele", "002.jpg"), "e");
    fs.mkdirSync(path.join(root, "extra-photos", "adele"), { recursive: true });
    fs.writeFileSync(path.join(root, "extra-photos", "adele", "side.png"), "s");

    const extras = extraImagePaths("adele", root);
    assert.equal(extras.length, 2);
    assert.ok(extras.some((p) => p.endsWith("002.jpg")));
    assert.ok(!extras.some((p) => p.endsWith("001.jpg")));

    const jobs = collectEnrollJobs([{ id: "adele" }, { id: "missing-id" }], {
      celebsDir: root,
      thumbDir: thumbs,
    });
    assert.deepEqual(
      jobs.map((j) => j.kind),
      ["primary", "extra", "extra", "missing"],
    );
    assert.equal(jobs[0]?.source, "adele.jpg");
    assert.equal(jobs[3]?.id, "missing-id");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("still enrolls extra views for ids whose primary photo is not on disk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "enroll-jobs-"));
    fs.mkdirSync(path.join(root, "extra-photos", "greta-gerwig"), { recursive: true });
    fs.writeFileSync(path.join(root, "extra-photos", "greta-gerwig", "002.jpg"), "e");
    const jobs = collectEnrollJobs([{ id: "greta-gerwig" }], {
      celebsDir: root,
      thumbDir: path.join(root, "thumbs"),
    });
    assert.deepEqual(
      jobs.map((j) => j.kind),
      ["missing", "extra"],
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("falls back to the thumb when the hires JPEG is absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "enroll-jobs-"));
    const thumbs = path.join(root, "thumbs");
    fs.mkdirSync(thumbs);
    fs.writeFileSync(path.join(thumbs, "zendaya.png"), "t");
    const jobs = collectEnrollJobs([{ id: "zendaya" }], { celebsDir: root, thumbDir: thumbs });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.kind, "primary");
    assert.equal(jobs[0]?.source, "zendaya.png");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("extra view cap", () => {
  it("keeps up to eight views per id by default", () => {
    const root = makeCelebDir("adele", {
      heldOut: ["001.jpg", "002.jpg", "003.jpg", "004.jpg"],
      extraPhotos: ["002.jpg", "003.jpg", "004.jpg", "005.jpg", "006.jpg", "007.jpg"],
    });
    assert.equal(DEFAULT_EXTRA_VIEW_CAP, 8);
    const extras = extraImagePaths("adele", root);
    assert.equal(extras.length, 8);
    assert.ok(!extras.some((p) => p.endsWith(path.join("held-out", "adele", "001.jpg"))));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("never enrolls the held-out eval probe even when the cap has room", () => {
    const root = makeCelebDir("adele", { heldOut: ["001.jpeg", "1.jpg", "002.jpg"] });
    const extras = extraImagePaths("adele", root, 8);
    assert.deepEqual(
      extras.map((p) => path.basename(p)),
      ["002.jpg"],
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("honours an explicit cap and the env override", () => {
    const root = makeCelebDir("adele", {
      extraPhotos: ["002.jpg", "003.jpg", "004.jpg", "005.jpg"],
    });
    assert.equal(extraImagePaths("adele", root, 2).length, 2);
    assert.equal(extraImagePaths("adele", root, 0).length, 0);

    assert.equal(resolveExtraViewCap({}), DEFAULT_EXTRA_VIEW_CAP);
    assert.equal(resolveExtraViewCap({ TWINFRAME_EXTRA_VIEW_CAP: "3" }), 3);
    assert.throws(() => resolveExtraViewCap({ TWINFRAME_EXTRA_VIEW_CAP: "-1" }));

    const jobs = collectEnrollJobs([{ id: "adele" }], {
      celebsDir: root,
      thumbDir: path.join(root, "thumbs"),
      extraViewCap: 1,
    });
    assert.deepEqual(
      jobs.map((j) => j.kind),
      ["primary", "extra"],
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});
