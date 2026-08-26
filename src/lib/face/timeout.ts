/**
 * A stage that took longer than its own budget to settle. Distinguishing this
 * from a generic failure lets callers surface a specific, actionable message
 * instead of silently waiting out the outer analysis timeout.
 */
export class StageTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`${stage} timed out after ${timeoutMs}ms`);
    this.name = "StageTimeoutError";
  }
}

/**
 * Races a promise against a per-stage deadline. A slow model fetch or a
 * hung inference call should fail fast and specifically, not silently
 * consume the whole outer analysis timeout while the UI looks frozen.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StageTimeoutError(stage, timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
