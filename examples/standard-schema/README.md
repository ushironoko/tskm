# @tskm/example-standard-schema

tskm's AOT compiler over **zod, valibot and arktype** in one project: any
[Standard Schema](https://standardschema.dev) library works as a source, and each
library stays your runtime validator — one compiler types all three.

## Files

- [`src/user.schema.ts`](src/user.schema.ts) — **zod**: an object with a `transform` (the generated type carries the post-transform output), a **branded** id, and a **recursive** schema with zod's idiomatic `z.ZodType<T>` self annotation.
- [`src/product.schema.ts`](src/product.schema.ts) — **valibot**: a `pipe`/`transform` output type, a **brand** (the sidecar imports valibot's `Brand` marker), and `GenericSchema<T>` recursion.
- [`src/order.schema.ts`](src/order.schema.ts) — **arktype**: the string-embedded syntax, including a morph (`string.numeric.parse`) whose generated type is the parsed **output** (`number`).
- `src/*.schema.gen.ts` — **generated** by `tskm gen`. Note the emitted imports: `$brand` from zod / `Brand` from valibot (the brand markers are part of the real types) and `CategoryT` / `MenuT` from their source modules (the recursions' named references).
- [`src/main.ts`](src/main.ts) — a consumer: each library validates at runtime, the generated concrete types annotate the results.

No tskm runtime dependency: only `@tskm/compiler` (dev) plus the three libraries.
zod/valibot/arktype are default `schemaSources`, so no config file is needed; opt
out or extend the list via `tskm.config.ts` (`schemaSources: [...]`).

## Generate

From the repository root (after `bun install` + `bun run build`):

```bash
bun packages/compiler/dist/cli.mjs gen --root examples/standard-schema
# in a published project this is simply:  bunx tskm gen
```

## Run

```bash
bun examples/standard-schema/src/main.ts
```

## Notes

- Recursive schemas need the library-idiomatic explicit self annotation
  (`z.ZodType<CategoryT>` / `v.GenericSchema<MenuT>`) **exported** from the module;
  without it the library's own inference self-truncates (`any` at the cut) and the
  generated type mirrors that, exactly like `z.infer` in your editor.
- The generated file is verified against the real checker before it is written; a
  type that would not compile (e.g. a leaked non-exported name) is skipped with a
  diagnostic and the previous output is left untouched.
