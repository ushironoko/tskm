# bench

Performance harness for the `@tskm/core` validator runtime and the `@tskm/compiler` codegen
pipeline. It is the measurement foundation the optimization work is judged against: every
change is compared to a committed baseline rather than a remembered number.

The harness has no third-party dependencies. Timing uses `Bun.nanoseconds()`, and CPU
profiles use Bun's native `--cpu-prof`, which writes a standard V8 `.cpuprofile`. That file
loads directly in speedscope and Chrome DevTools, and converts to pprof with the usual
tooling. The `--cpu-prof-md` pass also writes a grep-friendly markdown call summary.

## Layout

- `lib/measure.ts` is the zero-dep micro-bench. It self-calibrates the inner repeat count,
  warms the JIT, then reports order statistics (min, p50, p99) so one GC pause cannot skew
  the headline.
- `lib/profile.ts` spawns a target script under `bun --cpu-prof` and returns the artifact
  paths.
- `lib/report.ts` persists and compares baselines and renders the tables.
- `validator/` holds the workload suite, the bench entry, and the profile target.
- `compiler/` holds the codegen bench, the profile target, and the fixture project under
  `fixtures/perf`.
- `baselines/` holds the committed reference numbers. `results/` (gitignored) holds profiles
  and the generated report.

## Usage

Run everything, compare to the committed baselines, and capture profiles:

```
bun bench/run.ts
```

Refresh the committed baselines after an intentional change:

```
bun bench/run.ts --write-baseline
```

Run one suite directly:

```
bun bench/validator/bench.ts --filter object
bun bench/compiler/bench.ts --reps 5 --warm-reps 8
```

Capture a focused CPU profile by hand:

```
bun --cpu-prof --cpu-prof-md bench/validator/profile-target.ts object 4000000
bun --cpu-prof bench/compiler/profile-target.ts 24
```

## Metrics

The validator suite reports throughput (ops/sec) and nanoseconds per `safeParse`. The
compiler suite reports wall-clock milliseconds for three signals:

- `cold-full` is one `generate()` from a fresh session, including the tsgo spawn.
- `warm-generateAll` is `generateAll()` on a reused session, the steady-state codegen and IPC
  cost that most optimizations move.
- `discovery-all` is the pure-JS discovery (oxc parse plus AST walk) over every fixture file.
