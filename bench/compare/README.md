# Compare

Same payload, same constraints, six libraries. This package is not a workspace, so
`bun install` at the repository root does not install it and the published
packages do not depend on it.

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

`process.hrtime.bigint`. Warmup is 20,000 valid parses. Then 5 runs of 100,000
valid parses and 5 runs of 100,000 invalid parses. The tables use the median.
The boolean is accumulated so the loop is not removed.

## Memory

One fresh `bun` process per library (`src/memory-worker.ts`), plus a `baseline`
process that imports nothing.

1. `Bun.gc(true)`, then `process.memoryUsage().heapUsed` (heap after load).
2. One valid parse, GC, heap again.
3. 50,000 valid parses, sampling `heapUsed` every 1,024 iterations.
4. GC, heap again.
5. `VmHWM` from `/proc/self/status` (peak RSS).

## Bundle

esbuild 0.28.2, `bundle`, `minify`, `treeShaking`, `format: "esm"`,
`platform: "neutral"`. The entry calls `parse` on the valid payload. Gzip is
`zlib` level 9. Bytes are the bundled output.

## Type instantiations

`src/types-count.ts` writes 100 separate schema constants, each with an output
type alias, under `fixtures/<library>/` (gitignored). `skipLibCheck` is on.
Then:

- `node_modules/typescript/lib/tsc.js` (run by the Bun that runs the harness) with
  `-p tsconfig.json --extendedDiagnostics --pretty false`
- `node_modules/@typescript/native-preview/bin/tsgo` with the same flags

`Instantiations` is the count. `Check time` is converted from seconds (or
milliseconds) to milliseconds. Both checkers are devDependencies of this package at
exact versions (`typescript` 6.0.3, `@typescript/native-preview` 7.0.0-dev.20260707.2).
The repository root does not install `tsgo`, so the root is not used.

## Constants

`src/config.ts` holds the iteration counts and the copy count. Change them only
together with a new `RESULTS.md`.
