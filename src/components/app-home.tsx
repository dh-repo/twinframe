import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Shield, Zap, ScanFace } from "lucide-react";
import { PhotoUploader } from "@/components/capture/photo-uploader";
import { WebcamCapture } from "@/components/capture/webcam-capture";
import { MatchResults } from "@/components/results/match-results";
import { AnalyzingState } from "@/components/analyzing-state";
import { Button } from "@/components/ui/button";
import {
  analyzeFaceSource,
  loadImageFromBlob,
  prefetchModel,
} from "@/lib/face/pipeline";
import type { MatchResult } from "@/lib/face/types";
import { loadCelebrityEmbeddings } from "@/lib/face/embeddings";

type Phase = "capture" | "analyzing" | "results" | "error";

export function AppHome() {
  const [phase, setPhase] = useState<Phase>("capture");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [gallerySize, setGallerySize] = useState(267);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    prefetchModel();
    void loadCelebrityEmbeddings()
      .then((g) => setGallerySize(g.length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const setPreview = useCallback((url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreviewUrl(url);
  }, []);

  const runAnalysis = useCallback(
    async (blob: Blob) => {
      setError(null);
      setResult(null);
      setPhase("analyzing");
      setStepIndex(0);

      const url = URL.createObjectURL(blob);
      setPreview(url);

      const timers = [
        window.setTimeout(() => setStepIndex(1), 500),
        window.setTimeout(() => setStepIndex(2), 1200),
        window.setTimeout(() => setStepIndex(3), 2200),
      ];

      try {
        const img = await loadImageFromBlob(blob);
        setStepIndex(1);
        const matchResult = await analyzeFaceSource(img, { topK: 6 });
        setStepIndex(3);
        await new Promise((r) => setTimeout(r, 200));
        setResult(matchResult);
        setPhase("results");
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "Something went wrong analyzing your photo.";
        setError(msg);
        setPhase("error");
      } finally {
        timers.forEach(clearTimeout);
      }
    },
    [setPreview],
  );

  const onFile = useCallback(
    (file: File) => {
      void runAnalysis(file);
    },
    [runAnalysis],
  );

  const onCapture = useCallback(
    (blob: Blob) => {
      void runAnalysis(blob);
    },
    [runAnalysis],
  );

  const reset = useCallback(() => {
    setPhase("capture");
    setResult(null);
    setError(null);
    setStepIndex(0);
    setPreview(null);
  }, [setPreview]);

  const showHero = phase === "capture";

  return (
    <div className="app-shell">
      <div className="app-content mx-auto w-full max-w-md px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))] sm:max-w-lg sm:px-6">
        <header className={showHero ? "mb-7 sm:mb-9" : "mb-5"}>
          <div className="mb-4 flex items-center justify-between gap-3 sm:mb-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-bg-elevated">
                <ScanFace className="h-4 w-4 text-fg" strokeWidth={1.5} />
              </div>
              <span className="text-sm font-medium tracking-tight">Twinframe</span>
            </div>
            {phase === "results" && (
              <button
                type="button"
                onClick={reset}
                className="text-xs text-fg-muted transition-colors hover:text-fg"
              >
                New photo
              </button>
            )}
          </div>

          {showHero && (
            <>
              <h1 className="text-[1.75rem] sm:text-[2.15rem] font-medium tracking-tight leading-[1.12] text-balance">
                Find your celebrity doppelgänger
              </h1>
              <p className="mt-2.5 max-w-md text-sm leading-relaxed text-fg-muted text-pretty">
                Upload a selfie or use your camera. Matching runs on-device with
                FaceNet embeddings against{" "}
                <span className="tabular-nums text-fg">{gallerySize}</span> stars.
              </p>
            </>
          )}
        </header>

        {phase === "capture" && (
          <ul className="mb-5 flex flex-wrap gap-2">
            {[
              { icon: Shield, label: "Private · on-device" },
              { icon: Zap, label: "FaceNet match" },
              { icon: Camera, label: "Upload or camera" },
            ].map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated/80 px-2.5 py-1 text-[11px] text-fg-muted"
              >
                <Icon className="h-3 w-3" strokeWidth={1.75} />
                {label}
              </li>
            ))}
          </ul>
        )}

        {phase === "capture" && (
          <div className="animate-fade-up space-y-3.5">
            <PhotoUploader onFile={onFile} />
            <div className="relative flex items-center gap-3 py-0.5">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-fg-subtle">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => setCameraOpen(true)}
            >
              <Camera className="h-5 w-5" />
              Use camera
            </Button>
            <p className="pt-1 text-center text-[11px] leading-relaxed text-fg-subtle text-pretty">
              Best results: face the light, look at the lens, fill the frame.
            </p>
          </div>
        )}

        {phase === "analyzing" && <AnalyzingState stepIndex={stepIndex} />}

        {phase === "results" && result && (
          <MatchResults
            result={result}
            previewUrl={previewUrl}
            onReset={reset}
          />
        )}

        {phase === "error" && (
          <section className="animate-fade-up space-y-4 rounded-[var(--radius-xl)] border border-border bg-bg-elevated p-6 text-center">
            <h2 className="text-lg font-medium">Couldn't analyze that photo</h2>
            <p className="text-sm text-fg-muted text-pretty">{error}</p>
            <Button variant="secondary" onClick={reset}>
              Try again
            </Button>
          </section>
        )}

        {showHero && (
          <footer className="mt-10 border-t border-border pt-5 text-center">
            <p className="text-[11px] leading-relaxed text-fg-subtle text-pretty">
              Twinframe compares face embeddings for entertainment — not identity
              verification. Gallery: {gallerySize} celebrities.
            </p>
          </footer>
        )}
      </div>

      <WebcamCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={onCapture}
      />
    </div>
  );
}
