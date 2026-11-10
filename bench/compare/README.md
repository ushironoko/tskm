# Compare

Same payload and constraints, six libraries, with one documented exception (string length;
see "One set of constraints"). This package is not a workspace, so `bun install` at the
repository root does not install it and the published packages do not depend on it.

```bash
cd bench/compare
bun install
bun src/run.ts
```

`bun src/run.ts` prints the tables and writes `RESULTS.md`. That file is the
measured run. Re-run replaces it.

## Payload

One object:

| field | constraint |
| --- | --- |
| `id` | integer, `1 <= id <= 2^53 - 1` |
| `name` | string, length 1..100 |
| `email` | string, length 3..100, matches the expression in `src/constraints.ts` |
| `role` | `"admin"` \| `"member"` \| `"guest"` |
| `tags` | array of strings, each length 1..30 |
| `active` | boolean |
| `score` | integer 0..100 |
| `address.city` | string, length 1..50 |
| `address.zip` | string, length 1..12 |

Undeclared keys are accepted and stripped from the output by every library.

The valid value is `src/payload.ts` (`ada@example.com`, role `admin`). The invalid
value fails each of those groups (`id: 0`, empty name, `not-an-email`, role
`owner`, a `""` tag, `active: "yes"`, `score: 101`, empty address).

### One set of constraints

Every adapter enforces the table above with the same predicate. `src/agreement.ts` checks
this before anything is timed: 62 hand-written cases (the boundary of every group, wrong
types, coercion such as `"7"` for `id`, extra keys) and 2,000 generated emails. The expected
verdicts come from the table, not from a library, and any disagreement stops the run.

- **Email.** One regular expression (`src/constraints.ts`) for every library. The
  libraries' own email validators disagree with it, so none is used: zod's `z.email()`
  accepts `o'neil@example.com`, typebox's `format: "email"` accepts `a@b` and `a@b.c`, and
  arktype's `string.email` accepts `a..b@example.com` and ignores the length bound. tskm's
  `email()` uses the same expression with the `i` flag. The others reach it through
  `z.string().regex`, `v.regex`, typebox `pattern`, an arktype `/.../` literal, and
  effect's `Schema.isPattern`.
- **Integer.** `id` is bounded to the safe-integer range. zod's `int()` and effect's `isInt()`
  already are. Without the bound, tskm, valibot, typebox and arktype accept `2^53`.
- **Known difference, not asserted.** String length. zod and typebox count code points;
  tskm, valibot, arktype and effect count UTF-16 code units. A 51-emoji name (102 units) is
  accepted by zod and typebox only. The payload is ASCII, so the timed inputs are not
  affected. The agreement output reports this row.

## Calls

Each `parse` returns a boolean and, on success, reads `id`. The schema is built
once at import.

| library | success path | failure path |
| --- | --- | --- |
| tskm | `safeParse` | `success: false` |
| zod | `safeParse` | `success: false` |
| valibot | `safeParse` | `success: false` |
| arktype | `schema["~standard"].validate` | `issues` present |
| typebox | `Parse` from `typebox/value` | throw, caught |
| effect | `Schema.decodeUnknownResult(schema, { errors: "all" })` (built once) | `Result.isSuccess` false |

Error collection is the same everywhere: every adapter reports every failing field of the
invalid payload (9 fields). tskm, zod, valibot and arktype do this by default. Two defaults
stop early and are changed: effect's `errors` defaults to `"first"`, and typebox's
`maxParseErrors` defaults to 1, so both are set to collect all. typebox lists 12 entries for
those 9 fields because each branch of the `role` union is an entry.

Arktype's direct call does not build a result object. The bench uses Standard
Schema `validate`, which does. typebox 1.4.3 has no `~standard` and no
`safeParse`; `Parse` returns the value or throws.

tskm is imported from the built `packages/tskm/dist` (the files npm installs; the
harness rebuilds it before measuring, so it matches `src`). Importing `src` makes Bun
transpile TypeScript at load time: in a memory probe that added about 9% to peak RSS
(104 MB vs 95 MB). The others resolve from this directory's `node_modules`.

## Speed

`process.hrtime.bigint`. Each library runs in its own fresh process
(`src/speed-worker.ts`). A process warms up with 100,000 valid and 100,000 invalid parses,
then times 100,000 valid and 100,000 invalid parses. The driver (`src/speed.ts`) repeats
this for 5 rounds and interleaves the libraries within each round, so a slow period on the
shared machine hits every library in that round alike.

The table shows the median over the rounds and the min – max range. The worker counts the
accepted verdicts and the driver fails the run if a valid payload is not accepted or an
invalid one is. Those counts also keep the parse results alive, so the loop is not removed.

In the committed run, the max/min ratio across rounds is 1.07–1.75x for ten of the twelve
valid and invalid rows. The other two are wider: valibot's valid path (about 2.6x) and
arktype's valid path (about 9x).
The load average rose from 1.1 to 7.7 during the speed phase, so those two rows are the
least reliable. Ratios between libraries that fall inside a row's range are not resolved.

