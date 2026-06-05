# @tskm/example-standard-schema

tskm's AOT compiler over a **zod** schema: any [Standard Schema](https://standardschema.dev) library works as a source — zod here, valibot/arktype the same way — while the library itself stays your runtime validator.

## Files

- [`src/user.schema.ts`](src/user.schema.ts) — plain zod schemas: an object with a `transform` (the generated type carries the post-transform output), a **branded** id, and a **recursive** schema with zod's idiomatic `z.ZodType<T>` self annotation.
- [`src/user.schema.gen.ts`](src/user.schema.gen.ts) — **generated** by `tskm gen`. Note the emitted imports: `$brand` from zod (the brand marker is part of the real type) and `CategoryT` from the source module (the recursion's named reference).
- [`src/main.ts`](src/main.ts) — a consumer: zod validates at runtime, the generated concrete types annotate the results.

No tskm runtime dependency: only `@tskm/compiler` (dev) and `zod`. zod/valibot/arktype are
default `schemaSources`, so no config file is needed; opt out or extend the list via
`tskm.config.ts` (`schemaSources: [...]`).

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

- Recursive zod schemas need the explicit self annotation (`z.ZodType<CategoryT>`) **exported** from the module; without it zod's own inference self-truncates (`any` at the cut) and the generated type mirrors that, exactly like `z.infer` in your editor.
- The generated file is verified against the real checker before it is written; a type that would not compile (e.g. a leaked non-exported name) is skipped with a diagnostic and the previous output is left untouched.
