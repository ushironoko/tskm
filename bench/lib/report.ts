/**
 * Result persistence and comparison. A run writes its {@link BenchResult}s to a JSON
 * baseline; a later run loads that baseline and renders a delta table so an optimization
 * is judged against a committed number rather than a remembered one. The markdown table is
 * grep-friendly and small enough to paste into a review.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { BenchResult } from "./measure.ts"

export interface Baseline {
  /** Free-form label, e.g. "validator" or "compiler". */
  readonly suite: string
  readonly results: ReadonlyArray<BenchResult>
}

export function writeBaseline(path: string, baseline: Baseline): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`)
}

export function readBaseline(path: string): Baseline | null {
  if (!existsSync(path)) {
    return null
  }
  return JSON.parse(readFileSync(path, "utf8")) as Baseline
}

function fmtNs(ns: number): string {
  if (ns >= 1000) {
    return `${(ns / 1000).toFixed(2)}us`
  }
  return `${ns.toFixed(1)}ns`
}

function fmtOps(ops: number): string {
  if (ops >= 1_000_000) {
    return `${(ops / 1_000_000).toFixed(2)}M/s`
  }
  if (ops >= 1000) {
    return `${(ops / 1000).toFixed(1)}k/s`
  }
  return `${ops.toFixed(0)}/s`
}

/** A single-run table: name, throughput, ns/op, stability. */
export function renderTable(results: ReadonlyArray<BenchResult>): string {
  const rows = results.map(
    (r) =>
      `| ${r.name} | ${fmtOps(r.opsPerSec)} | ${fmtNs(r.nsPerOp)} | ${fmtNs(r.nsPerOpMin)} | ±${r.rmePct.toFixed(1)}% |`,
  )
  return [
    "| case | ops/sec | ns/op (p50) | ns/op (min) | rme |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

/**
 * A delta table comparing `current` against `baseline`. The speedup is baseline p50 over
 * current p50, so a value above 1.00x is a real improvement. Cases absent from the baseline
 * render as "new".
 */
export function renderComparison(
  baseline: Baseline | null,
  current: ReadonlyArray<BenchResult>,
): string {
  const baseByName = new Map((baseline?.results ?? []).map((r) => [r.name, r]))
  const rows = current.map((r) => {
    const base = baseByName.get(r.name)
    if (!base) {
      return `| ${r.name} | ${fmtOps(r.opsPerSec)} | ${fmtNs(r.nsPerOp)} | new |`
    }
    const speedup = r.nsPerOp > 0 ? base.nsPerOp / r.nsPerOp : 0
    const marker = speedup >= 1.05 ? " ✅" : speedup <= 0.95 ? " ⚠️" : ""
    return `| ${r.name} | ${fmtOps(r.opsPerSec)} | ${fmtNs(r.nsPerOp)} | ${speedup.toFixed(2)}x${marker} |`
  })
  return [
    "| case | ops/sec | ns/op (p50) | vs baseline |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}
