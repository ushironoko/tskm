/**
 * Compiler codegen benchmark. The pipeline is dominated by tsgo IPC, not by tight CPU
 * loops, so the metrics here are coarse wall-clock times over a few repetitions rather than
 * the micro-bench's millions of iterations. Three signals are captured:
 *
 *   cold    one full `generate()` from a fresh session (tsgo spawn + openProject + all files)
 *   warm    `generateAll()` on a reused session (the steady-state codegen + IPC, no spawn)
 *   discovery   pure-JS discovery over every fixture file (oxc parse + AST walk, no tsgo)
 *
 * "warm" is the number most codegen optimizations move, since the tsgo spawn cost is fixed.
 * Results are emitted as the same BenchResult shape the validator uses (nsPerOp = median
 * wall time) so the one comparison path in report.ts works for both suites.
 *
 *   bun bench/compiler/bench.ts
 *   bun bench/compiler/bench.ts --baseline <path> --write <path>
 */

import { existsSync, globSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
// Import the SOURCE directly (not the @tskm/compiler package name) so the benchmark always
// measures packages/compiler/src, never the published dist build resolved via node_modules.
import {
  createSession,
  discoverSchemas,
  type GenerateResult,
  generate,
  resolveConfig,
} from "../../packages/compiler/src/index.ts"
import { type BenchResult, bench } from "../lib/measure.ts"
import { readBaseline, renderComparison, renderTable, writeBaseline } from "../lib/report.ts"

const fixtureRoot = fileURLToPath(new URL("./fixtures/perf", import.meta.url))
const config = { mode: "sidecar", include: ["src/*.schema.ts"], tsconfig: "tsconfig.json" } as const

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Removes every generated sidecar and leftover query file under the fixture. */
function cleanArtifacts(): void {
  const patterns = ["src/**/*.gen.ts", "src/**/*.tskm-query.ts"]
  for (const pattern of patterns) {
    for (const match of globSync(pattern, { cwd: fixtureRoot })) {
      const abs = `${fixtureRoot}/${match}`
      if (existsSync(abs)) {
        rmSync(abs)
      }
    }
  }
}

/** Coarse wall-clock timing: `reps` runs, reported as a BenchResult (median ns). */
function timeOp(name: string, op: () => void, reps: number): BenchResult {
  const samples: number[] = []
  for (let i = 0; i < reps; i++) {
    const start = Bun.nanoseconds()
    op()
    samples.push(Bun.nanoseconds() - start)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  return {
    name,
    opsPerSec: median > 0 ? 1_000_000_000 / median : 0,
    nsPerOp: median,
    nsPerOpMin: sorted[0] ?? 0,
    nsPerOpP99: sorted[sorted.length - 1] ?? 0,
    rmePct: 0,
    samples: reps,
    innerIters: 1,
  }
}

function assertGenerated(result: GenerateResult): void {
  if (result.files.length === 0) {
    console.error("compiler bench: generate produced no files; diagnostics:")
    console.error(result.diagnostics.join("\n"))
    process.exit(1)
  }
}

async function run(): Promise<void> {
  const coldReps = Number(arg("--reps") ?? 5)
  const warmReps = Number(arg("--warm-reps") ?? 8)
  const results: BenchResult[] = []

  // --- cold: fresh session each run -----------------------------------------
  // One untimed run first so the tsgo binary and project files are warm in the OS cache.
  cleanArtifacts()
  assertGenerated(await generate({ root: fixtureRoot, config }))
  {
    const samples: number[] = []
    for (let i = 0; i < coldReps; i++) {
      cleanArtifacts()
      const start = Bun.nanoseconds()
      const out = await generate({ root: fixtureRoot, config })
      samples.push(Bun.nanoseconds() - start)
      if (i === 0) {
        assertGenerated(out)
      }
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0
    results.push({
      name: "codegen/cold-full",
      opsPerSec: median > 0 ? 1_000_000_000 / median : 0,
      nsPerOp: median,
      nsPerOpMin: sorted[0] ?? 0,
      nsPerOpP99: sorted[sorted.length - 1] ?? 0,
      rmePct: 0,
      samples: coldReps,
      innerIters: 1,
    })
  }

  // --- warm: one reused session --------------------------------------------
  cleanArtifacts()
  const resolved = resolveConfig(config, fixtureRoot)
  const session = createSession(resolved)
  try {
    assertGenerated(session.generateAll(true)) // warm the session once
    results.push(timeOp("codegen/warm-generateAll", () => void session.generateAll(true), warmReps))
  } finally {
    session.close()
  }

  // --- discovery: pure-JS oxc parse + walk over every fixture file -----------
  const sourceFiles = globSync("src/*.schema.ts", { cwd: fixtureRoot }).map(
    (m) => `${fixtureRoot}/${m}`,
  )
  const sources = sourceFiles.map((f) => ({ file: f, text: readFileSync(f, "utf8") }))
  results.push(
    bench("codegen/discovery-all", () => {
      let total = 0
      for (const s of sources) {
        total += discoverSchemas(s.file, s.text).schemas.length
      }
      return total
    }),
  )

  cleanArtifacts()

  console.log(`\n# compiler codegen benchmark (${sourceFiles.length} files)\n`)
  console.log(renderTable(results))

  const baselinePath = arg("--baseline")
  if (baselinePath) {
    const baseline = readBaseline(baselinePath)
    console.log(`\n## vs baseline (${baselinePath})\n`)
    console.log(renderComparison(baseline, results))
  }
  const writePath = arg("--write")
  if (writePath) {
    writeBaseline(writePath, { suite: "compiler", results })
    console.log(`\nwrote baseline -> ${writePath}`)
  }
  console.log("")
}

await run()
