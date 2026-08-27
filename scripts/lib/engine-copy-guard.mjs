/** Banned retired-engine names in product copy. Keep in sync with src/lib/ux/engine-copy.ts */
export const BANNED_ENGINE_COPY = /\b(EdgeFace|Anti-GAN|Biohash)\b/i;
export const REQUIRED_LANDING_ENGINE = /AdaFace/;

export function bannedEngineLines(text) {
  return [...text.matchAll(/[^\n]*(EdgeFace|Anti-GAN|Biohash)[^\n]*/gi)].map((m) => m[0].trim());
}

export function engineCopyFailures(label, text, { requireAdaFace = false } = {}) {
  const failures = [];
  const hits = bannedEngineLines(text);
  if (hits.length) {
    failures.push(`${label} names a retired engine: ${hits.slice(0, 4).join(" | ")}`);
  }
  if (requireAdaFace && !REQUIRED_LANDING_ENGINE.test(text)) {
    failures.push(`${label} does not name AdaFace`);
  }
  return failures;
}
