import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/held-out-encode")({
  component: HeldOutEncodePage,
});

declare global {
  interface Window {
    __heldoutDone?: unknown;
    __heldoutProgress?: { done: number; total: number; lastId?: string; lastOk?: boolean };
    __heldoutTotal?: number;
    __heldoutError?: string;
    __heldoutSnapshot?: unknown;
    __heldoutMeta?: { model: string; dim: number; alignment: string };
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed ${src}`));
    img.src = src;
  });
}

type Row = {
  id: string;
  name: string;
  descriptor: number[];
  age: number | null;
  gender: "male" | "female" | "unknown";
  genderProb: number;
  ok: boolean;
  source: string;
};

function HeldOutEncodePage() {
  const [status, setStatus] = useState<"idle" | "loading" | "running" | "done" | "error">("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [okCount, setOkCount] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const runningRef = useRef(false);

  const appendLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`].slice(-80));

  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const engine = params.get("engine") === "faceapi" ? "faceapi" : "edgeface";

        setStatus("loading");

        let describeWithEdgeFace: ((img: HTMLImageElement) => Promise<{
          descriptor: number[];
          age: number;
          gender: "male" | "female" | "unknown";
          genderProb: number;
        } | null>) | null = null;

        if (engine === "edgeface") {
          appendLog("loading scrfd + edgeface + face-api demographics…");
          const [{ detectSCRFD }, { padSourceForDetection }, { align5PointSimilarityTensor }, { extractEdgeFaceEmbedding }, { loadFaceApi, detectAndDescribe }] =
            await Promise.all([
              import("@/lib/face/scrfd"),
              import("@/lib/face/pipeline"),
              import("@/lib/face/similarity-transform"),
              import("@/lib/face/edgeface"),
              import("@/lib/face/faceapi-engine"),
            ]);
          await loadFaceApi();

          describeWithEdgeFace = async (img) => {
            let scrfd = await detectSCRFD(img).catch(() => null);
            if (scrfd && !scrfd.primary) {
              const padded = padSourceForDetection(img);
              if (padded) {
                const retry = await detectSCRFD(padded).catch(() => null);
                if (retry?.primary) scrfd = retry;
              }
            }
            const primary = scrfd?.primary;
            if (!primary) return null;
            const tensor = align5PointSimilarityTensor(img, primary.landmarks, 112);
            const ef = await extractEdgeFaceEmbedding(tensor);
            const det = await detectAndDescribe(img, { skipDescriptor: true, maxSide: 512 }).catch(
              () => null,
            );
            return {
              descriptor: Array.from(ef.embedding),
              age: Math.round(det?.age ?? NaN),
              gender: det?.gender ?? "unknown",
              genderProb: det?.genderProbability ?? 0,
            };
          };
        }

        let legacyDescribe: ((img: HTMLImageElement) => Promise<Row | null>) | null = null;
        if (engine === "faceapi") {
          appendLog("loading face-api…");
          const { loadFaceApi, detectAndDescribe, detectAndDescribeWithTTA } = await import(
            "@/lib/face/faceapi-engine"
          );
          await loadFaceApi();
          legacyDescribe = async (img) => {
            const runDetect = (useTta: boolean) =>
              Promise.race([
                (useTta ? detectAndDescribeWithTTA : detectAndDescribe)(img, {
                  enableContrastBoost: true,
                  maxSide: 960,
                }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 45_000)),
              ]);
            let det = await runDetect(false);
            if (!det?.descriptor) det = await runDetect(true);
            if (det?.descriptor && (det.descriptor as ArrayLike<number>).length === 128) {
              return {
                id: "",
                name: "",
                descriptor: Array.from(det.descriptor as unknown as number[]),
                age: Math.round(det.age),
                gender: det.gender,
                genderProb: det.genderProbability ?? 0,
                ok: true,
                source: "",
              };
            }
            return null;
          };
        }

        const manifestPath = params.get("manifest") || "/celebs/held-out/manifest.json";
        appendLog(`manifest ${manifestPath}`);
        const manifest = await fetch(manifestPath, { cache: "no-store" }).then(
          (r) => {
            if (!r.ok) throw new Error(`manifest ${r.status}`);
            return r.json() as Promise<{
              cases: Array<{ id: string; name: string; imagePath: string }>;
            }>;
          },
        );
        const cases = manifest.cases ?? [];
        if (cases.length === 0) throw new Error("held-out manifest is empty");

        setTotal(cases.length);
        window.__heldoutTotal = cases.length;
        window.__heldoutDone = null;
        setStatus("running");

        const out: Row[] = [];
        let successes = 0;

        for (let i = 0; i < cases.length; i++) {
          const c = cases[i]!;
          let row: Row = {
            id: c.id,
            name: c.name,
            descriptor: [],
            age: null,
            gender: "unknown",
            genderProb: 0,
            ok: false,
            source: c.imagePath,
          };
          try {
            const img = await loadImage(c.imagePath);
            if (describeWithEdgeFace) {
              const res = await describeWithEdgeFace(img);
              if (res && res.descriptor.length >= 256) {
                row = {
                  id: c.id,
                  name: c.name,
                  descriptor: res.descriptor,
                  age: Number.isFinite(res.age) ? res.age : null,
                  gender: res.gender,
                  genderProb: res.genderProb,
                  ok: true,
                  source: c.imagePath,
                };
                window.__heldoutMeta = {
                  model: `edgeface-${res.descriptor.length}d`,
                  dim: res.descriptor.length,
                  alignment: "scrfd-5pt-similarity-112",
                };
                successes++;
                appendLog(`OK ${c.id} dim=${res.descriptor.length}`);
              } else {
                appendLog(`MISS ${c.id}`);
              }
            } else if (legacyDescribe) {
              const res = await legacyDescribe(img);
              if (res) {
                row = { ...res, id: c.id, name: c.name, source: c.imagePath };
                successes++;
                appendLog(`OK ${c.id}`);
              } else {
                appendLog(`MISS ${c.id}`);
              }
            }
          } catch (e) {
            appendLog(`ERR ${c.id} ${e instanceof Error ? e.message : e}`);
          }
          out.push(row);
          setDone(i + 1);
          setOkCount(successes);
          window.__heldoutProgress = {
            done: i + 1,
            total: cases.length,
            lastId: c.id,
            lastOk: row.ok,
          };
          window.__heldoutSnapshot = out;
          if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
        }

        window.__heldoutDone = out;
        appendLog(`done ${successes}/${cases.length}`);
        setStatus("done");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        window.__heldoutError = msg;
        appendLog(`ERROR ${msg}`);
        setStatus("error");
      }
    })();
  }, []);

  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-zinc-100 p-8">
      <h1 className="text-xl font-semibold">Held-out encode</h1>
      <p className="mt-2 text-sm text-zinc-400">
        {status} · {okCount}/{done} ok · {done}/{total} ({pct}%)
      </p>
      <pre className="mt-6 text-xs text-zinc-400 whitespace-pre-wrap max-h-[70vh] overflow-auto">
        {logs.join("\n")}
      </pre>
    </main>
  );
}
