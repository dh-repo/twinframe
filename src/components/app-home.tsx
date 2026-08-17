import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, ShieldCheck, Zap, ScanFace } from "lucide-react";
import { PhotoUploader } from "@/components/capture/photo-uploader";
import { WebcamCapture } from "@/components/capture/webcam-capture";
import { CropReview } from "@/components/capture/crop-review";
import { MatchResults } from "@/components/results/match-results";
import { AnalyzingState } from "@/components/analyzing-state";
import { StarGalleryModal } from "@/components/gallery/star-gallery-modal";
import { Button } from "@/components/ui/button";
import {
  analyzeFaceSource,
  loadImageFromBlob,
  prefetchModel,
} from "@/lib/face/pipeline";
import type { FaceQuality, FaceTelemetry, MatchResult } from "@/lib/face/types";
import { loadCelebrityEmbeddings } from "@/lib/face/embeddings";
import { playMatchChime } from "@/lib/utils/feedback";

type Phase = "capture" | "review" | "analyzing" | "results" | "error" | "quality-blocked";

export function AppHome() {
  const [phase, setPhase] = useState<Phase>("capture");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [gallerySize, setGallerySize] = useState(1000);
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

  const [detectedDetails, setDetectedDetails] = useState<{
    normalizedBox?: { x: number; y: number; width: number; height: number };
    normalizedLandmarks?: { x: number; y: number }[];
    croppedLandmarks?: { x: number; y: number }[];
    facePreviewUrl?: string;
    imageWidth?: number;
    imageHeight?: number;
    candidateBoxes?: Array<{ x: number; y: number; width: number; height: number; isPrimary: boolean }>;
    telemetry?: FaceTelemetry;
  } | null>(null);

  const runAnalysis = useCallback(
    async (
      blob: Blob,
      selectedBox?: { x: number; y: number; width: number; height: number },
    ) => {
      setError(null);
      setResult(null);
      setDetectedDetails(null);
      setPhase("analyzing");
      setStepIndex(0);
      setProgress(5);

      const url = URL.createObjectURL(blob);
      setPreview(url);

      // Smooth ticker keeps progress moving smoothly during async model/WASM tasks
      let currentProgress = 5;
      let cancelled = false;
      const ticker = window.setInterval(() => {
        if (cancelled) return;
        currentProgress = Math.min(88, currentProgress + 1);
        setProgress((prev) => Math.max(prev, currentProgress));
      }, 100);

      // First model load + CPU-only detection can exceed 25s even on desktops
      // without WebGPU/WebGL (software rendering, older laptops).
      const timeoutMs = window.matchMedia("(pointer: coarse)").matches ? 60000 : 45000;
      const timeoutId = window.setTimeout(() => {
        cancelled = true;
        setError("Analysis timed out. Please try a clearer front-facing photo on a stronger connection.");
        setPhase("error");
      }, timeoutMs);

      try {
        const img = await loadImageFromBlob(blob);
        if (cancelled) return;

        const matchResult = await analyzeFaceSource(img, {
          topK: 6,
          selectedBox,
          onProgress: (stepIdx, pct, details) => {
            if (cancelled) return;
            setStepIndex(stepIdx);
            if (details) {
              setDetectedDetails(details);
            }
            if (pct > currentProgress) {
              currentProgress = pct;
              setProgress(pct);
            }
          },
        });

        if (cancelled) return;

        clearInterval(ticker);
        // Step to 100% when finished
        setProgress(100);
        setStepIndex(3);
        setResult(matchResult);

        // --- High-accuracy quality gate ---
        const q = matchResult.quality as FaceQuality & { sharpness?: number; illumination?: number };
        const sharpness = q.sharpness ?? 60;
        const noFace =
          !matchResult.matches.length &&
          (!matchResult.quality.ok || matchResult.quality.faceCoverage <= 0);

        const isLowQuality =
          noFace ||
          !matchResult.matches.length ||
          !matchResult.quality.ok ||
          matchResult.quality.score < 0.45 ||
          matchResult.quality.faceCoverage < 0.035 ||
          sharpness < 42 ||
          matchResult.quality.issues.some(
            (i) =>
              i.includes("blurry") ||
              i.includes("Low face confidence") ||
              i.includes("Dim lighting") ||
              i.includes("No face") ||
              i.includes("too extreme") ||
              i.includes("No close look-alike"),
          );

        // Keep a short beat for polish before showing results
        await new Promise((r) => setTimeout(r, 260));
        if (cancelled) return;

        setProgress(100);
        setResult(matchResult);

        if (isLowQuality || !matchResult.matches.length) {
          setPhase("quality-blocked");
        } else {
          playMatchChime();
          setPhase("results");
        }
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof Error
            ? e.message
            : "Something went wrong analyzing your photo.";
        setError(msg);
        setPhase("error");
      } finally {
        clearInterval(ticker);
        clearTimeout(timeoutId);
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
      setCameraStream(null);
    },
    [setReview],
  );

  const onApproveCrop = useCallback(
    (
      croppedBlob: Blob,
      selectedBox?: { x: number; y: number; width: number; height: number },
    ) => {
      clearReview();
      void runAnalysis(croppedBlob, selectedBox);
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
    <div className="app-shell bg-[#090a0f] text-white">
      <div className="app-content mx-auto w-full max-w-xl px-4 pb-[max(4rem,calc(env(safe-area-inset-bottom)+2rem))] pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.35rem),var(--grok-banner-h,0px))] sm:px-6">
        <header className={showHero ? "mb-8 sm:mb-10" : "mb-5"}>
          <div className="mb-6 flex items-center justify-between gap-3 sm:mb-8">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white shadow-inner">
                <ScanFace className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <span className="text-base font-bold tracking-tight text-white">Twinframe</span>
            </div>
            {(phase === "results" || phase === "quality-blocked" || phase === "review" || phase === "analyzing") ? (
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-white/70 transition-colors hover:text-white"
              >
                New photo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setGalleryModalOpen(true)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 text-sm font-medium text-white/80 transition-all hover:bg-white/10 hover:text-white"
              >
                <span>Explore {gallerySize.toLocaleString()}+ Stars</span>
              </button>
            )}
          </div>

          {showHero && (
            <div className="text-center space-y-3.5 mb-8">
              <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                Find Your Celebrity Doppelgänger
              </h1>
              <p className="max-w-lg mx-auto text-sm sm:text-base leading-relaxed text-white/70">
                Upload a selfie or use your camera. Instant, on-device matching with EdgeFace-M 256-d & SCRFD-2.5G against{" "}
                <button
                  type="button"
                  onClick={() => setGalleryModalOpen(true)}
                  className="font-semibold text-white underline underline-offset-4 hover:text-indigo-300 transition-colors"
                >
                  {gallerySize.toLocaleString()}+ stars
                </button>.
              </p>

              {/* 3 Horizontal Pill Badges */}
              <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs sm:text-sm font-medium text-white/90 backdrop-blur-md shadow-sm">
                  <Brain className="h-4 w-4 text-indigo-300" />
                  On-device AI
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs sm:text-sm font-medium text-white/90 backdrop-blur-md shadow-sm">
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                  100% Private
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs sm:text-sm font-medium text-white/90 backdrop-blur-md shadow-sm">
                  <Zap className="h-4 w-4 text-amber-300" />
                  Instant Results
                </span>
              </div>
            </div>
          )}
        </header>

        {phase === "capture" && (
          <div className="animate-fade-up space-y-8">
            <PhotoUploader
              onFile={onFile}
              onCameraClick={(stream) => {
                setCameraStream(stream);
                setCameraOpen(true);
              }}
            />

            {/* Teaser Sample Match Preview Showcase */}
            <div className="flex flex-col items-center justify-center space-y-2.5 pt-2">
              <div className="flex items-center gap-2.5">
                <div className="h-20 w-20 sm:h-24 sm:w-24 overflow-hidden rounded-2xl border border-white/20 shadow-xl bg-neutral-900">
                  <img
                    src="/celebs/sample_user.jpg"
                    alt="User portrait sample"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="h-20 w-20 sm:h-24 sm:w-24 overflow-hidden rounded-2xl border border-white/20 shadow-xl bg-neutral-900">
                  <img
                    src="/celebs/leonardo-dicaprio.jpg"
                    alt="Leonardo DiCaprio sample match"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-[#161824]/90 px-4 py-1.5 text-xs font-bold text-white shadow-xl backdrop-blur-md">
                Match Found! 94% Similarity
              </div>

              {/* Star Preview Row */}
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setGalleryModalOpen(true)}
                  className="text-xs text-white/60 hover:text-white transition-colors"
                >
                  Browse our full index of 1,000+ Hollywood, Music & Sports Icons →
                </button>
              </div>
            </div>
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
          <AnalyzingState
            stepIndex={stepIndex}
            previewUrl={previewUrl}
            croppedPreviewUrl={detectedDetails?.facePreviewUrl}
            normalizedBox={detectedDetails?.normalizedBox}
            normalizedLandmarks={detectedDetails?.normalizedLandmarks}
            croppedLandmarks={detectedDetails?.croppedLandmarks}
            candidateBoxes={detectedDetails?.candidateBoxes}
            imageWidth={detectedDetails?.imageWidth}
            imageHeight={detectedDetails?.imageHeight}
            progress={progress}
            gallerySize={gallerySize}
            telemetry={detectedDetails?.telemetry}
          />
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
                  <h2 className="text-sm font-medium leading-tight text-white">
                    {result.matches.length === 0 &&
                    result.quality.issues.some((i) => i.includes("look-alike"))
                      ? "No close look-alike found"
                      : result.quality.issues.some((i) => i.includes("angle") || i.includes("extreme"))
                        ? "Photo angle not suitable"
                        : "Photo quality too low for high-accuracy match"}
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-white/70 text-pretty">
                    {(() => {
                      const q = result.quality as unknown as { sharpness?: number };
                      const firstIssue = result.quality.issues[0];
                      if (firstIssue) return firstIssue;
                      if (result.quality.faceCoverage < 0.03) return "Face is too small — move closer and fill the square.";
                      if ((q.sharpness ?? 60) < 42) return "Photo is blurry — hold steady and tap to focus.";
                      if (result.quality.score < 0.45) return "Low confidence — use front-facing, even lighting.";
                      return "Soft quality — a sharper, centered selfie gives the most accurate match.";
                    })()}
                  </p>
                </div>
              </div>
            </div>
            <div className="px-5 py-5 sm:px-6 space-y-3">
              <div className="flex gap-2">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-white/20 bg-black/40">
                  {previewUrl && <img src={previewUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">Face coverage</span>
                    <span className="tabular-nums text-white/80">{(result.quality.faceCoverage * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-warn transition-[width]" style={{ width: `${Math.min(100, result.quality.faceCoverage * 600)}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">Overall score</span>
                    <span className="tabular-nums text-white/80">{(result.quality.score * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-warn transition-[width]" style={{ width: `${result.quality.score * 100}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">Sharpness</span>
                    <span className="tabular-nums text-white/80">{Math.round((result.quality as unknown as { sharpness: number }).sharpness ?? 0)}/100</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-warn transition-[width]" style={{ width: `${Math.min(100, ((result.quality as unknown as { sharpness: number }).sharpness ?? 0) * 1.2)}%` }} />
                  </div>
                </div>
              </div>
              {result.quality.issues.length > 0 && (
                <ul className="space-y-1.5 rounded-[var(--radius-md)] bg-white/5 px-3 py-2.5">
                  {result.quality.issues.map((issue, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-snug text-white/80">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warn" />
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <Button variant="secondary" size="md" onClick={reset} className="w-full sm:flex-1">
                  Retake photo
                </Button>
                {result.matches.length > 0 ? (
                  <Button variant="primary" size="md" onClick={() => setPhase("results")} className="w-full sm:flex-1">
                    See low-confidence matches
                  </Button>
                ) : null}
              </div>
              {result.matches.length > 0 ? (
                <p className="text-center text-[11px] text-white/50">Low-confidence matches may be inaccurate — use for fun only.</p>
              ) : (
                <p className="text-center text-[11px] text-white/50">
                  Open-set look-alikes need a clear, front-facing photo — we won&apos;t force a weak match.
                </p>
              )}
            </div>
          </section>
        )}

        {phase === "error" && (
          <section className="animate-fade-up space-y-4 rounded-[var(--radius-xl)] border border-white/10 bg-white/5 p-6 text-center text-white">
            <h2 className="text-lg font-medium">Couldn't analyze that photo</h2>
            <p className="text-sm text-white/70 text-pretty">{error}</p>
            <Button variant="secondary" onClick={reset}>
              Try again
            </Button>
          </section>
        )}

        {showHero && (
          <footer className="mt-12 border-t border-white/10 pt-6 text-center text-xs text-white/50 space-y-2">
            <p>
              Twinframe. On-device processing. No images uploaded.{" "}
              <button
                type="button"
                onClick={() => setGalleryModalOpen(true)}
                className="underline underline-offset-4 text-white/80 hover:text-white transition-colors font-medium"
              >
                Explore Star Gallery ({gallerySize.toLocaleString()}+ stars)
              </button>
            </p>
          </footer>
        )}
      </div>

      <WebcamCapture
        open={cameraOpen}
        presetStream={cameraStream}
        onClose={() => {
          setCameraOpen(false);
          setCameraStream(null);
        }}
        onCapture={onCapture}
      />

      <StarGalleryModal
        open={galleryModalOpen}
        onClose={() => setGalleryModalOpen(false)}
      />
    </div>
  );
}
