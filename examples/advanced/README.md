# @tskm/example-advanced

Three patterns past the [basic loop](../basic): **discriminated unions, recursive (cyclic)
schemas written data-first with `recursive()`, and the explicit `Infer` marker.** Each schema is materialized into a concrete
`.gen.ts` type by `tskm gen`, so consuming it ([`src/main.ts`](src/main.ts)) costs the type
system nothing.

## 1. Discriminated union

[`src/union.schema.ts`](src/union.schema.ts) — every member carries a `kind` literal:

```ts
export const shapeSchema = union([
  object({ kind: literal("circle"), radius: number() }),
  object({ kind: literal("rectangle"), width: number(), height: number() }),
  object({ kind: literal("text"), content: string() }),
])
```

generates the full union as a concrete type ([`union.schema.gen.ts`](src/union.schema.gen.ts)),
which narrows on `kind` like any hand-written union:

```ts
export type Shape = {
  kind: "circle";
  radius: number;
} | {
  kind: "rectangle";
  width: number;
  height: number;
} | {
  kind: "text";
  content: string;
}
```

## 2. Recursive / cyclic schema — data-first with `recursive()`

[`src/json.schema.ts`](src/json.schema.ts) models a JSON value, which is both a **union** and
**recursive** (a JSON value contains JSON values). TypeScript cannot *infer* a self-referential
type — but you don't have to write one either. `recursive` passes the self-reference INTO the
builder, so the declaring const never appears in its own initializer:

```ts
export const jsonSchema = recursive((self) =>
  union([string(), number(), boolean(), null_(), array(self), record(self)]),
)
```

No hand-written `type Json`, no `GenericSchema<Json>` annotation, no `lazy(() => …)` wrappers —
the three pieces of ceremony recursion used to require. `tskm gen` cannot ask the checker for
this type (inference always collapses a value-level self-reference), so it walks the runtime
schema graph instead and materializes the named self-referential alias
([`json.schema.gen.ts`](src/json.schema.gen.ts)):

```ts
export type Json = string | number | boolean | null | Json[] | {
  [key: string]: Json
}
```

> The record position is an index-signature literal on purpose: `Record<string, Json>` inside a
> self-referential alias is a circularity error (TS2456) — type arguments to another alias are
> resolved eagerly. The literal form is the deferred, legal spelling.

> `lazy` still exists as the non-recursive defer / escape hatch; lazy-based recursion keeps the
> old hand-annotation requirement. At runtime both `lazy` and `recursive` follow the input's
> depth and are not cycle-guarded, so a pathologically deep value can overflow the stack.

## 3. The explicit `Infer` marker — opt-in discovery

tskm's auto-discovery is syntactic: it only finds a **direct** `export const x = object(…)`
(or another tskm factory). A schema built by a **helper** is invisible to it. In
[`src/book.schema.ts`](src/book.schema.ts) the const's initializer is a call to `makeEntity`,
not a tskm factory:

```ts
function makeEntity<E extends ObjectEntries>(entries: E) {
  return object({ id: string(), ...entries })
}

export const bookSchema = makeEntity({ title: string(), pages: number() })

// Opt in explicitly — this marker is what `tskm gen` keys on.
export type Book = Infer<typeof bookSchema>
```

`export type T = Infer<typeof schema>` (or `InferOutput<…>`) tells the compiler to materialize
that schema anyway. It writes the concrete `Book` into [`book.schema.gen.ts`](src/book.schema.gen.ts);
import `Book` from there. (`tskm gen --mode inplace` rewrites the marker *in place* instead of
writing a sidecar — see the root README.)

## Generate

From the repository root (after `bun install` + `bun run build`):

```bash
bun packages/compiler/dist/cli.mjs gen --root examples/advanced
# in a published project this is simply:  bunx tskm gen
```

Recursive schemas are resolved by an isolated worker that **imports your schema module**, so the
worker runtime must be able to import `.ts` — run the CLI with bun (as above), or set
`worker.execPath` in `tskm.config.ts`. Everything else stays on the static checker path.

`tsconfig.json` maps `@tskm/core` to the workspace source via `paths` so the checker can resolve
the inferred output type. In a real project `@tskm/core` is a normal dependency and no `paths`
entry is needed.
