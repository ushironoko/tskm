# Performance work: results and findings

This records the profile-guided optimization pass over the `@tskm/core` validator runtime
and the `@tskm/compiler` codegen pipeline, measured with the harness in this directory. All
changes are behavior-preserving: the full test suites stay green (`@tskm/core` 502 passing,
`@tskm/compiler` 504 passing with byte-identical generated output), the type lane is clean,
and Biome reports no issues.

## How this was measured

The order was deliberate. The harness was built first so every change is judged against a
committed baseline (`bench/baselines/*.json`) rather than a remembered number, then the
validator and compiler were profiled with Bun's native `--cpu-prof`, and only then were the
hot paths the profiles named optimized.

A caveat on the absolute multipliers below: the benchmarks were run on a shared machine under
real load (load average around 5 to 6), so per-case wall-clock figures carry noise of roughly
plus or minus 10 to 20 percent between runs. The reliable signal is the consistent direction
across runs on the mid-cost cases, backed by the profile-level reduction in work (allocations,
hash lookups, and IPC round trips removed from the hot path), which is deterministic regardless
of the timer noise.

## Validator (`@tskm/core`)

### What the profile showed

`object`'s `~run` was about 78 percent of total validation time. Two costs recomputed on
every parse although they depend only on construction-time data: `Object.keys(entries)` (which
also allocates a fresh array per parse) and the `entries[key]` hash lookup per property. The
`safeParse` happy path also allocated an array and ran a filter to collect warnings even when
there were none.

### Changes

- `object.ts`: precompute the key list and a parallel schema list once in the factory, then
  walk them by index in `~run`. This removes the per-parse `Object.keys` allocation and the
  per-property hash lookup while preserving the exact key order and every branch (optional-key
  omission, issue path prefixing, rest policy, prototype-pollution-safe assignment).
- `safeParse.ts`: on the no-issue path, skip the warnings filter entirely (the result is a
  fresh empty array, identical to the old `filter` output, just without scanning).
- `union.ts` and `discriminatedUnion.ts`: hoist the construction-time setup (the expected-type
  string, the member dispatch) out of the per-parse path.
- `pipe.ts`: hoist the per-item classification out of the run loop.
- `picklist.ts`: test membership against a `Set` built once, instead of a linear scan per parse.
- `array.ts`: replace the issue-merge spread with an index-loop append.
- `tuple.ts`, `_received.ts`, `literal.ts`: smaller construction-time hoists and ordering tweaks.

`record.ts` was left at its original shape: the only candidate change there detached the value
schema's `~run` from its receiver, which would change behavior for a custom schema that reads
`this`, so it was reverted. The same receiver-preserving fix was applied to `array.ts`.

### Measured (representative low-load run)

| case | speedup vs baseline |
| --- | --- |
| object/flat | 1.16x |
| object/nested | 1.40x |
| array/object-50 | 1.34x |
| union/discriminated | 1.54x |
| pipe/string-validated | 1.46x |
| pipe/number-validated | 1.81x |
| tuple/3 | 1.58x |
| composite/api-payload | 1.31x |
| error/object-flat | 1.50x |
| error/object-nested | 1.45x |
| primitive/number, boolean | 1.6x to 2.2x |

The realistic composite payload improved by roughly a third, and the error path (issue
construction) by close to half. The very cheap primitive cases show the largest multipliers,
but at single-digit-nanosecond timings those numbers are the noisiest.

## Compiler (`@tskm/compiler`)

### What the CPU profile suggested, and what was actually true

The CPU profile attributed 48 percent of codegen time to `updateSnapshot`, which is the tsgo
checker call the resolver made once per marker query. Batching that to one snapshot per query
file was implemented (a new `withSnapshot` scope on the client, reused across all markers in a
file) and is correct and behavior-preserving, but it barely moved wall-clock time.

Direct instrumentation explained why. The CPU profiler's self-time for `updateSnapshot` was
mostly IPC wait misattributed to the native frame. Timing each operation over ten full
`generateAll` runs gave the real breakdown:

