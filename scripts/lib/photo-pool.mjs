/**
 * Child-process pool for independent photo jobs.
 * One 112×112 EdgeFace pass will not fill a big GPU; fan out JPEGs instead.
 */
import { fork } from "node:child_process";
import os from "node:os";

const MAX_POOL = 16;

export function defaultPhotoConcurrency() {
  const n =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(MAX_POOL, n));
}

export function parseConcurrencyArg(argv = process.argv, fallback = defaultPhotoConcurrency()) {
  const idx = argv.indexOf("--concurrency");
  if (idx < 0 || !argv[idx + 1] || String(argv[idx + 1]).startsWith("-")) return fallback;
  const n = Number(argv[idx + 1]);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid --concurrency "${argv[idx + 1]}"`);
  }
  return Math.min(MAX_POOL, Math.floor(n));
}

/**
 * Map jobs through a forked worker script.
 * Worker protocol: send `{ type: "ready" }`, then handle
 * `{ type: "job", id, payload }` with `{ type: "result", id, ok, value?, error? }`.
 *
 * @template TJob
 * @template TValue
 * @param {TJob[]} jobs
 * @param {{
 *   workerPath: string,
 *   concurrency?: number,
 *   execArgv?: string[],
 *   onProgress?: (done: number, total: number) => void,
 * }} options
 * @returns {Promise<Array<{ ok: true, value: TValue } | { ok: false, error: string }>>}
 */
export async function mapProcessPool(jobs, options) {
  if (!options?.workerPath) throw new Error("mapProcessPool requires workerPath");
  if (jobs.length === 0) return [];

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, jobs.length));
  const execArgv = options.execArgv ?? process.execArgv;
  const results = new Array(jobs.length);

  await new Promise((resolve, reject) => {
    let settled = false;
    let next = 0;
    let completed = 0;
    /** @type {import("node:child_process").ChildProcess[]} */
    const workers = [];

    const finish = (err) => {
      if (settled) return;
      settled = true;
      for (const child of workers) {
        child.removeAllListeners();
        if (!child.killed) child.kill();
      }
      if (err) reject(err);
      else resolve(undefined);
    };

    const spawnWorker = () => {
      const child = fork(options.workerPath, [], {
        stdio: ["ignore", "ignore", "inherit", "ipc"],
        execArgv,
      });
      workers.push(child);
      let busyIdx = -1;

      const sendNext = () => {
        if (settled || busyIdx >= 0) return;
        if (next >= jobs.length) {
          if (completed === jobs.length) finish();
          return;
        }
        const idx = next++;
        busyIdx = idx;
        child.send({ type: "job", id: idx, payload: jobs[idx] });
      };

      child.on("message", (msg) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "ready") {
          sendNext();
          return;
        }
        if (msg.type !== "result") return;
        const idx = msg.id;
        if (idx !== busyIdx) {
          finish(new Error(`worker result id ${idx} != busy ${busyIdx}`));
          return;
        }
        results[idx] = msg.ok
          ? { ok: true, value: msg.value }
          : { ok: false, error: String(msg.error ?? "worker failed") };
        busyIdx = -1;
        completed++;
        options.onProgress?.(completed, jobs.length);
        if (completed === jobs.length) finish();
        else sendNext();
      });

      child.on("error", (err) => finish(err));
      child.on("exit", (code, signal) => {
        if (settled) return;
        if (busyIdx >= 0 || code !== 0) {
          finish(
            new Error(
              `embed worker exited code=${code} signal=${signal ?? ""} while ${
                busyIdx >= 0 ? `job ${busyIdx}` : "idle"
              }`,
            ),
          );
        }
      });
    };

    for (let i = 0; i < concurrency; i++) spawnWorker();
  });

  return results;
}
