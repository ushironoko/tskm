import { spawnSync } from "node:child_process"
import type { LibraryName } from "./config.ts"

export interface MemoryRow {
  readonly library: LibraryName | "baseline"
  /** JSC heap bytes after a forced GC, once the library is loaded. */
  readonly heapAfterLoad: number
  readonly liveObjectsAfterLoad: number
  /** Largest JSC heap size sampled during the parses (between collections). */
  readonly peakHeap: number
  /** JSC heap bytes after the parses and a forced GC. */
  readonly heapAfterWork: number
  readonly liveObjectsAfterWork: number
  /** VmHWM: peak resident set of the process. */
  readonly peakRss: number
}

export function measureMemory(name: LibraryName | "baseline"): MemoryRow {
  const child = spawnSync(process.execPath, ["src/memory-worker.ts", name], {
    cwd: `${import.meta.dirname}/..`,
    encoding: "utf8",
  })
  if (child.status !== 0) {
    throw new Error(`${name} memory worker failed\n${child.stdout}\n${child.stderr}`)
  }
  const line = child.stdout.trim().split("\n").at(-1)
  if (!line) throw new Error(`${name} memory worker produced no output`)
  return JSON.parse(line) as MemoryRow
}