## Memory

One fresh `bun` process per library (`src/memory-worker.ts`), plus a `baseline`
process that imports no library. Each process reads the JSC heap counters from `bun:jsc`:

1. `Bun.gc(true)`, then `heapStats().heapSize` and `heapStats().objectCount` (after load).
2. One valid parse, to check the payload is accepted.
3. 50,000 valid parses, reading `heapSize` every 1,024 iterations (a sampled peak, between
   collections).
4. `Bun.gc(true)`, then `heapSize` and `objectCount` again.
5. `VmHWM` from `/proc/self/status` (peak RSS).

`process.memoryUsage().heapUsed` is not used. Under Bun 1.3.13 it reads 212,874 bytes after
a forced GC for tskm and zod, the same as an empty process, while `heapSize` reads about
0.4 MB and 1.7 MB for them. The value is version-dependent, so a number taken from it cannot
be compared across runs. Live object counts repeat within about 0.2% across two runs.

## Bundle

esbuild 0.28.2, `bundle`, `minify`, `treeShaking`, `format: "esm"`,
`platform: "neutral"`. The entry calls `parse` on the valid payload. Gzip is
`zlib` level 9. Bytes are the bundled output.

## Type instantiations

`src/types-count.ts` writes 100 separate schema constants, each with an output
type alias, under `fixtures/<library>/` (gitignored). The expressions are written from the
same constants as the runtime adapters (`src/constraints.ts`). `skipLibCheck` is on, and it
skips `.d.ts` files only, so the fixtures import the published typings (`dist/*.d.mts` for
tskm), not the TypeScript source. Importing the source made the checker type-check tskm's
implementation as well; that inflated tskm's count by about 44% (tsc) and 70% (tsgo).

Each checker runs three times on each fixture:

- `node_modules/typescript/lib/tsc.js` (run by the Bun that runs the harness) with
  `-p tsconfig.json --extendedDiagnostics --pretty false`
- `node_modules/@typescript/native-preview/bin/tsgo` with the same flags

Instantiation counts must match across the three runs or the harness stops. Check time is
the median of the three runs, converted to milliseconds. Check time is noisy on a shared
machine: effect's tsc check time was 240–520 ms across the runs made for this review, so
read the instantiation columns as the stable ones. Both checkers are devDependencies
of this package at exact versions (`typescript` 6.0.3, `@typescript/native-preview`
7.0.0-dev.20260707.2). The repository root does not install `tsgo`, so the root is not used.

Importing each library with nothing else costs 0 to 2,687 instantiations (tskm 1,503,
arktype 2,687; the others register 0). That is under 7% of the smallest 100-copy count, so
the rows are not adjusted for it.

Arktype's count moves from 786,278 to 919,418 because of the constraints, measured one
change at a time with the same 100-copy shape: the id bound adds 32,052, and the email
constraint (the length bound and the regex, written as arktype syntax) adds 101,088, in place
of `string.email`. The count measures arktype's checker parsing those strings. It is the cost
of this constraint in arktype, not a runtime figure.

## Limits

Read these before quoting a number from `RESULTS.md`.

- **Runtime.** Bun 1.3.13 only (the version pinned by the root `packageManager`). Node is
  the runtime the project recommends, and V8 may rank these libraries differently from JSC.
  Nothing here measures Node.
- **Which call is measured.** Each row uses the call in the Calls table, not every API a
  library has. tskm's `is`, `safeParseCompiled` and the `@tskm/compiler` output are not
  measured. typebox's `Check` and `Compile` are not measured, and its `Parse` is set to
  collect every issue (its default stops at the first). arktype's direct call and effect's
  `is` are not measured either. A different call can be faster or slower.
- **Runtime code generation.** The harness does not check which code paths a library uses.
  `@ark/util` probes whether `new Function` is allowed (`out/functions.js`), so arktype has a
  JIT path and a path without it. Under a Content Security Policy that forbids eval, the
  measured paths may not apply.
- **Email.** One regular expression for every library (see above). The libraries' built-in
  email validators are not measured.
- **String length.** zod and typebox count code points, while tskm, valibot, arktype and
  effect count UTF-16 code units. The payload is ASCII, so the timed inputs are not affected,
  but a non-ASCII name can be accepted by one set of libraries and rejected by the other.
- **Machine.** One 8-vCPU VM shared with other workloads. The Run section records the load
  average before and after the speed phase. Under load, the spread across processes grows
  (see the speed table), and ratios inside a library's range are not resolved.
- **Type instantiations** count the work of 100 copies of the schema in each checker. They
  are a proxy for type-checking cost, not a runtime figure.
- **Bundle** rows use each library's main entry (zod's classic `zod` entry, not `zod/mini`,
  which appears as a separate reference row).

## Constants

`src/config.ts` holds the iteration counts and the copy count. Change them only
together with a new `RESULTS.md`.
