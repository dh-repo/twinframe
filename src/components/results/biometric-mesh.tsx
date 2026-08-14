import { cn } from "@/lib/utils/cn";
import { CANONICAL_FACE_3D } from "@/lib/face/pose";
import type { ExtendedAnatomicalFeatures } from "@/lib/face/types";
import type { RegionalOcclusionConfidence } from "@/lib/face/occlusion";

const MESH_PATHS: { name: string; idx: number[]; closed?: boolean; region: "eyes" | "jaw" | "mid" }[] = [
  { name: "jaw", idx: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], region: "jaw" },
  { name: "rbrow", idx: [17, 18, 19, 20, 21], region: "eyes" },
  { name: "lbrow", idx: [22, 23, 24, 25, 26], region: "eyes" },
  { name: "nose", idx: [27, 28, 29, 30], region: "mid" },
  { name: "nostrels", idx: [31, 32, 33, 34, 35], region: "mid" },
  { name: "reye", idx: [36, 37, 38, 39, 40, 41], closed: true, region: "eyes" },
  { name: "leye", idx: [42, 43, 44, 45, 46, 47], closed: true, region: "eyes" },
  { name: "mouth", idx: [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59], closed: true, region: "jaw" },
];

export function projectCanonicalMesh(): { x: number; y: number }[] {
  const xs = CANONICAL_FACE_3D.map((p) => p.x);
  const ys = CANONICAL_FACE_3D.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  return CANONICAL_FACE_3D.map((p) => ({
    x: ((p.x - minX) / sx) * 78 + 11,
    y: (1 - (p.y - minY) / sy) * 78 + 11,
  }));
}

function toPct(pts: Array<{ x: number; y: number }>): { x: number; y: number }[] {
  const maxX = Math.max(...pts.map((p) => p.x), 1);
  const maxY = Math.max(...pts.map((p) => p.y), 1);
  if (maxX <= 1.5 && maxY <= 1.5) {
    return pts.map((p) => ({ x: p.x * 100, y: p.y * 100 }));
  }
  if (maxX <= 100 && maxY <= 100) return pts.map((p) => ({ x: p.x, y: p.y }));
  return pts.map((p) => ({ x: (p.x / maxX) * 100, y: (p.y / maxY) * 100 }));
}

function pathD(pts: { x: number; y: number }[], idx: number[], closed?: boolean): string {
  const seq = idx.map((i) => pts[i]).filter((p): p is { x: number; y: number } => Boolean(p));
  if (seq.length < 2) return "";
  const d = seq.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  return closed ? `${d} Z` : d;
}

export function FaceMeshOverlay({
  landmarks,
  occlusion,
  className,
}: {
  landmarks?: Array<{ x: number; y: number }> | null;
  occlusion?: RegionalOcclusionConfidence | null;
  className?: string;
}) {
  const pts = landmarks && landmarks.length >= 68 ? toPct(landmarks) : projectCanonicalMesh();
  const eyeDim = (occlusion?.eyeConf ?? 1) < 0.55;
  const jawDim = (occlusion?.jawConf ?? 1) < 0.55;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
      aria-hidden
    >
      {MESH_PATHS.map((seg) => {
        const damped = (seg.region === "eyes" && eyeDim) || (seg.region === "jaw" && jawDim);
        return (
          <path
            key={seg.name}
            d={pathD(pts, seg.idx, seg.closed)}
            fill="none"
            stroke="var(--color-match, #5eead4)"
            strokeWidth={damped ? 0.45 : 0.7}
            strokeDasharray={damped ? "1.2 1.1" : undefined}
            opacity={damped ? 0.35 : 0.85}
          />
        );
      })}
      {pts.slice(0, 68).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={0.55} fill="var(--color-match, #5eead4)" opacity={0.9} />
      ))}
    </svg>
  );
}

export function AnatomicalInspectionCards({
  anatomical,
  celebrityName,
  occlusion,
}: {
  anatomical?: ExtendedAnatomicalFeatures | null;
  celebrityName?: string;
  occlusion?: RegionalOcclusionConfidence | null;
}) {
  if (!anatomical) return null;
  const u = anatomical.upperThirdRatio * 100;
  const m = anatomical.middleThirdRatio * 100;
  const l = anatomical.lowerThirdRatio * 100;
  const balanced = Math.max(u, m, l) - Math.min(u, m, l) < 8;
  const tilt = anatomical.canthalTiltAngleDeg;
  const gonial = anatomical.gonialJawlineAngleDeg;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <article className="rounded-lg border border-border bg-bg-subtle/60 px-3 py-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-fg-subtle">Facial thirds</p>
        <p className="mt-0.5 text-sm font-medium tabular-nums text-fg">
          {u.toFixed(0)}% · {m.toFixed(0)}% · {l.toFixed(0)}%
        </p>
        <p className="text-[11px] text-fg-muted">{balanced ? "Balanced proportion" : "Longer mid or lower third"}</p>
      </article>
      <article className="rounded-lg border border-border bg-bg-subtle/60 px-3 py-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-fg-subtle">Canthal tilt</p>
        <p className="mt-0.5 text-sm font-medium tabular-nums text-fg">
          {tilt >= 0 ? "+" : ""}
          {tilt.toFixed(1)}°
        </p>
        <p className="text-[11px] text-fg-muted">
          {occlusion && occlusion.eyeConf < 0.55
            ? "Occluded — down-weighted"
            : celebrityName
              ? `Matched with ${celebrityName}`
              : tilt >= 0
                ? "Upward slant"
                : "Neutral / downward"}
        </p>
      </article>
      <article className="rounded-lg border border-border bg-bg-subtle/60 px-3 py-2">
        <p className="text-[10px] font-mono uppercase tracking-wider text-fg-subtle">Gonial angle</p>
        <p className="mt-0.5 text-sm font-medium tabular-nums text-fg">{gonial.toFixed(1)}°</p>
        <p className="text-[11px] text-fg-muted">
          {occlusion && occlusion.jawConf < 0.55
            ? "Occluded — down-weighted"
            : gonial < 128
              ? "Defined jaw contour"
              : "Softer jaw contour"}
        </p>
      </article>
    </div>
  );
}
