import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/re-encode")({
  component: ReEncodePage,
});

declare global {
  interface Window {
    __reencodeDone?: unknown;
    __reencodeProgress?: { done: number; total: number; lastId?: string; lastOk?: boolean };
    __reencodeTotal?: number;
    __reencodeError?: string;
    __reencodePartial?: boolean;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    (img as unknown as { decoding: string }).decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed ${src}`));
    img.src = src;
  });
}

function upscaleIfNeeded(
  img: HTMLImageElement,
  target = 640,
): HTMLImageElement | HTMLCanvasElement {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  // Upscale small thumbs; also pad transparent WebP edges onto white
  if (w >= target && h >= target) return img;
  const scale = target / Math.max(w, h, 1);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d");
  if (!ctx) return img;
  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = "high";
  // white background to avoid transparent edge artifacts
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  return c;
}

/** Prefer largest source first (full JPG before 192/96 thumbs). */
function sourceRank(src: string): number {
  if (src.includes("/thumbs/96/")) return 2;
  if (src.includes("/thumbs/192/")) return 1;
  return 0;
}

function orderedSources(entry: {
  path?: string;
  path192?: string;
  fallbackPath?: string;
}): string[] {
  const ranked = [entry.fallbackPath, entry.path192, entry.path]
    .filter((p): p is string => Boolean(p))
    .sort((a, b) => sourceRank(a) - sourceRank(b));
  return [...new Set(ranked)];
}

function ReEncodePage() {
  const [status, setStatus] = useState<"idle" | "loading" | "running" | "done" | "error">("idle");
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [okCount, setOkCount] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [preview, setPreview] = useState<string>("");
  const runningRef = useRef(false);

  const appendLog = (msg: string) =>
    setLogs((prev) => {
      const next = [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`];
      return next.slice(-120);
    });

  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    (async () => {
      try {
        setStatus("loading");
        appendLog("loading face-api models...");
        // lazy import to keep SSR safe
        const { loadFaceApi, detectAndDescribe } = await import(
          "@/lib/face/faceapi-engine"
        );
        // fast mode: ?fast=1 uses single detection (no TTA) + batch parallelism for speed
        const fast = new URLSearchParams(window.location.search).has("fast");
        const engineLabel = fast ? "detectAndDescribe (fast, no TTA, batch×3)" : "detectAndDescribeWithTTA (high-accuracy)";
        const api = await loadFaceApi();
        void api;
        appendLog(`models loaded from /models/face-api — engine: ${engineLabel}`);

        type CelebIndexEntry = {
          id: string;
          name: string;
          path: string;
          path192: string;
          fallbackPath: string;
          gender: string;
          genderProb: number;
          baseAge?: number;
          source?: string;
        };
        const fullIdx: CelebIndexEntry[] = await fetch("/celebs/index.json", {
          cache: "no-store",
        }).then((r) => {
          if (!r.ok) throw new Error(`index fetch ${r.status}`);
          return r.json();
        });

        // Optional filters:
        //   ?ids=a,b,c              — comma-separated id list
        //   ?targets=1              — load /celebs/reencode-miss-targets.json
        //   ?only=legacy            — only entries with source === "legacy-json"
        const params = new URLSearchParams(window.location.search);
        let idx = fullIdx;
        const idsParam = params.get("ids");
        if (idsParam) {
          const want = new Set(
            idsParam
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
          idx = fullIdx.filter((e) => want.has(e.id));
          appendLog(`filter ids=: ${idx.length}/${fullIdx.length}`);
        } else if (params.has("targets")) {
          const targets = await fetch("/celebs/reencode-miss-targets.json", {
            cache: "no-store",
          }).then((r) => {
            if (!r.ok) throw new Error(`targets fetch ${r.status}`);
            return r.json() as Promise<{ ids?: string[] }>;
          });
          const want = new Set(targets.ids ?? []);
          idx = fullIdx.filter((e) => want.has(e.id));
          appendLog(`filter targets=: ${idx.length}/${fullIdx.length}`);
        } else if (params.get("only") === "legacy") {
          idx = fullIdx.filter((e) => e.source === "legacy-json");
          appendLog(`filter only=legacy: ${idx.length}/${fullIdx.length}`);
        }

        if (idx.length === 0) {
          throw new Error("re-encode filter matched 0 celebrities");
        }

        setTotal(idx.length);
        (window as unknown as Record<string, unknown>).__reencodeTotal = idx.length;
        (window as unknown as Record<string, unknown>).__reencodeDone = null;
        (window as unknown as Record<string, unknown>).__reencodePartial =
          idx.length < fullIdx.length;
        appendLog(`index: ${idx.length} celebs${idx.length < fullIdx.length ? " (partial)" : ""}`);

        setStatus("running");
        const out: Array<{
          id: string;
          name: string;
          descriptor: number[];
          templates?: number[][];
          age: number;
          gender: "male" | "female";
          genderProb: number;
          confidence: number;
          source: string;
        }> = new Array(idx.length) as unknown as typeof out;
        let successes = 0;

        // helper: single celeb detection (full JPG first, then thumbs; upscale + CLAHE)
        async function processOne(entry: (typeof idx)[number], index: number) {
          const label = `${index + 1}/${idx.length} ${entry.id}`;
          const uniq = orderedSources(entry);
          const FACE_MS = 20_000;
          let det: Awaited<ReturnType<typeof detectAndDescribe>> | null = null;
          let usedSrc = "";
          let lastErr = "";
          const detectOpts = {
            enableContrastBoost: true,
            maxSide: 960,
            // re-encode is offline: never fast-exit TTA for higher quality
            fastExitConfidence: 1.01,
          };
          for (const src of uniq) {
            try {
              const img = await loadImage(src);
              // try native size, then forced upscale for tiny thumbs
              const sources: Array<HTMLImageElement | HTMLCanvasElement> = [img];
              const w = img.naturalWidth || img.width;
              const h = img.naturalHeight || img.height;
              if (Math.max(w, h) < 640) sources.push(upscaleIfNeeded(img, 640));
              if (Math.max(w, h) < 320) sources.push(upscaleIfNeeded(img, 800));

              for (const source of sources) {
                const run = fast
                  ? detectAndDescribe(source as unknown as HTMLImageElement, detectOpts)
                  : (async () => {
                      const { detectAndDescribeWithTTA: withTTA } = await import(
                        "@/lib/face/faceapi-engine"
                      );
                      return withTTA(source as unknown as HTMLImageElement, detectOpts);
                    })();
                det = await Promise.race([
                  run,
                  new Promise<null>((resolve) =>
                    setTimeout(() => resolve(null), FACE_MS),
                  ),
                ]);
                if (det) {
                  usedSrc = src;
                  break;
                }
                lastErr = `timeout or no face in ${src}`;
              }
              if (det) break;
              lastErr = `no face in ${src}`;
            } catch (e) {
              lastErr = e instanceof Error ? e.message : String(e);
            }
          }
          if (det) {
            const templates = (det.descriptors ?? [det.descriptor]).map((d) =>
              Array.from(d as unknown as number[]),
            );
            return {
              id: entry.id,
              name: entry.name,
              descriptor: Array.from(det.descriptor as unknown as number[]),
              templates,
              age: Math.round(det.age),
              gender: det.gender,
              genderProb: det.genderProbability,
              confidence: det.confidence,
              source: usedSrc,
              ok: true as const,
              faceCanvas: det.faceCanvas,
              label,
            };
          } else {
            return {
              id: entry.id,
              name: entry.name,
              descriptor: [] as number[],
              age: entry.baseAge ?? 32,
              gender: (entry.gender as "male" | "female") ?? "male",
              genderProb: entry.genderProb ?? 0.9,
              confidence: 0,
              source: `FAILED ${lastErr}`,
              ok: false as const,
              label,
              lastErr,
            };
          }
        }

        if (fast) {
          // Batch×3 parallelism for fast mode
          const BATCH = 4;
          for (let batchStart = 0; batchStart < idx.length; batchStart += BATCH) {
            const batch = idx.slice(batchStart, batchStart + BATCH);
            const results = await Promise.all(
              batch.map((entry, offset) => processOne(entry, batchStart + offset)),
            );
            for (let k = 0; k < results.length; k++) {
              const r = results[k]!;
              const i = batchStart + k;
              if (r.ok) {
                successes++;
                out[i] = {
                  id: r.id,
                  name: r.name,
                  descriptor: r.descriptor,
                  templates: (r as { templates?: number[][] }).templates,
                  age: r.age,
                  gender: r.gender,
                  genderProb: r.genderProb,
                  confidence: r.confidence,
                  source: r.source,
                };
                if (i % 40 === 0) {
                  try {
                    setPreview((r as unknown as { faceCanvas: HTMLCanvasElement }).faceCanvas?.toDataURL("image/jpeg", 0.5).slice(0, 120) + "...");
                  } catch {}
                }
                appendLog(`OK ${r.label} age=${r.age} conf=${r.confidence.toFixed(2)} via ${r.source}`);
              } else {
                out[i] = {
                  id: r.id,
                  name: r.name,
                  descriptor: [],
                  age: r.age,
                  gender: r.gender,
                  genderProb: r.genderProb,
                  confidence: 0,
                  source: r.source,
                };
                appendLog(`MISS ${r.label} ${(r as unknown as { lastErr: string }).lastErr}`);
              }
            }
            const doneCount = Math.min(batchStart + BATCH, idx.length);
            setDone(doneCount);
            setOkCount(successes);
            (window as unknown as Record<string, unknown>).__reencodeProgress = {
              done: doneCount,
              total: idx.length,
              lastId: batch[batch.length - 1]!.id,
              lastOk: results[results.length - 1]!.ok,
            };
            (window as unknown as Record<string, unknown>).__reencodeSnapshot = out.filter(Boolean);
            // yield
            await new Promise((r) => setTimeout(r, 0));
          }
        } else {
          for (let i = 0; i < idx.length; i++) {
            const entry = idx[i]!;
            const r = await processOne(entry, i);
            if (r.ok) {
              successes++;
              out[i] = {
                id: r.id,
                name: r.name,
                descriptor: r.descriptor,
                templates: (r as { templates?: number[][] }).templates,
                age: r.age,
                gender: r.gender,
                genderProb: r.genderProb,
                confidence: r.confidence,
                source: r.source,
              };
              if (i % 40 === 0) {
                try {
                  setPreview((r as unknown as { faceCanvas: HTMLCanvasElement }).faceCanvas?.toDataURL("image/jpeg", 0.5).slice(0, 120) + "...");
                } catch {}
              }
              appendLog(`OK ${r.label} age=${r.age} conf=${r.confidence.toFixed(2)} via ${r.source}`);
            } else {
              out[i] = {
                id: r.id,
                name: r.name,
                descriptor: [],
                age: r.age,
                gender: r.gender,
                genderProb: r.genderProb,
                confidence: 0,
                source: r.source,
              };
              appendLog(`MISS ${r.label} ${(r as unknown as { lastErr: string }).lastErr}`);
            }
            setDone(i + 1);
            setOkCount(successes);
            (window as unknown as Record<string, unknown>).__reencodeProgress = {
              done: i + 1,
              total: idx.length,
              lastId: entry.id,
              lastOk: r.ok,
            };
            (window as unknown as Record<string, unknown>).__reencodeSnapshot = out.filter(Boolean);
            if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
            if (i % 50 === 0) await new Promise((r) => setTimeout(r, 20));
          }
        }

        (window as unknown as Record<string, unknown>).__reencodeDone = out;
        appendLog(`done: ${successes}/${idx.length} faces detected`);
        setStatus("done");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        appendLog(`ERROR: ${msg}`);
        (window as unknown as Record<string, unknown>).__reencodeError = msg;
        setStatus("error");
      }
    })();
  }, []);

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-zinc-100 flex flex-col items-center p-6 pt-10">
      <div className="w-full max-w-[860px] rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur p-6 md:p-8">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
          Twinframe — Browser Re-encode
        </h1>
        <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
          Re-encoding 1000 celeb faces to true FaceNet 128-d descriptors via on-device{" "}
          <code className="text-zinc-300">face-api</code> (Ssd + landmarks + FaceNet) with TTA
          flip-averaging and L2-normalization. Runs entirely in your browser. Keep this tab open.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
              status === "done"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : status === "error"
                  ? "border-red-500/30 bg-red-500/10 text-red-300"
                  : "border-white/10 bg-white/5 text-zinc-300"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                status === "running" || status === "loading"
                  ? "animate-pulse bg-amber-400"
                  : status === "done"
                    ? "bg-emerald-400"
                    : "bg-zinc-500"
              }`}
            />
            {status.toUpperCase()} {status === "running" ? `· ${pct}%` : ""}
          </span>
          <span className="text-zinc-400">
            {done}/{total} · <span className="text-emerald-300">{okCount} ok</span> ·{" "}
            <span className="text-amber-300">{Math.max(0, done - okCount)} miss</span>
          </span>
        </div>

        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {preview && (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] font-mono text-zinc-500 break-all">
            last face preview dataURL head: {preview}
          </div>
        )}

        <div className="mt-6 grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-[360px] overflow-auto font-mono text-[12px] leading-5">
            {logs.length === 0 ? (
              <span className="text-zinc-600">waiting...</span>
            ) : (
              logs.map((l, i) => (
                <div key={i} className={l.includes("OK") ? "text-emerald-300" : l.includes("MISS") ? "text-amber-300" : "text-zinc-400"}>
                  {l}
                </div>
              ))
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-400">
            <div className="font-medium text-zinc-200">How it works</div>
            <ul className="mt-2 list-disc pl-5 space-y-1.5 text-[13px]">
              <li>
                Loads <code className="text-zinc-300">SsdMobilenetv1 + 68 landmarks + FaceNet</code> from{" "}
                <code className="text-zinc-300">/models/face-api</code>.
              </li>
              <li>
                For each celeb, tries <code className="text-zinc-300">/celebs/thumbs/192/*.webp</code> (upscaled to
                512) → fallback JPG, with 3 confidence thresholds + <code className="text-zinc-300">TTA</code>.
              </li>
              <li>
                Emits <code className="text-zinc-300">window.__reencodeDone</code> (1000 × 128 floats) for the
                Playwright runner to quantize to <code className="text-zinc-300">q8 / f32</code> buckets.
              </li>
              <li className="text-zinc-500">
                Failures keep synthetic Gaussian descriptor so gallery stays 1000/1000. Target is &gt;90% real.
              </li>
            </ul>
            <div className="mt-4 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-amber-200/80 text-xs">
              Do not close this tab until <strong className="text-amber-200">100% DONE</strong>. The runner will
              auto-save <code>embeddings.*.bin</code> + <code>gallery.buckets.json</code> and push.
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <a
            href="/"
            className="rounded-full bg-white text-zinc-900 px-5 py-2 text-sm font-medium hover:bg-zinc-100 transition"
          >
            ← Back to app
          </a>
          <span className="text-xs text-zinc-500 self-center">
            API: <code>GET /celebs/index.json</code> · <code>GET /celebs/thumbs/192/*.webp</code>
          </span>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-zinc-600">
        Twinframe · on-device · FaceNet 128-d · L2 + TTA · quantized int8-biased
      </div>
    </div>
  );
}
