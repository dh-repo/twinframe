export interface OneEuroConfig {
  /** Minimum cutoff frequency in Hz (default: 1.0) */
  minCutoff?: number;
  /** Speed coefficient (default: 0.007) */
  beta?: number;
  /** Derivative cutoff frequency in Hz (default: 1.0) */
  derCutoff?: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * 1D 1 Euro Filter scalar implementation (Casiez et al., CHI 2012).
 * Adaptive low-pass filter to eliminate low-speed jitter while minimizing high-speed lag.
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private derCutoff: number;

  private prevValue = 0;
  private prevDer = 0;
  private prevTimestamp = -1;
  private initialized = false;

  constructor(config: OneEuroConfig = {}) {
    this.minCutoff = config.minCutoff ?? 1.0;
    this.beta = config.beta ?? 0.007;
    this.derCutoff = config.derCutoff ?? 1.0;
  }

  public filter(value: number, timestampSec: number): number {
    if (!Number.isFinite(value)) return this.prevValue;

    if (!this.initialized || this.prevTimestamp < 0) {
      this.prevValue = value;
      this.prevDer = 0;
      this.prevTimestamp = timestampSec;
      this.initialized = true;
      return value;
    }

    const dt = timestampSec - this.prevTimestamp;
    if (dt <= 0) return this.prevValue;
    if (dt > 1.0) {
      this.reset();
      return this.filter(value, timestampSec);
    }

    // 1. Unfiltered derivative
    const dxRaw = (value - this.prevValue) / dt;

    // 2. Filtered derivative
    const alphaDer = this.computeAlpha(this.derCutoff, dt);
    const dxFiltered = alphaDer * dxRaw + (1 - alphaDer) * this.prevDer;

    // 3. Adaptive cutoff frequency
    const cutoff = this.minCutoff + this.beta * Math.abs(dxFiltered);

    // 4. Filtered signal output
    const alpha = this.computeAlpha(cutoff, dt);
    const filteredValue = alpha * value + (1 - alpha) * this.prevValue;

    // 5. Update state
    this.prevValue = filteredValue;
    this.prevDer = dxFiltered;
    this.prevTimestamp = timestampSec;

    return filteredValue;
  }

  public reset(): void {
    this.initialized = false;
    this.prevTimestamp = -1;
    this.prevValue = 0;
    this.prevDer = 0;
  }

  private computeAlpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }
}

/**
 * Multi-dimensional 2D/3D Landmark Smoother.
 */
export class LandmarkSmoother {
  private filters: OneEuroFilter[] = [];
  private config: OneEuroConfig;

  constructor(config: OneEuroConfig = {}) {
    this.config = {
      minCutoff: config.minCutoff ?? 1.0,
      beta: config.beta ?? 0.007,
      derCutoff: config.derCutoff ?? 1.0,
    };
  }

  public filterPoints2D(points: Point2D[], timestampSec: number): Point2D[] {
    const requiredFilters = points.length * 2;
    this.ensureFilterCount(requiredFilters);

    return points.map((pt, i) => ({
      x: this.filters[i * 2]!.filter(pt.x, timestampSec),
      y: this.filters[i * 2 + 1]!.filter(pt.y, timestampSec),
    }));
  }

  public filterPoints3D(points: Point3D[], timestampSec: number): Point3D[] {
    const requiredFilters = points.length * 3;
    this.ensureFilterCount(requiredFilters);

    return points.map((pt, i) => ({
      x: this.filters[i * 3]!.filter(pt.x, timestampSec),
      y: this.filters[i * 3 + 1]!.filter(pt.y, timestampSec),
      z: this.filters[i * 3 + 2]!.filter(pt.z, timestampSec),
    }));
  }

  public filterFlat(landmarks: Float32Array, timestampSec: number): Float32Array {
    this.ensureFilterCount(landmarks.length);
    const result = new Float32Array(landmarks.length);
    for (let i = 0; i < landmarks.length; i++) {
      result[i] = this.filters[i]!.filter(landmarks[i]!, timestampSec);
    }
    return result;
  }

  public reset(): void {
    for (const f of this.filters) {
      f.reset();
    }
  }

  private ensureFilterCount(count: number): void {
    while (this.filters.length < count) {
      this.filters.push(new OneEuroFilter(this.config));
    }
  }
}
