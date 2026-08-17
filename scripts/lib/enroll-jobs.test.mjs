import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { collectEnrollJobs, extraImagePaths } from "./enroll-jobs.mjs";

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
