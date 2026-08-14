import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import {
  transformNormalizedPointToHud,
  transformNormalizedBoxToHud,
} from "@/lib/face/hud-transform";
import type { FaceTelemetry } from "@/lib/face/types";

export interface FaceScanningHudProps {
  previewUrl?: string | null;
  croppedPreviewUrl?: string | null;
  normalizedBox?: { x: number; y: number; width: number; height: number } | null;
  normalizedLandmarks?: { x: number; y: number }[] | null;
  croppedLandmarks?: { x: number; y: number }[] | null;
  candidateBoxes?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    isPrimary: boolean;
  }> | null;
  imageWidth?: number;
  imageHeight?: number;
  stepIndex?: number;
  telemetry?: FaceTelemetry | null;
  className?: string;
}

const TELEMETRY_MESSAGES = [
  "SCRFD-2.5G FEATURE PYRAMID DETECT",
  "EXPNORM 3D UV WGSL FRONTALIZATION",
  "EXTRACTING 256-D EDGEFACE EMBEDDINGS",
  "512-BIT BIOHASH & POPCOUNT MATCHING",
];

// Fallback search nodes when model hasn't detected face yet
const FALLBACK_LANDMARK_NODES = [
  { top: "34%", left: "32%" },
  { top: "33%", left: "38%" },
  { top: "34%", left: "44%" },
  { top: "39%", left: "35%" },
  { top: "39%", left: "41%" },
  { top: "34%", left: "56%" },
  { top: "33%", left: "62%" },
  { top: "34%", left: "68%" },
  { top: "39%", left: "59%" },
  { top: "39%", left: "65%" },
  { top: "43%", left: "50%" },
  { top: "49%", left: "50%" },
  { top: "54%", left: "47%" },
  { top: "54%", left: "50%" },
  { top: "54%", left: "53%" },
  { top: "66%", left: "38%" },
  { top: "64%", left: "44%" },
  { top: "64%", left: "50%" },
  { top: "64%", left: "56%" },
  { top: "66%", left: "62%" },
  { top: "70%", left: "50%" },
  { top: "38%", left: "20%" },
  { top: "48%", left: "22%" },
  { top: "60%", left: "26%" },
  { top: "72%", left: "34%" },
  { top: "78%", left: "50%" },
  { top: "72%", left: "66%" },
  { top: "60%", left: "74%" },
  { top: "48%", left: "78%" },
  { top: "38%", left: "80%" },
];

function connectPoints(indices: number[], landmarks: { x: number; y: number }[], closed = false): string {
  const pts = indices.map((i) => landmarks[i]).filter((p): p is { x: number; y: number } => Boolean(p));
  if (pts.length < 2) return "";
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  return closed ? `${path} Z` : path;
}

