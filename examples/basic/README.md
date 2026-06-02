# @tskm/example-basic

The smallest end-to-end tskm loop: **write a schema → generate a concrete type → import it and validate at runtime.**

## Files

- [`src/user.schema.ts`](src/user.schema.ts) — the schemas you author (`userSchema`, `productSchema`).
- [`src/user.schema.gen.ts`](src/user.schema.gen.ts) — **generated** by `tskm gen`. Concrete types, no `Infer<…>`.
- [`src/main.ts`](src/main.ts) — a consumer: imports the generated `User` / `Product` types and validates with `safeParse`.

`tsconfig.json` maps `tskm` to the workspace source via `paths` so the checker can resolve the inferred
output type. In a real project `tskm` is a normal dependency and no `paths` entry is needed.

## Generate

From the repository root (after `bun install` + `bun run build`):

```bash
node packages/compiler/dist/cli.mjs gen --root examples/basic
# in a published project this is simply:  npx tskm gen   (or  bunx tskm gen)
```

This rewrites `src/user.schema.gen.ts`. Sidecar mode always rewrites the file (and reports `wrote`), but
the content is stable — once it matches the current compiler, re-running leaves the file diff-free.

## Try the other modes

```bash
# Rewrite `export type T = Infer<typeof X>` markers in place instead of a sidecar (experimental):
node packages/compiler/dist/cli.mjs gen --root examples/basic --mode inplace

# Emit JSON Schema next to each source (experimental; needs a runtime that can import the .ts module):
node packages/compiler/dist/cli.mjs json-schema --root examples/basic

# Regenerate on every change:
node packages/compiler/dist/cli.mjs watch --root examples/basic
```

In a Vite app, add the plugin instead of running the CLI:

```ts
import { tskm } from "@tskm/vite"

export default {
  plugins: [tskm()],
}
```
