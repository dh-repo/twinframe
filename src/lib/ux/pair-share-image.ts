import { verdictLabel, type VerdictTier } from "../face/verdict.ts";
import {
  closerTwin,
  closerTwinStamp,
  type CloserTwinWinner,
} from "./closer-twin.ts";
import { resolveShareVerdict } from "./share-copy.ts";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  verdictStampStyle,
  type VerdictStampStyle,
} from "./share-image.ts";

export const PAIR_SHARE_WIDTH = SHARE_CARD_WIDTH;
export const PAIR_SHARE_HEIGHT = SHARE_CARD_HEIGHT;

export interface PairShareSide {
  label: string;
  youUrl: string | null;
  celebrityName: string;
  celebrityPhotoUrl?: string | null;
  matchPercent: number;
  verdict?: VerdictTier;
  adjustedDistance?: number;
  rankMargin?: number;
  blurb?: string;
}

export interface PairShareInput {
  you: PairShareSide;
  friend: PairShareSide;
}

export function pairShareFilename(): string {
  return "twinframe-closer-twin.png";
}

export function pairShareText(input: {
  winner: CloserTwinWinner;
  aName: string;
  bName: string;
  aPercent: number;
  bPercent: number;
  aVerdict?: VerdictTier;
  bVerdict?: VerdictTier;
}): string {
  const aPct = Math.round(input.aPercent);
  const bPct = Math.round(input.bPercent);
  switch (input.winner) {
    case "a":
      if (input.bVerdict === "distant-twin") {
        return `Closer twin: I won on Twinframe — ${input.aName} ${aPct}%. My friend was a Distant Twin at ${bPct}%.`;
      }
      return `Closer twin: I beat my friend on Twinframe — ${input.aName} ${aPct}% vs ${input.bName} ${bPct}%.`;
    case "b":
      if (input.aVerdict === "distant-twin") {
        return `Closer twin: my friend won on Twinframe — ${input.bName} ${bPct}%. I was a Distant Twin at ${aPct}%.`;
      }
      return `Closer twin: my friend won on Twinframe — ${input.bName} ${bPct}% vs my ${input.aName} ${aPct}%.`;
    case "tie":
      return `Tied twins on Twinframe — ${input.aName} ${aPct}% and ${input.bName} ${bPct}%.`;
    default: {
      const _exhaustive: never = input.winner;
      return _exhaustive;
    }
  }
}

/** Canvas / preview headline. Distant twins are not “beaten”. */
export function pairShareHeadline(input: {
  winner: CloserTwinWinner;
  aName: string;
  bName: string;
  aVerdict: VerdictTier;
  bVerdict: VerdictTier;
}): string {
  switch (input.winner) {
    case "tie":
      return `${input.aName} & ${input.bName}`;
    case "a":
      return input.bVerdict === "distant-twin"
        ? `Closer twin: ${input.aName}`
        : `${input.aName} beats ${input.bName}`;
    case "b":
      return input.aVerdict === "distant-twin"
        ? `Closer twin: ${input.bName}`
        : `${input.bName} beats ${input.aName}`;
    default: {
      const _exhaustive: never = input.winner;
      return _exhaustive;
    }
  }
}

