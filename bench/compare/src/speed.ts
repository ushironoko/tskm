import { type LibraryName, measuredIterations, measuredRuns, warmupIterations } from "./config.ts"
import { invalidPayload, validPayload } from "./payload.ts"

export interface SpeedRow {
  readonly library: LibraryName
  readonly validOpsPerSec: number
  readonly invalidOpsPerSec: number
  readonly validNsPerOp: number
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const left = sorted[mid - 1]
  const right = sorted[mid]
  if (sorted.length % 2 === 1) return right ?? 0
  return ((left ?? 0) + (right ?? 0)) / 2
}

function timeLoop(parse: (input: unknown) => boolean, input: unknown, iterations: number): number {
  let accepted = 0
  const start = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) {
    if (parse(input)) accepted++
  }
  const elapsed = process.hrtime.bigint() - start
  if (accepted < 0) throw new Error("unreachable")
  return Number(elapsed)
}

export async function measureSpeed(name: LibraryName): Promise<SpeedRow> {
  const mod = await import(`./libs/${name}.ts`)
  const parse = mod.parse as (input: unknown) => boolean
  if (!parse(validPayload)) throw new Error(`${name} rejected the valid payload`)
  if (parse(invalidPayload)) throw new Error(`${name} accepted the invalid payload`)

  for (let i = 0; i < warmupIterations; i++) parse(validPayload)

  const validNs: number[] = []
  const invalidNs: number[] = []
  for (let run = 0; run < measuredRuns; run++) {
    validNs.push(timeLoop(parse, validPayload, measuredIterations))
    invalidNs.push(timeLoop(parse, invalidPayload, measuredIterations))
  }
  const validMedian = median(validNs)
  const invalidMedian = median(invalidNs)
  return {
    library: name,
    validOpsPerSec: Math.round((measuredIterations * 1e9) / validMedian),
    invalidOpsPerSec: Math.round((measuredIterations * 1e9) / invalidMedian),
    validNsPerOp: validMedian / measuredIterations,
  }
}
