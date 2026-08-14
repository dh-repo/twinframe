import { honestyBand, honestyShareLabel } from "./honesty";

export interface ShareImageInput {
  youUrl: string | null;
  celebrityName: string;
  celebrityPhotoUrl?: string | null;
  matchPercent: number;
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
  const dy = y + (h - dh) / 2;
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

/** Compose a 1080×1350 story card. Photos stay in-memory — caller decides to share/download. */
export async function composeShareImage(input: ShareImageInput): Promise<Blob> {
  const width = 1080;
  const height = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const band = honestyBand(input.matchPercent);
  const pct = Math.round(input.matchPercent);

  ctx.fillStyle = "#090a0f";
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, 280, 40, width / 2, 280, 520);
  glow.addColorStop(0, "rgba(125, 211, 160, 0.16)");
  glow.addColorStop(1, "rgba(9, 10, 15, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#f4f4f5";
  ctx.font = "700 36px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Twinframe", width / 2, 88);

  ctx.fillStyle = "#7dd3a0";
  ctx.font = "600 22px ui-monospace, SF Mono, monospace";
  ctx.fillText(honestyShareLabel(band).toUpperCase(), width / 2, 132);

  const cardW = 380;
  const cardH = 420;
  const gap = 48;
  const pairW = cardW * 2 + gap;
  const left = (width - pairW) / 2;
  const top = 200;

  const you = input.youUrl
    ? await loadImage(input.youUrl).catch(() => null)
    : null;
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
  ctx.fillText("YOU", left + 32, top + cardH - 30);

  ctx.fillStyle = "rgba(9,10,15,0.72)";
  roundRect(ctx, left + cardW + gap + cardW - 150, top + cardH - 52, 134, 32, 8);
  ctx.fill();
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "600 18px system-ui, sans-serif";
  ctx.textAlign = "right";
  const short = input.celebrityName.split(" ")[0] ?? input.celebrityName;
  ctx.fillText(short.toUpperCase(), left + cardW + gap + cardW - 24, top + cardH - 30);

  ctx.fillStyle = "#7dd3a0";
  ctx.beginPath();
  ctx.arc(width / 2, top + cardH / 2, 28, 0, Math.PI * 2);
  ctx.fillStyle = "#121214";
  ctx.fill();
  ctx.strokeStyle = "rgba(125, 211, 160, 0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#7dd3a0";
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("≈", width / 2, top + cardH / 2);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#f4f4f5";
  ctx.font = "700 56px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(input.celebrityName, width / 2, 760);

  ctx.fillStyle = "#7dd3a0";
  ctx.font = "800 120px system-ui, sans-serif";
  ctx.fillText(`${pct}%`, width / 2, 900);

  ctx.fillStyle = "#71717a";
  ctx.font = "600 22px ui-monospace, SF Mono, monospace";
  ctx.fillText("FACE SIMILARITY", width / 2, 948);

  ctx.fillStyle = "#52525b";
  ctx.font = "500 22px system-ui, sans-serif";
  ctx.fillText("On-device · Your photo never left this device", width / 2, 1260);

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
