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
import type { FaceTelemetry, MatchResult } from "@/lib/face/types";
import { loadCelebrityEmbeddings } from "@/lib/face/embeddings";
import { loadFaceApi } from "@/lib/face/faceapi-engine";

type Phase = "capture" | "review" | "analyzing" | "results" | "error" | "quality-blocked";

const EXAMPLE_FACES = [
  { src: "/celebs/sample_user.jpg", alt: "Sample portrait" },
  { src: "/celebs/leonardo-dicaprio.jpg", alt: "Leonardo DiCaprio" },
  { src: "/celebs/zendaya.jpg", alt: "Zendaya" },
  { src: "/celebs/rihanna.jpg", alt: "Rihanna" },
] as const;

export function AppHome() {
  const [phase, setPhase] = useState<Phase>("capture");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [gallerySize, setGallerySize] = useState(1000);
  const [modelsWarm, setModelsWarm] = useState(false);
  const previewRef = useRef<string | null>(null);
  // review state
  const [reviewSrc, setReviewSrc] = useState<string | null>(null);
  const [reviewFileName, setReviewFileName] = useState<string | undefined>(undefined);
  const reviewSrcRef = useRef<string | null>(null);

  useEffect(() => {
    prefetchModel();
    let cancelled = false;
    void Promise.all([
      loadCelebrityEmbeddings()
        .then((g) => {
          if (!cancelled) setGallerySize(new Set(g.map((c) => c.id)).size);
        })
        .catch(() => {}),
      loadFaceApi().catch(() => {}),
    ]).finally(() => {
      if (!cancelled) setModelsWarm(true);
    });
    return () => {
      cancelled = true;
    };
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

      // Safety timeout (45s) in case device WASM/WebGL stalls on initial model download
      const timeoutId = window.setTimeout(() => {
        cancelled = true;
        setError("Analysis timed out. Please try a clearer front-facing photo.");
        setPhase("error");
      }, 45000);

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

        // Keep a short beat for polish before showing results
        await new Promise((r) => setTimeout(r, 260));
        if (cancelled) return;

        setProgress(100);
        setResult(matchResult);

        // Only hard-block when we cannot analyze a usable face.
        // Soft quality (slight blur, small face advice) must NOT block results —
        // that path used to dump "photo quality too low" for empty match lists too.
        const q = matchResult.quality;
        const sharpness = q.sharpness ?? 60;
        const coverage = q.faceCoverage ?? 0;
        const noFace =
          coverage <= 0 ||
          q.issues.some(
            (i) =>
              i.includes("No face") ||
              i.includes("No valid human face") ||
              i.includes("No human face"),
          );
        const unusablePhoto =
          noFace ||
          coverage < 0.02 ||
          sharpness < 28 ||
          (q.score < 0.22 && !matchResult.matches.length);

        if (matchResult.matches.length > 0) {
          // Always show matches when the ranker returned any — weak matches use honest UI copy
          setPhase("results");
        } else if (unusablePhoto || noFace) {
          setPhase("quality-blocked");
        } else {
          // Face OK but gallery has no neighbor that passed the match gate
          setPhase("quality-blocked");
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

  const showHero = phase === "capture";
  const showNewPhoto =
    phase === "results" ||
    phase === "quality-blocked" ||
    phase === "review" ||
    phase === "analyzing";

  return (
    <div className="app-shell min-h-screen w-full overflow-x-hidden bg-[#090a0f] text-white">
      <div className="app-content mx-auto w-full max-w-xl px-4 pb-[max(4rem,calc(3rem+env(safe-area-inset-bottom)))] pt-[max(calc(1.25rem+var(--grok-banner-h,0px)),env(safe-area-inset-top))] sm:px-6">
        <header className={showHero ? "mb-8 sm:mb-10" : "mb-5"}>
          <div className="mb-6 flex items-center justify-between gap-3 sm:mb-8">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white shadow-inner">
                <ScanFace className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <span className="text-base font-bold tracking-tight text-white">Twinframe</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setGalleryModalOpen(true)}
                className="text-xs text-white/60 transition-colors hover:text-white"
              >
                Gallery
              </button>
              {showNewPhoto && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-white/60 transition-colors hover:text-white"
                >
                  New photo
                </button>
              )}
            </div>
          </div>

          {showHero && (
            <div className="text-center space-y-3.5 mb-8">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                Find Your Celebrity Doppelgänger
              </h1>
              <p className="max-w-lg mx-auto text-sm sm:text-base leading-relaxed text-white/70">
                Upload a selfie or use your camera. Instant, on-device matching with FaceNet against{" "}
                <span className="font-semibold text-white">{gallerySize.toLocaleString()}+ stars</span>.
              </p>

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

              {!modelsWarm && (
                <div className="flex justify-center pt-0.5">
                  <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-white/45">
                    Warming face model…
                  </span>
                </div>
              )}
            </div>
          )}
        </header>

        {phase === "capture" && (
          <div className="animate-fade-up space-y-8">
            <PhotoUploader
              onFile={onFile}
              onCameraClick={() => setCameraOpen(true)}
            />

            <div className="flex flex-col items-center justify-center space-y-3 pt-2">
              <p className="text-xs font-medium text-white/50">
                Example faces in the gallery
              </p>
              <div className="flex items-center gap-2 sm:gap-2.5">
                {EXAMPLE_FACES.map((face) => (
                  <div
                    key={face.src}
                    className="h-16 w-16 sm:h-20 sm:w-20 overflow-hidden rounded-2xl border border-white/20 shadow-xl bg-neutral-900"
                  >
                    <img
                      src={face.src}
                      alt={face.alt}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setGalleryModalOpen(true)}
                className="text-xs font-medium text-white/60 underline underline-offset-4 transition-colors hover:text-white"
              >
                Browse the set
              </button>
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
            {(() => {
              const q = result.quality;
              const sharpness = q.sharpness ?? 60;
              const coverage = q.faceCoverage ?? 0;
              const noFace =
                coverage <= 0 ||
                q.issues.some(
                  (i) =>
                    i.includes("No face") ||
                    i.includes("No valid human face") ||
                    i.includes("No human face"),
                );
              const hardQuality =
                coverage < 0.02 || sharpness < 28 || (q.score < 0.22 && noFace);
              // Empty matches with a usable face → gallery/match gate, not "bad photo"
              const noStrongMatch = !noFace && !hardQuality && result.matches.length === 0;

              const title = noFace
                ? "No face detected"
                : hardQuality
                  ? "Photo quality too low to match"
                  : "No strong doppelgänger found";
              const body = noFace
                ? "We couldn't find a clear face. Use a front-facing photo with your face visible."
                : hardQuality
                  ? coverage < 0.02
                    ? "Face is too small — move closer so your face fills more of the frame."
                    : sharpness < 28
                      ? "Photo is too blurry — hold steady, tap to focus, and use better light."
                      : "Low confidence capture — front-facing, even lighting works best."
                  : "Your photo analyzed fine, but nothing in the gallery was a close enough face match. Try another angle or lighting — or the set may not include a strong look-alike yet.";

              return (
                <>
                  <div className="bg-warn/10 px-5 py-4 sm:px-6">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warn/20 text-warn">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <path d="M8 5.2V8.2M8 10.2H8.01M14 13.2L8.6 3.8C8.3 3.3 7.7 3.3 7.4 3.8L2 13.2C1.7 13.7 2 14.4 2.6 14.4H13.4C14 14.4 14.3 13.7 14 13.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-sm font-medium leading-tight text-white">{title}</h2>
                        <p className="mt-1 text-xs leading-relaxed text-white/70 text-pretty">{body}</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-5 sm:px-6 space-y-3">
                    {!noStrongMatch && (
                      <div className="flex gap-2">
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-white/20 bg-black/40">
                          {previewUrl && <img src={previewUrl} alt="" className="h-full w-full object-cover" />}
                        </div>
                        <div className="flex-1 space-y-2.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-white/60">Face coverage</span>
                            <span className="tabular-nums text-white/80">{(coverage * 100).toFixed(1)}%</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div className="h-full bg-warn transition-[width]" style={{ width: `${Math.min(100, coverage * 600)}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-white/60">Sharpness</span>
                            <span className="tabular-nums text-white/80">{Math.round(sharpness)}/100</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div className="h-full bg-warn transition-[width]" style={{ width: `${Math.min(100, sharpness * 1.2)}%` }} />
                          </div>
                        </div>
                      </div>
                    )}
                    {noStrongMatch && previewUrl && (
                      <div className="h-20 w-20 overflow-hidden rounded-[var(--radius-md)] border border-white/20 bg-black/40">
                        <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                      </div>
                    )}
                    {!noStrongMatch && result.quality.issues.length > 0 && (
                      <ul className="space-y-1.5 rounded-[var(--radius-md)] bg-white/5 px-3 py-2.5">
                        {result.quality.issues.map((issue, i) => (
                          <li key={i} className="flex gap-2 text-xs leading-snug text-white/80">
                            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warn" />
                            {issue}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button variant="primary" size="md" onClick={reset} className="w-full">
                        {noStrongMatch ? "Try another photo" : "Retake photo"}
                      </Button>
                    </div>
                  </div>
                </>
              );
            })()}
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
        onClose={() => setCameraOpen(false)}
        onCapture={onCapture}
      />

      <StarGalleryModal
        open={galleryModalOpen}
        onClose={() => setGalleryModalOpen(false)}
      />
    </div>
  );
}