export function pairShareWinner(input: PairShareInput): CloserTwinWinner {
  return closerTwin(
    {
      adjustedDistance: input.you.adjustedDistance,
      matchPercent: input.you.matchPercent,
    },
    {
      adjustedDistance: input.friend.adjustedDistance,
      matchPercent: input.friend.matchPercent,
    },
  );
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
  ctx.arcTo(x + w, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

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
  roundRect(ctx, x, y, w, h, 28);
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
  roundRect(ctx, x, y, w, h, 28);
  ctx.fillStyle = "#1a1a1e";
  ctx.fill();
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "600 22px system-ui, sans-serif";
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

function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
) {
  ctx.save();
  ctx.fillStyle = "rgba(9,10,15,0.72)";
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fitOneLine(ctx, text, w - 12), x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function drawWinnerStamp(
  ctx: CanvasRenderingContext2D,
  label: string,
  cx: number,
  cy: number,
  style: VerdictStampStyle,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-6 * Math.PI) / 180);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = label.length > 18 ? 44 : 52;
  ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
  const metrics = ctx.measureText(label);
  const padX = 32;
  const padY = 18;
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

async function drawFaceCard(
  ctx: CanvasRenderingContext2D,
  src: string | null | undefined,
  fallback: string,
  x: number,
  y: number,
  w: number,
  h: number,
  chip: string,
  highlight: boolean,
  highlightColor: string,
) {
  const img = src ? await loadImage(src).catch(() => null) : null;
  if (img) drawCover(ctx, img, x, y, w, h);
  else drawPlaceholder(ctx, x, y, w, h, fallback);

  ctx.save();
  ctx.strokeStyle = highlight ? highlightColor : "rgba(255,255,255,0.18)";
  ctx.lineWidth = highlight ? 6 : 2;
  roundRect(ctx, x, y, w, h, 28);
  ctx.stroke();
  ctx.restore();

  drawChip(ctx, x + 10, y + h - 42, Math.min(w - 20, 150), 28, chip);
}

/** 1080×1080 pair card: both faces, both celeb thumbs, closer-twin stamp. */
export async function composePairShareImage(input: PairShareInput): Promise<Blob> {
  const width = PAIR_SHARE_WIDTH;
  const height = PAIR_SHARE_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const winner = pairShareWinner(input);
  const youVerdict = resolveShareVerdict(input.you);
  const friendVerdict = resolveShareVerdict(input.friend);
  const winnerStyle = verdictStampStyle(
    winner === "b" ? friendVerdict : youVerdict,
  );

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#0e1017");
  grad.addColorStop(1, "#07080b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, 380, 40, width / 2, 380, 540);
  glow.addColorStop(0, winnerStyle.glow);
  glow.addColorStop(1, "rgba(7, 8, 11, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#f4f4f5";
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("TWINFRAME", width / 2, 72);

  ctx.fillStyle = "rgba(244,244,245,0.55)";
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.fillText("YOU  vs  FRIEND", width / 2, 112);

  const cardW = 210;
  const cardH = 210;
  const innerGap = 18;
  const pairW = cardW * 2 + innerGap;
  const pairGap = 52;
  const rowW = pairW * 2 + pairGap;
  const left = (width - rowW) / 2;
  const top = 150;
  const friendLeft = left + pairW + pairGap;

  const youWin = winner === "a";
  const friendWin = winner === "b";
  const youColor = verdictStampStyle(youVerdict).fill;
  const friendColor = verdictStampStyle(friendVerdict).fill;

  await drawFaceCard(
    ctx,
    input.you.youUrl,
    "You",
    left,
    top,
    cardW,
    cardH,
    "YOU",
    youWin,
    youColor,
  );
  await drawFaceCard(
    ctx,
    input.you.celebrityPhotoUrl,
    input.you.celebrityName,
    left + cardW + innerGap,
    top,
    cardW,
    cardH,
    (input.you.celebrityName.split(" ")[0] ?? input.you.celebrityName).toUpperCase(),
    youWin,
    youColor,
  );
  await drawFaceCard(
    ctx,
    input.friend.youUrl,
    "Friend",
    friendLeft,
    top,
    cardW,
    cardH,
    "FRIEND",
    friendWin,
    friendColor,
  );
  await drawFaceCard(
    ctx,
    input.friend.celebrityPhotoUrl,
    input.friend.celebrityName,
    friendLeft + cardW + innerGap,
    top,
    cardW,
    cardH,
    (input.friend.celebrityName.split(" ")[0] ?? input.friend.celebrityName).toUpperCase(),
    friendWin,
    friendColor,
  );

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = youColor;
  ctx.font = "800 72px system-ui, sans-serif";
  ctx.fillText(`${Math.round(input.you.matchPercent)}%`, left + pairW / 2, 440);

  ctx.fillStyle = friendColor;
  ctx.fillText(`${Math.round(input.friend.matchPercent)}%`, friendLeft + pairW / 2, 440);

  ctx.font = "700 22px system-ui, sans-serif";
  ctx.fillStyle = youColor;
  ctx.fillText(verdictLabel(youVerdict).toUpperCase(), left + pairW / 2, 478);
  ctx.fillStyle = friendColor;
  ctx.fillText(verdictLabel(friendVerdict).toUpperCase(), friendLeft + pairW / 2, 478);

  drawWinnerStamp(ctx, closerTwinStamp(winner).toUpperCase(), width / 2, 600, winnerStyle);

  const line = pairShareHeadline({
    winner,
    aName: input.you.celebrityName,
    bName: input.friend.celebrityName,
    aVerdict: youVerdict,
    bVerdict: friendVerdict,
  });

  ctx.fillStyle = "#f4f4f5";
  ctx.font = "700 36px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(fitOneLine(ctx, line, width - 120), width / 2, 820);

  ctx.fillStyle = "rgba(244, 244, 245, 0.62)";
  ctx.font = "500 24px system-ui, sans-serif";
  ctx.fillText(
    fitOneLine(
      ctx,
      `${input.you.celebrityName} ${Math.round(input.you.matchPercent)}%  ·  ${input.friend.celebrityName} ${Math.round(input.friend.matchPercent)}%`,
      width - 120,
    ),
    width / 2,
    870,
  );

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "500 20px ui-monospace, SF Mono, monospace";
  ctx.fillText("MATCHED WITH ON-DEVICE EDGEFACE 512-D BIOMETRICS", width / 2, 1024);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not compose pair share image"));
      },
      "image/png",
    );
  });
}
