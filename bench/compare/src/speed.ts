import { spawnSync } from "node:child_process"
import { type LibraryName, measuredIterations, measuredRounds } from "./config.ts"

export interface Range {
  readonly median: number
  readonly min: number
  readonly max: number
}

export interface SpeedRow {
  readonly library: LibraryName
  readonly rounds: number
  readonly validOpsPerSec: Range
  readonly invalidOpsPerSec: Range
  readonly validNsPerOp: number
}

interface WorkerSample {
  readonly library: string
  readonly validNs: number
  readonly validAccepted: number
  readonly invalidNs: number
  readonly invalidAccepted: number
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const left = sorted[mid - 1] ?? 0
  const right = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? right : (left + right) / 2
}

function range(values: readonly number[]): Range {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: median(sorted), min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0 }
}

function runWorker(name: LibraryName): WorkerSample {
  const child = spawnSync(process.execPath, ["src/speed-worker.ts", name], {
    cwd: `${import.meta.dirname}/..`,
    encoding: "utf8",
  })
  if (child.status !== 0) {
    throw new Error(`${name} speed worker failed\n${child.stdout}\n${child.stderr}`)
  }
  const line = child.stdout.trim().split("\n").at(-1)
  if (!line) throw new Error(`${name} speed worker produced no output`)
  const sample = JSON.parse(line) as WorkerSample
  if (sample.validAccepted !== measuredIterations) {
    throw new Error(`${name}: ${sample.validAccepted}/${measuredIterations} valid parses accepted`)
  }
  if (sample.invalidAccepted !== 0) {
    throw new Error(`${name}: ${sample.invalidAccepted} invalid parses accepted`)
  }
  return sample
}

/**
 * Runs `measuredRounds` rounds. Each round starts a fresh process for every library, in the
 * same order. Interleaving means a slow period on a shared machine affects every library in
 * that round, instead of landing on whichever library was being measured at the time.
 */
export function measureSpeed(names: readonly LibraryName[]): SpeedRow[] {
  const samples = new Map<LibraryName, WorkerSample[]>(names.map((name) => [name, []]))
  for (let round = 1; round <= measuredRounds; round++) {
    for (const name of names) {
      samples.get(name)?.push(runWorker(name))
      console.log(`speed round ${round}/${measuredRounds} ${name}`)
    }
  }
  return names.map((name) => {
    const rows = samples.get(name) ?? []
    const validOps = rows.map((s) => (measuredIterations * 1e9) / s.validNs)
    const invalidOps = rows.map((s) => (measuredIterations * 1e9) / s.invalidNs)
    const validNsPerOp = rows.map((s) => s.validNs / measuredIterations)
    return {
      library: name,
      rounds: rows.length,
      validOpsPerSec: range(validOps),
      invalidOpsPerSec: range(invalidOps),
      validNsPerOp: median(validNsPerOp),
    }
  })
}
