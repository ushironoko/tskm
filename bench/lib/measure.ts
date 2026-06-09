/**
 * Zero-dependency micro-benchmark core. Uses `Bun.nanoseconds()` (monotonic, since
 * process start) so it carries no third-party measurement code, matching @tskm/core's
 * dependency-free ethos. The loop self-calibrates the inner repeat count so each timed
 * batch is long enough to dwarf the clock-read overhead, warms the JIT before measuring,
 * then reports order statistics (min / p50 / p99) instead of a single mean so a GC pause
 * in one batch cannot dominate the headline number.
 */

/** A volatile sink: writing every result here defeats dead-code elimination of `fn`. */
export const sink: { value: unknown } = { value: undefined }

export interface BenchResult {
  readonly name: string
  /** Throughput derived from the median sample. */
  readonly opsPerSec: number
  /** Median nanoseconds per `fn` call. */
  readonly nsPerOp: number
  readonly nsPerOpMin: number
  readonly nsPerOpP99: number
  /** Relative margin of error of the samples, as a percent (lower is more stable). */
  readonly rmePct: number
  readonly samples: number
  readonly innerIters: number
}

export interface BenchOptions {
  /** Milliseconds spent warming the JIT before any sample is kept (default 200). */
  readonly warmupMs?: number
  /** Number of timed batches kept for statistics (default 50). */
  readonly sampleCount?: number
  /** Target duration of one timed batch; the inner repeat count is grown to reach it (default 2ms). */
  readonly minBatchNs?: number
}

function now(): number {
  return Bun.nanoseconds()
}

/** Grows the inner repeat count until a single batch runs for at least `minBatchNs`. */
function calibrate(fn: () => unknown, minBatchNs: number): number {
  let iters = 1
  for (let attempt = 0; attempt < 40; attempt++) {
    const start = now()
    for (let i = 0; i < iters; i++) {
      sink.value = fn()
    }
    const elapsed = now() - start
    if (elapsed >= minBatchNs) {
      return iters
    }
    // Scale toward the target with a little headroom, never shrinking.
    const factor = elapsed > 0 ? Math.ceil((minBatchNs / elapsed) * 1.2) : 2
    iters = Math.max(iters + 1, iters * Math.max(2, factor))
  }
  return iters
}

function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) {
    return 0
  }
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx] as number
}

/**
 * Benchmarks one function. `fn` must RETURN a value (its result is parked in {@link sink})
 * so the optimizer cannot delete the work being measured.
 */
export function bench(name: string, fn: () => unknown, options: BenchOptions = {}): BenchResult {
  const warmupMs = options.warmupMs ?? 200
  const sampleCount = options.sampleCount ?? 50
  const minBatchNs = options.minBatchNs ?? 2_000_000

  const innerIters = calibrate(fn, minBatchNs)

  // Warmup: keep running full batches until the warmup budget is spent.
  const warmupDeadline = now() + warmupMs * 1_000_000
  while (now() < warmupDeadline) {
    for (let i = 0; i < innerIters; i++) {
      sink.value = fn()
    }
  }

  const perOp: number[] = []
  for (let s = 0; s < sampleCount; s++) {
    const start = now()
    for (let i = 0; i < innerIters; i++) {
      sink.value = fn()
    }
    const elapsed = now() - start
    perOp.push(elapsed / innerIters)
  }

  const sorted = [...perOp].sort((a, b) => a - b)
  const median = percentile(sorted, 50)
  const mean = perOp.reduce((a, b) => a + b, 0) / perOp.length
  const variance = perOp.reduce((a, b) => a + (b - mean) ** 2, 0) / perOp.length
  const stddev = Math.sqrt(variance)
  // 95% CI margin = 1.96 * stderr; stderr = stddev / sqrt(n).
  const marginOfError = 1.96 * (stddev / Math.sqrt(perOp.length))
  const rmePct = mean > 0 ? (marginOfError / mean) * 100 : 0

  return {
    name,
    opsPerSec: median > 0 ? 1_000_000_000 / median : 0,
    nsPerOp: median,
    nsPerOpMin: sorted[0] as number,
    nsPerOpP99: percentile(sorted, 99),
    rmePct,
    samples: sampleCount,
    innerIters,
  }
}

/** A named workload `bench` can run. */
export interface BenchCase {
  readonly name: string
  readonly fn: () => unknown
}

/** Runs a suite of cases and returns their results in declaration order. */
export function runSuite(cases: ReadonlyArray<BenchCase>, options?: BenchOptions): BenchResult[] {
  return cases.map((c) => bench(c.name, c.fn, options))
}
