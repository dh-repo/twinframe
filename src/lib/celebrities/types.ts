import type { FaceFeatures } from "../face/types.ts";

export interface CelebrityProfile {
  id: string;
  name: string;
  knownFor: string;
  tags: string[];
  accentHue: number;
  features: FaceFeatures;
}

export function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z\s]/g, "").trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]!.slice(0, 2) || "?").toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
