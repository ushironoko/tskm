/**
 * CPU-profile target for the validator. Runs the selected workloads in a tight loop with no
 * measurement scaffolding so the captured `.cpuprofile` is dominated by the runtime under
 * test. Spawn it with `bun --cpu-prof` (see bench/lib/profile.ts), selecting a workload via
 * the BENCH_FILTER env var or the first CLI argument.
 *
 *   BENCH_FILTER=object bun --cpu-prof bench/validator/profile-target.ts
 *   bun --cpu-prof bench/validator/profile-target.ts object 4000000
 */

import { sink } from "../lib/measure.ts"
import { selectWorkloads } from "./workloads.ts"

const filter = process.argv[2] ?? process.env.BENCH_FILTER ?? ""
const iterations = Number(process.argv[3] ?? process.env.BENCH_ITERS ?? 2_000_000)

const cases = selectWorkloads(filter)
if (cases.length === 0) {
  console.error(`no workloads match "${filter}"`)
  process.exit(1)
}

// Round-robin across the selected cases so a multi-case profile reflects their mix.
const runs = cases.map((c) => c.run)
for (let i = 0; i < iterations; i++) {
  const fn = runs[i % runs.length] as () => unknown
  sink.value = fn()
}

console.error(
  `profiled ${iterations} iterations across ${cases.length} case(s): ${filter || "all"}`,
)
