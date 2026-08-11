import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

export interface FaceScanningHudProps {
  previewUrl?: string | null;
  stepIndex?: number;
  className?: string;
}

const TELEMETRY_MESSAGES = [
  "ALIGNING LANDMARKS 68/68",
  "COMPUTING AFFINE MATRIX",
  "EXTRACTING 128-D EMBEDDINGS",
  "MATCHING GALAXIES & CELEBRITIES",
];

// Normalized facial landmark coordinate nodes (percentage offsets for face alignment)
const LANDMARK_NODES = [
  // Left Eyebrow & Eye
  { top: "34%", left: "32%" },
  { top: "33%", left: "38%" },
  { top: "34%", left: "44%" },
  { top: "39%", left: "35%" },
  { top: "39%", left: "41%" },
  // Right Eyebrow & Eye
  { top: "34%", left: "56%" },
  { top: "33%", left: "62%" },
  { top: "34%", left: "68%" },
  { top: "39%", left: "59%" },
  { top: "39%", left: "65%" },
  // Nose Bridge & Tip
  { top: "43%", left: "50%" },
  { top: "49%", left: "50%" },
  { top: "54%", left: "47%" },
  { top: "54%", left: "50%" },
  { top: "54%", left: "53%" },
  // Mouth & Lips
  { top: "66%", left: "38%" },
  { top: "64%", left: "44%" },
  { top: "64%", left: "50%" },
  { top: "64%", left: "56%" },
  { top: "66%", left: "62%" },
  { top: "70%", left: "50%" },
  // Jawline Contour
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

export function FaceScanningHud({
  previewUrl,
  stepIndex = 0,
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

  const currentTelemetry = TELEMETRY_MESSAGES[stepIndex % TELEMETRY_MESSAGES.length] || TELEMETRY_MESSAGES[telemetryIndex];

  return (
    <div
      className={cn(
        "relative aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border border-match/40 bg-bg-subtle/90 shadow-[0_0_30px_color-mix(in_oklab,var(--color-match)_20%,transparent)] backdrop-blur-sm select-none",
        className
      )}
    >
      {/* User Photo Preview Background */}
      {previewUrl ? (
        <img
          src={previewUrl}
          alt="User face scan"
          className="h-full w-full object-cover object-top filter contrast-[1.08] brightness-[0.95]"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-bg-subtle to-bg p-4 text-center">
          <div className="h-20 w-20 rounded-full border border-dashed border-match/40 animate-pulse-soft" />
        </div>
      )}

      {/* Cybernetic Radial Vignette & Grid */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(10,10,11,0.85)_100%)] z-0" />

      {/* 4 Corner Tech Reticle L-Brackets */}
      <div className="pointer-events-none absolute inset-0 z-20 p-2.5">
        {/* Top-Left */}
        <div className="absolute top-2.5 left-2.5 h-5 w-5 border-t-2 border-l-2 border-match rounded-tl-sm shadow-[0_0_8px_var(--color-match)] animate-reticle-pulse" />
        {/* Top-Right */}
        <div className="absolute top-2.5 right-2.5 h-5 w-5 border-t-2 border-r-2 border-match rounded-tr-sm shadow-[0_0_8px_var(--color-match)] animate-reticle-pulse" />
        {/* Bottom-Left */}
        <div className="absolute bottom-2.5 left-2.5 h-5 w-5 border-b-2 border-l-2 border-match rounded-bl-sm shadow-[0_0_8px_var(--color-match)] animate-reticle-pulse" />
        {/* Bottom-Right */}
        <div className="absolute bottom-2.5 right-2.5 h-5 w-5 border-b-2 border-r-2 border-match rounded-br-sm shadow-[0_0_8px_var(--color-match)] animate-reticle-pulse" />
      </div>

      {/* Sweeping Vertical Laser Line */}
      <div className="pointer-events-none absolute left-0 right-0 z-30 animate-scan-laser-sweep">
        <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-match to-transparent shadow-[0_0_12px_var(--color-match),0_0_2px_#fff]" />
        <div className="h-8 w-full bg-gradient-to-b from-match/25 to-transparent" />
      </div>

      {/* Landmark SVG Wireframe Lines */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full z-10 opacity-60" viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* Eye-Nose-Mouth Grid Overlay */}
        <polygon points="35,39 41,39 50,49 50,54 44,64 38,66" fill="none" stroke="currentColor" strokeWidth="0.4" className="text-match" />
        <polygon points="65,39 59,39 50,49 50,54 56,64 62,66" fill="none" stroke="currentColor" strokeWidth="0.4" className="text-match" />
        <path d="M 20,38 Q 34,78 50,78 Q 66,78 80,38" fill="none" stroke="currentColor" strokeWidth="0.4" strokeDasharray="1,1" className="text-match/70" />
      </svg>

      {/* Simulated Landmark Node Points */}
      <div className="pointer-events-none absolute inset-0 z-15">
        {LANDMARK_NODES.map((node, i) => (
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
          <span>FACE_SCAN::ACTIVE</span>
        </div>
      </div>

      {/* Cybernetic Telemetry Footer Bar */}
      <div className="pointer-events-none absolute bottom-2.5 left-2.5 right-2.5 z-30 flex items-center justify-between rounded-md border border-match/30 bg-bg/85 px-2.5 py-1 text-[10px] font-mono text-match backdrop-blur-md shadow-sm">
        <span className="truncate tracking-tight animate-telemetry-fade">{currentTelemetry}</span>
        <span className="shrink-0 font-semibold opacity-80">{tickerTick}</span>
      </div>
    </div>
  );
}
