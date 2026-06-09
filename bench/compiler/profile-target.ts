/**
 * CPU-profile target for the compiler codegen path. Opens one session (so the tsgo spawn is
 * out of the hot region) and runs `generateAll` in a loop. Spawn under `bun --cpu-prof` to
 * see where the steady-state codegen time goes: the resolver's per-marker IPC round trips,
 * discovery, emit, and the native corsa-bind frames. The tsgo binary work itself appears as
 * native frames, so the JS-side cost (the part this repo can change) is what stands out.
 *
 *   bun --cpu-prof bench/compiler/profile-target.ts 20
 */

import { fileURLToPath } from "node:url"
import { createSession, resolveConfig } from "../../packages/compiler/src/index.ts"

const fixtureRoot = fileURLToPath(new URL("./fixtures/perf", import.meta.url))
const config = { mode: "sidecar", include: ["src/*.schema.ts"], tsconfig: "tsconfig.json" } as const
const iterations = Number(process.argv[2] ?? process.env.BENCH_ITERS ?? 20)

const session = createSession(resolveConfig(config, fixtureRoot))
try {
  session.generateAll(true) // warm
  for (let i = 0; i < iterations; i++) {
    session.generateAll(true)
  }
} finally {
  session.close()
}

console.error(`profiled ${iterations} generateAll iterations`)
