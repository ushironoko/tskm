/**
 * Validator benchmark entry. Runs the workload suite and prints a table; with `--baseline`
 * it also compares against a committed JSON and with `--write <path>` it records a new one.
 *
 *   bun bench/validator/bench.ts                       run all, print table
 *   bun bench/validator/bench.ts --filter object       run only matching cases
 *   bun bench/validator/bench.ts --baseline <path>     compare to a baseline
 *   bun bench/validator/bench.ts --write <path>        write results as the new baseline
 */

import { type BenchResult, bench } from "../lib/measure.ts"
import { readBaseline, renderComparison, renderTable, writeBaseline } from "../lib/report.ts"
import { selectWorkloads } from "./workloads.ts"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function run(): void {
  const filter = arg("--filter") ?? ""
  const cases = selectWorkloads(filter)
  if (cases.length === 0) {
    console.error(`no workloads match "${filter}"`)
    process.exit(1)
  }

  const results: BenchResult[] = cases.map((w) => bench(w.name, w.run))

  console.log(`\n# validator benchmark (${results.length} cases)\n`)
  console.log(renderTable(results))

  const baselinePath = arg("--baseline")
  if (baselinePath) {
    const baseline = readBaseline(baselinePath)
    console.log(`\n## vs baseline (${baselinePath})\n`)
    console.log(renderComparison(baseline, results))
  }

  const writePath = arg("--write")
  if (writePath) {
    writeBaseline(writePath, { suite: "validator", results })
    console.log(`\nwrote baseline -> ${writePath}`)
  }
  console.log("")
}

run()
