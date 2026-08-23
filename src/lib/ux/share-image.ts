import { verdictLabel, type VerdictTier } from "../face/verdict.ts";
import {
  resolveShareVerdict,
  shareCardBlurb,
  sharePairGlyph,
  sharePercentCaption,
} from "./share-copy.ts";

/** Square Instagram / meme card. Preview DOM is 1:1 to match. */
export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1080;

export interface ShareImageInput {
  youUrl: string | null;
  celebrityName: string;
  celebrityPhotoUrl?: string | null;
  matchPercent: number;
  verdict?: VerdictTier;
  blurb?: string;
  adjustedDistance?: number;
  rankMargin?: number;
}

export interface VerdictStampStyle {
  fill: string;
  wash: string;
  glow: string;
}

export function verdictStampStyle(tier: VerdictTier): VerdictStampStyle {
  switch (tier) {
    case "dead-ringer":
      return {
        fill: "#f5c14a",
        wash: "rgba(245, 193, 74, 0.16)",
        glow: "rgba(245, 193, 74, 0.30)",
      };
    case "strong-resemblance":
      return {
        fill: "#7dd3a0",
        wash: "rgba(125, 211, 160, 0.16)",
        glow: "rgba(125, 211, 160, 0.28)",
      };
    case "soft-match":
      return {
        fill: "#818cf8",
        wash: "rgba(129, 140, 248, 0.16)",
        glow: "rgba(129, 140, 248, 0.24)",
      };
    case "distant-twin":
      return {
        fill: "#a1a1aa",
        wash: "rgba(161, 161, 170, 0.14)",
        glow: "rgba(161, 161, 170, 0.18)",
      };
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Object-fit: cover, object-position: top — faces sit in the upper half of portraits. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 36);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 36);
  ctx.fillStyle = "#1a1a1e";
  ctx.fill();
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();
}

function fitOneLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ellipsis : `${text.slice(0, lo)}${ellipsis}`;
}

function drawVerdictStamp(
  ctx: CanvasRenderingContext2D,
  label: string,
  cx: number,
  cy: number,
  style: VerdictStampStyle,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-7 * Math.PI) / 180);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = label.length > 16 ? 52 : 64;
  ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
  const metrics = ctx.measureText(label);
  const padX = 36;
  const padY = 20;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = 24;
  ctx.fillStyle = style.wash;
  roundRect(ctx, -w / 2, -h / 2, w, h, 14);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = style.fill;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = style.fill;
  ctx.fillText(label, 0, 2);
  ctx.restore();
}

/** Compose a 1080×1080 meme card. Photos stay in-memory — caller decides to share/download. */
export async function composeShareImage(input: ShareImageInput): Promise<Blob> {
  const width = SHARE_CARD_WIDTH;
  const height = SHARE_CARD_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const verdict = resolveShareVerdict(input);
  const style = verdictStampStyle(verdict);
  const blurb = shareCardBlurb(input.blurb, verdict);
  const pct = Math.round(input.matchPercent);

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#0e1017");
  grad.addColorStop(1, "#07080b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, 360, 40, width / 2, 360, 520);
  glow.addColorStop(0, style.glow);
  glow.addColorStop(1, "rgba(7, 8, 11, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#f4f4f5";
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("TWINFRAME", width / 2, 78);

  const cardW = 400;
  const cardH = 400;
  const gap = 48;
  const pairW = cardW * 2 + gap;
  const left = (width - pairW) / 2;
  const top = 130;

  const you = input.youUrl ? await loadImage(input.youUrl).catch(() => null) : null;
  const celeb = input.celebrityPhotoUrl
    ? await loadImage(input.celebrityPhotoUrl).catch(() => null)
    : null;

  if (you) drawCover(ctx, you, left, top, cardW, cardH);
  else drawPlaceholder(ctx, left, top, cardW, cardH, "You");

  if (celeb) drawCover(ctx, celeb, left + cardW + gap, top, cardW, cardH);
  else drawPlaceholder(ctx, left + cardW + gap, top, cardW, cardH, input.celebrityName);

  ctx.fillStyle = "rgba(9,10,15,0.72)";
  roundRect(ctx, left + 16, top + cardH - 52, 86, 32, 8);
  ctx.fill();
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("YOU", left + 32, top + cardH - 30);

  ctx.fillStyle = "rgba(9,10,15,0.72)";
  roundRect(ctx, left + cardW + gap + cardW - 150, top + cardH - 52, 134, 32, 8);
  ctx.fill();
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.textAlign = "right";
  const short = input.celebrityName.split(" ")[0] ?? input.celebrityName;
  ctx.fillText(
    short.toUpperCase(),
    left + cardW + gap + cardW - 24,
    top + cardH - 30,
  );

  const glyph = sharePairGlyph(verdict);
  ctx.beginPath();
  ctx.arc(width / 2, top + cardH / 2, 40, 0, Math.PI * 2);
  ctx.fillStyle = "#090a0f";
  ctx.fill();
  ctx.strokeStyle = style.fill;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = style.fill;
  ctx.font = glyph.length > 1 ? "800 16px system-ui, sans-serif" : "700 32px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, width / 2, top + cardH / 2);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = style.fill;
  ctx.font = "800 168px system-ui, sans-serif";
  ctx.fillText(`${pct}%`, width / 2, 680);
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.fillStyle = "rgba(244, 244, 245, 0.55)";
  ctx.fillText(sharePercentCaption(verdict), width / 2, 718);

  drawVerdictStamp(ctx, verdictLabel(verdict).toUpperCase(), width / 2, 770, style);

  ctx.fillStyle = "rgba(244, 244, 245, 0.72)";
  ctx.font = "500 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(fitOneLine(ctx, blurb, width - 120), width / 2, 870);

  ctx.fillStyle = "#f4f4f5";
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.fillText(fitOneLine(ctx, input.celebrityName, width - 120), width / 2, 930);

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "500 20px ui-monospace, SF Mono, monospace";
  ctx.fillText("MATCHED WITH ON-DEVICE EDGEFACE 512-D BIOMETRICS", width / 2, 1024);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not compose share image"));
      },
      "image/png",
    );
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function shareOrDownload(opts: {
  blob: Blob;
  filename: string;
  title: string;
  text: string;
}): Promise<"shared" | "downloaded" | "copied"> {
  const file = new File([opts.blob], opts.filename, { type: opts.blob.type || "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
    clipboard?: Clipboard;
  };

  if (nav.share) {
    const data: ShareData = { title: opts.title, text: opts.text, files: [file] };
    const canFiles = typeof nav.canShare === "function" ? nav.canShare(data) : true;
    try {
      if (canFiles) {
        await nav.share(data);
        return "shared";
      }
      await nav.share({ title: opts.title, text: opts.text });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
    }
  }

  downloadBlob(opts.blob, opts.filename);
  return "downloaded";
}

export async function copyShareText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
