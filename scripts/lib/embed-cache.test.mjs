import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  EMBED_CACHE_MODEL,
  embedCacheKey,
  fileSha256,
  loadEmbedCache,
  partitionCachedJobs,
  saveEmbedCache,
} from "./embed-cache.mjs";

describe("embed cache", () => {
  it("keys by model + file bytes, not path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-cache-"));
    const a = path.join(dir, "a.jpg");
    const b = path.join(dir, "b.jpg");
    fs.writeFileSync(a, "same-bytes");
    fs.writeFileSync(b, "same-bytes");
    assert.equal(fileSha256(a), fileSha256(b));
    assert.equal(embedCacheKey(fileSha256(a)), `${EMBED_CACHE_MODEL}:${fileSha256(a)}`);
    fs.writeFileSync(b, "other");
    assert.notEqual(fileSha256(a), fileSha256(b));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips entries and rebuilds a corrupt file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-cache-"));
    const p = path.join(dir, "cache.json");
    const empty = loadEmbedCache(p);
    assert.deepEqual(empty.entries, {});
    saveEmbedCache(
      { version: 1, model: EMBED_CACHE_MODEL, entries: { "adaface-ir101-512d:abc": { d512: [0.1] } } },
      p,
    );
    const loaded = loadEmbedCache(p);
    assert.equal(loaded.entries["adaface-ir101-512d:abc"].d512[0], 0.1);

    fs.writeFileSync(p, "{not-json");
    const rebuilt = loadEmbedCache(p);
    assert.deepEqual(rebuilt.entries, {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("partitions cache hits from misses and treats missing files as misses", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-cache-"));
    const hitPath = path.join(dir, "hit.jpg");
    const missPath = path.join(dir, "miss.jpg");
    fs.writeFileSync(hitPath, "portrait");
    fs.writeFileSync(missPath, "other-portrait");
    const key = embedCacheKey(fileSha256(hitPath));
    const cache = {
      version: 1,
      model: EMBED_CACHE_MODEL,
      entries: { [key]: { d512: [1, 0], usedDetection: true, score: 0.9 } },
    };
    const jobs = [{ filePath: hitPath }, { filePath: missPath }, { filePath: path.join(dir, "gone.jpg") }];
    const { hits, misses, missIndex } = partitionCachedJobs(jobs, cache);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].index, 0);
    assert.equal(hits[0].value.score, 0.9);
    assert.equal(misses.length, 2);
    assert.deepEqual(missIndex, [1, 2]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
