import { createCanvas, Canvas } from "canvas";
import { setAllowSyntheticDetection } from "./faceapi-engine.ts";

// Ensure Node.js test environment has window/document primitives for face-api pipeline
if (typeof window === "undefined" && typeof globalThis !== "undefined") {
  (globalThis as any).window = globalThis;
  if (!(globalThis as any).document) {
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "canvas") return createCanvas(320, 320);
        return {};
      },
    };
  }
}

// Unit/integration fixtures depend on synthetic skin-color detection when
// face-api nets are unloaded in Node. Production keeps this off by default.
setAllowSyntheticDetection(true);

/**
 * Helper to create a Canvas in both Node (via 'canvas') and browser environments.
 */
export function createTestCanvas(width: number, height: number): Canvas | HTMLCanvasElement {
  if (typeof document !== "undefined" && typeof (document as any).createElement === "function") {
    try {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      return c as any;
    } catch {
      /* fallback to createCanvas */
    }
  }
  return createCanvas(width, height);
}

/**
 * Generate a synthetic sunset landscape canvas (sky gradient, sun, mountain ridge).
 */
export function generateSunsetCanvas(w = 800, h = 800): Canvas | HTMLCanvasElement {
  const canvas = createTestCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) return canvas;

  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#ff512f");
  grad.addColorStop(0.5, "#f09819");
  grad.addColorStop(1, "#3a1c71");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Setting Sun
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.55, w * 0.12, 0, Math.PI * 2);
  ctx.fill();

  // Mountain ridge
  ctx.fillStyle = "#1a0826";
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.7);
  ctx.lineTo(w * 0.3, h * 0.55);
  ctx.lineTo(w * 0.6, h * 0.75);
  ctx.lineTo(w, h * 0.6);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

/**
 * Generate a dark or near-black frame canvas.
 */
export function generateDarkFrameCanvas(w = 800, h = 800, luma = 0.05): Canvas | HTMLCanvasElement {
  const canvas = createTestCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) return canvas;

  const val = Math.round(luma * 255);
  ctx.fillStyle = `rgb(${val},${val},${val})`;
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

/**
 * Generate an overexposed white frame canvas.
 */
export function generateOverexposedCanvas(w = 800, h = 800, luma = 0.95): Canvas | HTMLCanvasElement {
  const canvas = createTestCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) return canvas;

  const val = Math.round(luma * 255);
  ctx.fillStyle = `rgb(${val},${val},${val})`;
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

/**
 * Generate random abstract noise / texture canvas.
 */
export function generateAbstractNoiseCanvas(w = 800, h = 800): Canvas | HTMLCanvasElement {
  const canvas = createTestCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) return canvas;

  const imgData = ctx.createImageData(w, h);
  for (let i = 0; i < w * h * 4; i += 4) {
    const v = (Math.sin(i * 0.01) + Math.cos(i * 0.03) + 2) * 60;
    imgData.data[i] = v;
    imgData.data[i + 1] = v * 0.8;
    imgData.data[i + 2] = v * 1.2;
    imgData.data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Generate a synthetic human face canvas with realistic facial feature geometry.
 */
export function generateSyntheticFaceCanvas(
  w = 800,
  h = 800,
  cx = w / 2,
  cy = h / 2,
  radius = Math.min(w, h) * 0.25,
  fillBackground = true,
): Canvas | HTMLCanvasElement {
  const canvas = createTestCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) return canvas;

  // Background (only when fillBackground is true)
  if (fillBackground) {
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, w, h);
  }

  // Face oval (skin tone)
  ctx.fillStyle = "#e0ac69";
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius * 0.75, radius, 0, 0, Math.PI * 2);
  ctx.fill();

  // Left & Right Eyes
  const eyeY = cy - radius * 0.25;
  const eyeOffset = radius * 0.35;
  const eyeR = radius * 0.12;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx - eyeOffset, eyeY, eyeR, 0, Math.PI * 2);
  ctx.arc(cx + eyeOffset, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2d3748";
  ctx.beginPath();
  ctx.arc(cx - eyeOffset, eyeY, eyeR * 0.5, 0, Math.PI * 2);
  ctx.arc(cx + eyeOffset, eyeY, eyeR * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // Eyebrows
  ctx.strokeStyle = "#4a5568";
  ctx.lineWidth = Math.max(2, radius * 0.04);
  ctx.beginPath();
  ctx.moveTo(cx - eyeOffset - eyeR, eyeY - eyeR * 1.2);
  ctx.lineTo(cx - eyeOffset + eyeR, eyeY - eyeR * 1.5);
  ctx.moveTo(cx + eyeOffset - eyeR, eyeY - eyeR * 1.5);
  ctx.lineTo(cx + eyeOffset + eyeR, eyeY - eyeR * 1.2);
  ctx.stroke();

  // Nose
  const noseY = cy + radius * 0.05;
  ctx.fillStyle = "#c68642";
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + eyeR);
  ctx.lineTo(cx - radius * 0.1, noseY);
  ctx.lineTo(cx + radius * 0.1, noseY);
  ctx.closePath();
  ctx.fill();

  // Mouth
  const mouthY = cy + radius * 0.45;
  ctx.fillStyle = "#b76e79";
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, radius * 0.28, radius * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

/**
 * Generate a multi-person group photo canvas with multiple synthetic faces.
 */
export function generateMultiFaceCanvas(
  w = 1200,
  h = 800,
  faces: Array<{ cx: number; cy: number; radius: number }> = [
    { cx: 300, cy: 400, radius: 140 },
    { cx: 600, cy: 380, radius: 160 },
    { cx: 900, cy: 420, radius: 130 },
  ],
): Canvas | HTMLCanvasElement {
  const canvas = createTestCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) return canvas;

  // Outdoor / background fill
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, w, h);

  for (const f of faces) {
    const faceCanvas = generateSyntheticFaceCanvas(w, h, f.cx, f.cy, f.radius, false);
    ctx.drawImage(faceCanvas as CanvasImageSource, 0, 0);
  }

  return canvas;
}
