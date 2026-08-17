import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  defaultPhotoConcurrency,
  mapProcessPool,
  parseConcurrencyArg,
} from "./photo-pool.mjs";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "photo-pool.worker-fixture.mjs");

describe("photo concurrency", () => {
  it("defaults to at least 1 and at most 16", () => {
    const n = defaultPhotoConcurrency();
    assert.ok(n >= 1 && n <= 16);
  });

  it("parses --concurrency and rejects junk", () => {
    assert.equal(parseConcurrencyArg(["--concurrency", "4"], 2), 4);
    assert.equal(parseConcurrencyArg(["--limit", "3"], 7), 7);
    assert.equal(parseConcurrencyArg(["--concurrency", "99"], 2), 16);
    assert.throws(() => parseConcurrencyArg(["--concurrency", "0"], 2), /Invalid --concurrency/);
  });
});

describe("mapProcessPool", () => {
  it("returns [] for no jobs without spawning", async () => {
    const out = await mapProcessPool([], { workerPath: FIXTURE, concurrency: 4 });
    assert.deepEqual(out, []);
  });

  it("preserves order across a 3-wide pool", async () => {
    const jobs = [1, 2, 3, 4, 5, 6].map((n) => ({ n, delayMs: 80 }));
    const t0 = Date.now();
    const out = await mapProcessPool(jobs, { workerPath: FIXTURE, concurrency: 3 });
    const elapsed = Date.now() - t0;
    assert.equal(out.length, 6);
    assert.deepEqual(
      out.map((r) => r.ok && r.value.n),
      [2, 4, 6, 8, 10, 12],
    );
    const pids = new Set(out.map((r) => r.ok && r.value.pid));
    assert.ok(pids.size >= 2 && pids.size <= 3, `expected 2–3 workers, got ${pids.size}`);
    assert.ok(
      elapsed < 80 * 6 * 0.65,
      `pool should overlap 6×80ms jobs, took ${elapsed}ms`,
    );
  });

  it("keeps job-level failures without aborting the pool", async () => {
    const jobs = [{ n: 1 }, { n: 2, fail: true }, { n: 3 }];
    const out = await mapProcessPool(jobs, { workerPath: FIXTURE, concurrency: 2 });
    assert.equal(out[0]?.ok, true);
    assert.equal(out[1]?.ok, false);
    assert.match(String(out[1]?.error), /fixture-fail/);
    assert.equal(out[2]?.ok, true);
    assert.equal(out[2]?.value.n, 6);
  });

  it("rejects when a worker process crashes mid-job", async () => {
    await assert.rejects(
      mapProcessPool([{ n: 1, crash: true }], { workerPath: FIXTURE, concurrency: 1 }),
      /exited code=2/,
    );
  });
});