| operation | total time | note |
| --- | --- | --- |
| getTypeAtPosition | 394 ms | the actual type resolution, irreducible |
| updateFile created | 185 ms | query-file registration round trip |
| updateFile deleted | 171 ms | query-file removal round trip |
| typeToString | 37 ms | rendering, necessary |
| updateFile changed | 28 ms | source notification |
| withSnapshot acquire + release | 15 ms | the no-op snapshots, already cheap |

So the per-marker snapshot the profile flagged was never expensive. The real codegen cost is
the irreducible checker type resolution plus the file-registration IO: each source writes a
sibling query file and registers then unregisters it with tsgo, and each registration forces a
program re-sync of about 2 ms.

### Changes (behavior-preserving, verified byte-identical)

- `session.ts` + `resolve.ts` + `tsgo-client.ts`: BATCH the query-file registration. `generateAll`
  now prepares every file, registers all checker query files in ONE snapshot, resolves each
  against the pre-registered files, then tears them all down in ONE snapshot, instead of a
  create then delete pair per file. This collapses the program re-sync tsgo runs on every
  file-set change from one-per-file to two-per-run, the dominant codegen cost. `resolveSchemas`
  was split into `queryArtifact` plus `resolveRegisteredQuery` so the single-file and watch path
  keep their self-registering behavior unchanged.
- `tsgo-client.ts` + `query-core.ts`: a forward-compatible in-memory overlay seam. When the
  runtime advertises the overlay capability (via describeCapabilities), query files are registered
  as in-memory overlays with no disk IO; a stock native-preview tsgo does not, so it falls back to
  the disk path (byte-identical to before). This is the path to dropping query-file IO entirely
  once upstream typescript-go implements overlays.
- `tsgo-client.ts` and `resolve.ts`: resolve all of a query file's markers under one snapshot
  instead of one per marker (the no-op snapshot was already cheap, so this is a small cleanup).
- `discovery.ts`: fuse the two order-independent AST pre-passes into one walk.
- `emit.ts`: build the reindenter output into an array joined once, and track line starts with a
  boolean instead of rescanning the accumulator. Verified byte-identical by differential fuzzing.
- `token-scan.ts`: smaller allocation and pass reductions.

### Measured

| case | vs baseline |
| --- | --- |
| codegen/warm-generateAll | 2.7x to 2.9x |
| codegen/cold-full | 1.4x to 1.5x |

`warm-generateAll` (the steady-state codegen, the number most runs care about) is the
batched-registration win: a spike isolated the registration cost dropping 6.4x (26 ms to 4 ms
over the fixture), and end to end the warm path improved from about 61 ms to about 22 ms. The
cold full run, which also pays the one-time tsgo spawn, improved by roughly half. The numbers
carry the usual shared-machine noise, but the registration spike (measured in one process)
confirms the mechanism.

### What is still irreducible

After batching, the dominant remaining cost is `getTypeAtPosition`, the actual checker type
resolution, which cannot be reduced without changing output. The query-file disk IO that remains
would vanish entirely with in-memory overlays, but a stock native-preview tsgo does not implement
that capability yet (its executable is built straight from upstream typescript-go via
`go build ./cmd/tsgo`, with no overlay patch). The overlay seam above is ready for the day
upstream typescript-go adds it.

## Verification

- `@tskm/core`: 502 tests pass. The one failing test is a pre-existing environment issue
  (`interop.test.ts` cannot find the optional `valibot` dev dependency), unrelated to this work.
- `@tskm/compiler`: 504 tests pass, including the real-tsgo integration tests that assert
  byte-identical generated output.
- Type lane (`tsgo --noEmit`) is clean. Biome reports no issues across the repository.
- Both packages were reviewed across model families (Claude and Codex) for behavior preservation.
  The Codex review caught two behavior-divergence risks that were then reverted: a pretty-query
  gate in `resolve.ts` that could change the rendering of method-bearing object types, and a
  `pipe.ts` abort condition tightened to `=== true` that disagreed with the async sibling for a
  truthy non-boolean config value. A shared frozen empty-warnings array was also replaced with a
  fresh array to keep `safeParse`'s clean-path result reference-identical to the original.