export function FaceScanningHud({
  previewUrl,
  croppedPreviewUrl,
  normalizedBox,
  normalizedLandmarks,
  croppedLandmarks,
  candidateBoxes,
  imageWidth,
  imageHeight,
  stepIndex = 0,
  telemetry,
  className,
}: FaceScanningHudProps) {
  const [telemetryIndex, setTelemetryIndex] = useState(0);
  const [tickerTick, setTickerTick] = useState("0x4A2F");

  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetryIndex((prev) => (prev + 1) % TELEMETRY_MESSAGES.length);
      setTickerTick(`0x${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0")}`);
    }, 1400);

    return () => clearInterval(interval);
  }, []);

  const liveTelemetryMessages = telemetry
    ? [
        `CANVAS: ${telemetry.originalWidth}x${telemetry.originalHeight} -> ${telemetry.downscaledWidth}x${telemetry.downscaledHeight} (${telemetry.latencies.downscaleMs}ms)`,
        `SCRFD-2.5G: ${telemetry.latencies.scrfdPassMs ?? telemetry.latencies.ssdPassMs ?? 0}ms (${telemetry.faceCount} FACE${telemetry.faceCount === 1 ? "" : "s"}, ${Math.round(telemetry.primaryConfidence * 100)}% CONF)`,
        `FRONTAL: ${telemetry.latencies.frontalizationMs ?? 0}ms (${(telemetry.frontalizationMethod ?? "5pt-similarity").toUpperCase()}, YAW:${telemetry.estimatedYaw ?? 0}°)`,
        `EDGEFACE-M: ${telemetry.latencies.embeddingPassMs ?? telemetry.latencies.embeddingMs}ms (256-D FLOAT16)`,
        `BIOHASH: ${telemetry.latencies.biohashMs ?? 0}ms (512-BIT POPCOUNT XOR)`,
        `TOTAL LATENCY: ${telemetry.latencies.totalMs}ms`,
      ]
    : TELEMETRY_MESSAGES;

  const currentTelemetry =
    liveTelemetryMessages[stepIndex % liveTelemetryMessages.length] ||
    liveTelemetryMessages[telemetryIndex % liveTelemetryMessages.length];
  const isCroppedActive = Boolean(croppedPreviewUrl);
  const activeImage = croppedPreviewUrl || previewUrl;
  const rawLandmarks = isCroppedActive ? (croppedLandmarks || normalizedLandmarks) : normalizedLandmarks;

  const imgW = imageWidth ?? 100;
  const imgH = imageHeight ?? 100;

  // Apply object-cover percentage aspect ratio matrix transformation for uncropped preview
  const activeLandmarks = rawLandmarks
    ? isCroppedActive
      ? rawLandmarks
      : rawLandmarks.map((pt) => transformNormalizedPointToHud(pt, imgW, imgH, 100, 100))
    : null;

  const activeBox = normalizedBox && !isCroppedActive
    ? transformNormalizedBoxToHud(normalizedBox, imgW, imgH, 100, 100)
    : null;

  const activeCandidateBoxes = candidateBoxes && !isCroppedActive
    ? candidateBoxes
        .filter((c) => !c.isPrimary)
        .map((c) => transformNormalizedBoxToHud(c, imgW, imgH, 100, 100))
    : [];

  const hasLandmarks = activeLandmarks && activeLandmarks.length >= 60;

  return (
    <div
      className={cn(
        "relative aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border border-match/40 bg-bg-subtle/90 shadow-[0_0_30px_color-mix(in_oklab,var(--color-match)_20%,transparent)] backdrop-blur-sm select-none",
        className
      )}
    >
      {/* User Photo Preview Background */}
      {activeImage ? (
        <img
          src={activeImage}
          alt="User face scan"
          className="h-full w-full object-cover object-center filter contrast-[1.08] brightness-[0.95] transition-all duration-500"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-bg-subtle to-bg p-4 text-center">
          <div className="h-20 w-20 rounded-full border border-dashed border-match/40 animate-pulse-soft" />
        </div>
      )}

      {/* Cybernetic Radial Vignette & Grid */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(10,10,11,0.85)_100%)] z-0" />

      {/* Secondary Face Reticle Target Boxes for Group Photos */}
      {activeCandidateBoxes.map((cBox, idx) => (
        <div
          key={`candidate-${idx}`}
          className="pointer-events-none absolute z-18 border border-dashed border-match/50 bg-match/5 rounded-lg transition-all duration-300 ease-out shadow-[0_0_10px_color-mix(in_oklab,var(--color-match)_20%,transparent)]"
          style={{
            left: `${cBox.x}%`,
            top: `${cBox.y}%`,
            width: `${cBox.width}%`,
            height: `${cBox.height}%`,
          }}
        >
          <div className="absolute -top-4 left-0 rounded bg-bg-subtle/90 px-1 py-0.5 text-[8px] font-mono text-match/80 border border-match/30">
            FACE #{idx + 2}
          </div>
        </div>
      ))}

      {/* Dynamic Reticle Box around Primary Face (when full uncropped photo is shown) */}
      {activeBox ? (
        <div
          className="pointer-events-none absolute z-20 border border-match/70 shadow-[0_0_20px_color-mix(in_oklab,var(--color-match)_40%,transparent)] rounded-xl transition-all duration-500 ease-out"
          style={{
            left: `${activeBox.x}%`,
            top: `${activeBox.y}%`,
            width: `${activeBox.width}%`,
            height: `${activeBox.height}%`,
          }}
        >
          {/* Corner L-Brackets */}
          <div className="absolute -top-1 -left-1 h-3.5 w-3.5 border-t-2 border-l-2 border-match shadow-[0_0_8px_var(--color-match)]" />
          <div className="absolute -top-1 -right-1 h-3.5 w-3.5 border-t-2 border-r-2 border-match shadow-[0_0_8px_var(--color-match)]" />
          <div className="absolute -bottom-1 -left-1 h-3.5 w-3.5 border-b-2 border-l-2 border-match shadow-[0_0_8px_var(--color-match)]" />
          <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 border-b-2 border-r-2 border-match shadow-[0_0_8px_var(--color-match)]" />
        </div>
      ) : (
        /* Static 4 Corner Reticle Brackets when cropped or searching */
        <div className="pointer-events-none absolute inset-0 z-20 p-2.5">
          <div className="absolute top-2.5 left-2.5 h-5 w-5 border-t-2 border-l-2 border-match rounded-tl-sm shadow-[0_0_8px_var(--color-match)] animate-reticle-pulse" />
          <div className="absolute top-2.5 right-2.5 h-5 w-5 border-t-2 border-r-2 border-match rounded-tr-sm shadow-[0_0_8px_var(--color-match)] animate-reticle-pulse" />
          <div className="absolute bottom-2.5 left-2.5 h-5 w-5 border-b-2 border-l-2 border-match rounded-bl-sm shadow-[0_0_8px_var(--color-match)] animate-reticle-pulse" />
          <div className="absolute bottom-2.5 right-2.5 h-5 w-5 border-b-2 border-r-2 border-match rounded-br-sm shadow-[0_0_8px_var(--color-match)] animate-reticle-pulse" />
        </div>
      )}

      {/* Sweeping Vertical Laser Line */}
      <div className="pointer-events-none absolute left-0 right-0 z-30 animate-scan-laser-sweep">
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-match to-transparent shadow-[0_0_12px_var(--color-match),0_0_2px_#fff]" />
        <div className="h-8 w-full bg-gradient-to-b from-match/25 to-transparent" />
      </div>

      {/* Dynamic 68 Landmark SVG Wireframe Lines */}
      {hasLandmarks ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full z-10 opacity-80" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Jawline */}
          <path d={connectPoints([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], activeLandmarks!)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match/70" />
          {/* Eyebrows */}
          <path d={connectPoints([17,18,19,20,21], activeLandmarks!)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match" />
          <path d={connectPoints([22,23,24,25,26], activeLandmarks!)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match" />
          {/* Nose Bridge */}
          <path d={connectPoints([27,28,29,30], activeLandmarks!)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match" />
          <path d={connectPoints([31,32,33,34,35], activeLandmarks!)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match" />
          {/* Eyes */}
          <path d={connectPoints([36,37,38,39,40,41], activeLandmarks!, true)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match" />
          <path d={connectPoints([42,43,44,45,46,47], activeLandmarks!, true)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match" />
          {/* Outer & Inner Lips */}
          <path d={connectPoints([48,49,50,51,52,53,54,55,56,57,58,59], activeLandmarks!, true)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match" />
          <path d={connectPoints([60,61,62,63,64,65,66,67], activeLandmarks!, true)} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-match/70" />
        </svg>
      ) : (
        <svg className="pointer-events-none absolute inset-0 h-full w-full z-10 opacity-60" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="35,39 41,39 50,49 50,54 44,64 38,66" fill="none" stroke="currentColor" strokeWidth="0.4" className="text-match" />
          <polygon points="65,39 59,39 50,49 50,54 56,64 62,66" fill="none" stroke="currentColor" strokeWidth="0.4" className="text-match" />
          <path d="M 20,38 Q 34,78 50,78 Q 66,78 80,38" fill="none" stroke="currentColor" strokeWidth="0.4" strokeDasharray="1,1" className="text-match/70" />
        </svg>
      )}

      {/* Dynamic or Fallback Landmark Node Points */}
      <div className="pointer-events-none absolute inset-0 z-15">
        {hasLandmarks
          ? activeLandmarks!.map((pt, i) => (
              <div
                key={i}
                className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)] animate-pulse-soft transition-all duration-300"
                style={{
                  top: `${pt.y}%`,
                  left: `${pt.x}%`,
                  animationDelay: `${(i % 5) * 150}ms`,
                }}
              />
            ))
          : FALLBACK_LANDMARK_NODES.map((node, i) => (
              <div
                key={i}
                className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-match shadow-[0_0_6px_var(--color-match)] animate-pulse-soft"
                style={{
                  top: node.top,
                  left: node.left,
                  animationDelay: `${(i % 5) * 200}ms`,
                }}
              />
            ))}
      </div>

      {/* Top Status Header Badge */}
      <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-match/30 bg-bg/85 px-3 py-0.5 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-medium tracking-wider text-match">
          <span className="h-1.5 w-1.5 rounded-full bg-match animate-ping" />
          <span>
            {telemetry?.frontalizationMethod
              ? (telemetry.frontalizationMethod === "exp-norm-wgsl" ? "EXPNORM 3D UV" : "5PT SIMILARITY")
              : "FACE_SCAN::ACTIVE"}
          </span>
        </div>
      </div>

      {/* Cybernetic Telemetry Footer Bar */}
      <div className="pointer-events-none absolute bottom-2.5 left-2.5 right-2.5 z-30 flex items-center justify-between rounded-md border border-match/30 bg-bg/85 px-2.5 py-1 text-[10px] font-mono text-match backdrop-blur-md shadow-sm">
        <span className="truncate tracking-tight animate-telemetry-fade">{currentTelemetry}</span>
        <span className="shrink-0 font-semibold opacity-80">
          {telemetry ? `${telemetry.latencies.totalMs}ms` : tickerTick}
        </span>
      </div>
    </div>
  );
}
