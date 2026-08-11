import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Shield, Zap, ScanFace } from "lucide-react";
import { PhotoUploader } from "@/components/capture/photo-uploader";
import { WebcamCapture } from "@/components/capture/webcam-capture";
import { CropReview } from "@/components/capture/crop-review";
import { MatchResults } from "@/components/results/match-results";
import { AnalyzingState } from "@/components/analyzing-state";
import { Button } from "@/components/ui/button";
import {
  analyzeFaceSource,
  loadImageFromBlob,
  prefetchModel,
} from "@/lib/face/pipeline";
import type { FaceQuality, MatchResult } from "@/lib/face/types";
import { loadCelebrityEmbeddings } from "@/lib/face/embeddings";

type Phase = "capture" | "review" | "analyzing" | "results" | "error" | "quality-blocked";

export function AppHome() {
  const [phase, setPhase] = useState<Phase>("capture");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [gallerySize, setGallerySize] = useState(267);
  const previewRef = useRef<string | null>(null);
  // review state
  const [reviewSrc, setReviewSrc] = useState<string | null>(null);
  const [reviewFileName, setReviewFileName] = useState<string | undefined>(undefined);
  const reviewSrcRef = useRef<string | null>(null);

  useEffect(() => {
    prefetchModel();
    void loadCelebrityEmbeddings()
      .then((g) => setGallerySize(new Set(g.map((c) => c.id)).size))
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      if (reviewSrcRef.current) URL.revokeObjectURL(reviewSrcRef.current);
    };
  }, []);

  const setPreview = useCallback((url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreviewUrl(url);
  }, []);

  const setReview = useCallback((url: string | null, fileName?: string) => {
    if (reviewSrcRef.current) URL.revokeObjectURL(reviewSrcRef.current);
    reviewSrcRef.current = url;
    setReviewSrc(url);
    setReviewFileName(fileName);
  }, []);

  const clearReview = useCallback(() => {
    if (reviewSrcRef.current) URL.revokeObjectURL(reviewSrcRef.current);
    reviewSrcRef.current = null;
    setReviewSrc(null);
    setReviewFileName(undefined);
  }, []);

  const runAnalysis = useCallback(
    async (blob: Blob) => {
      setError(null);
      setResult(null);
      setPhase("analyzing");
      setStepIndex(0);
      setProgress(8);

      const url = URL.createObjectURL(blob);
      setPreview(url);

      // polished timed progress
      const timers: number[] = [];
      timers.push(window.setTimeout(() => { setStepIndex(1); setProgress(28); }, 600));
      timers.push(window.setTimeout(() => { setStepIndex(2); setProgress(56); }, 1400));
      timers.push(window.setTimeout(() => { setStepIndex(3); setProgress(82); }, 2300));

      try {
        const img = await loadImageFromBlob(blob);
        setStepIndex(1);
        setProgress(32);
        const matchResult = await analyzeFaceSource(img, { topK: 6 });
        setStepIndex(3);
        setProgress(96);

        // --- High-accuracy quality gate: stricter than before ---
        const q = matchResult.quality as FaceQuality & { sharpness?: number; illumination?: number };
        const sharpness = (q as unknown as { sharpness: number }).sharpness ?? 60;
        const isLowQuality =
          !matchResult.matches.length ||
          !matchResult.quality.ok ||
          matchResult.quality.score < 0.45 ||
          matchResult.quality.faceCoverage < 0.035 ||
          sharpness < 42 ||
          matchResult.quality.issues.some(
            (i) => i.includes("blurry") || i.includes("Low face confidence") || i.includes("Dim lighting"),
          );

        // Keep a short beat for polish before showing results
        await new Promise((r) => setTimeout(r, 260));
        setProgress(100);
        setResult(matchResult);

        if (isLowQuality && matchResult.matches.length === 0) {
          setPhase("quality-blocked");
        } else if (isLowQuality) {
          // High-accuracy mode: any quality issue blocks to force retake, unless user overrides
          if (
            !matchResult.quality.ok ||
            matchResult.quality.score < 0.48 ||
            matchResult.quality.faceCoverage < 0.04 ||
            sharpness < 45
          ) {
            setPhase("quality-blocked");
          } else {
            setPhase("results");
          }
        } else {
          setPhase("results");
        }
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
      // go to crop/approve review instead of immediate analysis
      const url = URL.createObjectURL(file);
      setReview(url, file.name);
      setPhase("review");
    },
    [setReview],
  );

  const onCapture = useCallback(
    (blob: Blob) => {
      // camera capture also goes through review for consistency, but with quick approve
      const url = URL.createObjectURL(blob);
      setReview(url, "camera.jpg");
      setPhase("review");
      setCameraOpen(false);
    },
    [setReview],
  );

  const onApproveCrop = useCallback(
    (croppedBlob: Blob) => {
      clearReview();
      void runAnalysis(croppedBlob);
    },
    [clearReview, runAnalysis],
  );

  const onRetake = useCallback(() => {
    clearReview();
    setPhase("capture");
  }, [clearReview]);

  const reset = useCallback(() => {
    setPhase("capture");
    setResult(null);
    setError(null);
    setStepIndex(0);
    setProgress(0);
    setPreview(null);
    clearReview();
  }, [setPreview, clearReview]);

  const showHero = phase === "capture" || phase === "review";

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
            {(phase === "results" || phase === "quality-blocked" || phase === "review" || phase === "analyzing") && (
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

        {phase === "review" && reviewSrc && (
          <CropReview
            imageSrc={reviewSrc}
            fileName={reviewFileName}
            onApprove={onApproveCrop}
            onRetake={onRetake}
          />
        )}

        {phase === "analyzing" && (
          <AnalyzingState stepIndex={stepIndex} previewUrl={previewUrl} progress={progress} />
        )}

        {phase === "results" && result && (
          <MatchResults
            result={result}
            previewUrl={previewUrl}
            onReset={reset}
          />
        )}

        {phase === "quality-blocked" && result && (
          <section className="animate-fade-up overflow-hidden rounded-[var(--radius-xl)] border border-warn/40 bg-bg-elevated">
            <div className="bg-warn/10 px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warn/20 text-warn">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M8 5.2V8.2M8 10.2H8.01M14 13.2L8.6 3.8C8.3 3.3 7.7 3.3 7.4 3.8L2 13.2C1.7 13.7 2 14.4 2.6 14.4H13.4C14 14.4 14.3 13.7 14 13.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-medium leading-tight">Photo quality too low for high-accuracy match</h2>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted text-pretty">
                    {(() => {
                      const q = result.quality as unknown as { sharpness?: number };
                      if (result.quality.faceCoverage < 0.03) return "Face is too small — move closer and fill the square.";
                      if ((q.sharpness ?? 60) < 42) return "Photo is blurry — hold steady and tap to focus.";
                      if (result.quality.score < 0.45) return "Low confidence — use front-facing, even lighting.";
                      return "Soft quality — a sharper, centered selfie gives the most accurate match.";
                    })()} High-accuracy mode requires crisp focus and 4%+ face coverage.
                  </p>
                </div>
              </div>
            </div>
            <div className="px-5 py-5 sm:px-6 space-y-3">
              <div className="flex gap-2">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-subtle">
                  {previewUrl && <img src={previewUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-subtle">Face coverage</span>
                    <span className="tabular-nums text-fg-muted">{(result.quality.faceCoverage * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                    <div className="h-full bg-warn transition-[width]" style={{ width: `${Math.min(100, result.quality.faceCoverage * 600)}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-subtle">Overall score</span>
                    <span className="tabular-nums text-fg-muted">{(result.quality.score * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                    <div className="h-full bg-warn transition-[width]" style={{ width: `${result.quality.score * 100}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-subtle">Sharpness</span>
                    <span className="tabular-nums text-fg-muted">{Math.round((result.quality as unknown as { sharpness: number }).sharpness ?? 0)}/100</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                    <div className="h-full bg-warn transition-[width]" style={{ width: `${Math.min(100, ((result.quality as unknown as { sharpness: number }).sharpness ?? 0) * 1.2)}%` }} />
                  </div>
                </div>
              </div>
              {result.quality.issues.length > 0 && (
                <ul className="space-y-1.5 rounded-[var(--radius-md)] bg-bg-subtle px-3 py-2.5">
                  {result.quality.issues.map((issue, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-snug text-fg-muted">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warn" />
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" size="md" onClick={reset} className="flex-1">
                  Retake photo
                </Button>
                <Button variant="primary" size="md" onClick={() => setPhase("results")} className="flex-1">
                  See low-confidence matches
                </Button>
              </div>
              <p className="text-center text-[11px] text-fg-subtle">Low-confidence matches may be inaccurate — use for fun only.</p>
            </div>
          </section>
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
