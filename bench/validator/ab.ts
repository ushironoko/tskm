import { safeParseCompiled } from "../../packages/tskm/src/compile.ts"
import { safeParse } from "../../packages/tskm/src/index.ts"
import { type BenchResult, bench } from "../lib/measure.ts"
import { createBenchmarkFixtures, runConformance } from "./conformance.ts"
import { gateRegressions, makeConsume } from "./sink.ts"

interface ABResult {
  readonly name: string
  readonly interpreted: BenchResult
  readonly compiled: BenchResult
  readonly ratio: number
}

function run(): void {
  const conformance = runConformance()
  console.log(`conformance: PASS casesChecked=${conformance.casesChecked}`)

  const results: ABResult[] = []
  for (const fixture of createBenchmarkFixtures()) {
    // One consume per fixture so its reads stay monomorphic to this fixture's output shape;
    // a single shared consume across all fixtures goes megamorphic on JSC and distorts the
    // ratio (see makeConsume). Both A/B halves of a fixture share the SAME instance, so the
    // comparison is fair.
    const consume = makeConsume()
    // This is a shared, loaded dev machine (±10-20% per-run noise). A single A/B can swing a
    // marginal case across 1.0x purely from a load spike landing on one half. So repeat the
    // A/B and take the MEDIAN ratio, which is stable run-to-run; the displayed ns/op is the
    // rep whose ratio is the median.
    const REPS = 5
    const reps: ABResult[] = []
    for (let r = 0; r < REPS; r++) {
      const opts = { warmupMs: 100, sampleCount: 20 }
      const interpreted = bench(
        `${fixture.name}:interpreter`,
        () => consume(safeParse(fixture.schema, fixture.input, fixture.config)),
        opts,
      )
      const compiled = bench(
        `${fixture.name}:compiled`,
        () => consume(safeParseCompiled(fixture.schema, fixture.input, fixture.config)),
        opts,
      )
      reps.push({
        name: fixture.name,
        interpreted,
        compiled,
        ratio: interpreted.nsPerOp / compiled.nsPerOp,
      })
    }
    reps.sort((a, b) => a.ratio - b.ratio)
    results.push(reps[Math.floor(REPS / 2)] as ABResult)
  }

  console.log("\n# validator A/B (Bun/JSC)\n")
  console.log(renderABTable(results))

  const gate = gateRegressions(
    results.map((result) => ({ name: result.name, ratio: result.ratio })),
  )
  console.log("\n# no-regression gate (full-materializing sink)\n")
  console.log(gate.lines.join("\n"))
  console.log(`\nGATE: ${gate.failed ? "FAIL" : "PASS"}`)
  if (gate.failed) {
    process.exitCode = 1
  }
}

function renderABTable(results: readonly ABResult[]): string {
  const rows = [
    [
      "fixture",
      "interp ns/op",
      "compiled ns/op",
      "ratio",
      "interp min/p50/p99",
      "compiled min/p50/p99",
    ],
    ...results.map((result) => [
      result.name,
      formatNs(result.interpreted.nsPerOp),
      formatNs(result.compiled.nsPerOp),
      `${result.ratio.toFixed(2)}x`,
      formatTriplet(result.interpreted),
      formatTriplet(result.compiled),
    ]),
  ]
  const header = rows[0] as string[]
  const widths = header.map((_, col) => Math.max(...rows.map((row) => (row[col] as string).length)))
  return rows
    .map((row, index) => {
      const line = row
        .map((cell, col) => (cell as string).padEnd(widths[col] as number))
        .join(" | ")
      if (index === 0) {
        return `${line}\n${widths.map((width) => "-".repeat(width)).join("-|-")}`
      }
      return line
    })
    .join("\n")
}

function formatTriplet(result: BenchResult): string {
  return `${formatNs(result.nsPerOpMin)}/${formatNs(result.nsPerOp)}/${formatNs(result.nsPerOpP99)}`
}

function formatNs(value: number): string {
  return value.toFixed(value >= 100 ? 1 : 2)
}

run()
